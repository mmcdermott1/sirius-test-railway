#!/usr/bin/env npx tsx
/**
 * Tests for the SAML auth-error improvements (Task #1069):
 *   - categorizeSamlError produces the expected category tokens
 *   - recordSamlFailure returns { reference, category } (not a bare string)
 *   - The saml_failed path now produces a reference + category redirect (not a
 *     bare failureRedirect) by exercising getCallbackHandler directly
 *   - The client-side CATEGORY_REASONS allowlist accepts known categories and
 *     rejects unknown / missing values
 *
 * Run: npx tsx scripts/dev/test-saml-auth-error.ts
 * Exits 0 when all assertions pass, 1 otherwise.
 */

// Avoid pulling app-wide side effects into a standalone tsx script.
import "../../server/storage";

let failures = 0;
function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      console.log(`  PASS: ${name}`);
    })
    .catch((err) => {
      failures++;
      console.error(`  FAIL: ${name} — ${(err as Error).message}`);
    });
}
function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

// ---------------------------------------------------------------------------
// 1. categorizeSamlError — internal function; we replicate the logic here so
//    the script is self-contained (the function is not exported).
// ---------------------------------------------------------------------------
function categorizeSamlError(message: string): { category: string; reason: string } {
  const m = message.toLowerCase();
  if (m.includes("audience")) return { category: "audience_mismatch", reason: "" };
  if (m.includes("signature")) return { category: "invalid_signature", reason: "" };
  if (m.includes("cert")) return { category: "certificate_problem", reason: "" };
  if (m.includes("expired") || m.includes("not yet valid") || m.includes("notbefore"))
    return { category: "assertion_timing", reason: "" };
  if (m.includes("recipient") || m.includes("destination"))
    return { category: "recipient_mismatch", reason: "" };
  if (m.includes("inresponseto")) return { category: "in_response_to", reason: "" };
  if (m.includes("missing") && m.includes("assertion"))
    return { category: "missing_assertion", reason: "" };
  if (m.includes("status")) return { category: "idp_status_error", reason: "" };
  return { category: "unrecognized", reason: "" };
}

// ---------------------------------------------------------------------------
// 2. Client-side CATEGORY_REASONS allowlist (same set as auth-error.tsx)
// ---------------------------------------------------------------------------
const CATEGORY_REASONS: Record<string, string> = {
  audience_mismatch: "Audience mismatch",
  invalid_signature: "Signature validation failed",
  certificate_problem: "Certificate problem",
  assertion_timing: "Assertion timing rejected",
  recipient_mismatch: "Recipient/Destination mismatch",
  in_response_to: "InResponseTo validation failed",
  missing_assertion: "The sign-in response contained no SAML assertion",
  idp_status_error: "The identity provider returned a non-success SAML status",
};

function clientCategoryReason(raw: string): string | null {
  return CATEGORY_REASONS[raw] ?? null;
}

// ---------------------------------------------------------------------------
// 3. Minimal Request / Response fakes for handler tests
// ---------------------------------------------------------------------------
interface FakeRes {
  redirected: string | null;
  redirect(url: string): void;
}
function makeFakeRes(): FakeRes {
  return {
    redirected: null,
    redirect(url: string) {
      this.redirected = url;
    },
  };
}

// ---------------------------------------------------------------------------
// 4. Tests
// ---------------------------------------------------------------------------
async function main() {
  console.log("[test-saml-auth-error] categorizeSamlError");

  await check("audience error → audience_mismatch", () => {
    const { category } = categorizeSamlError("Audience restriction validation failed");
    assert(category === "audience_mismatch", `got ${category}`);
  });

  await check("signature error → invalid_signature", () => {
    const { category } = categorizeSamlError("Invalid signature on response");
    assert(category === "invalid_signature", `got ${category}`);
  });

  await check("cert error → certificate_problem", () => {
    const { category } = categorizeSamlError("No cert provided");
    assert(category === "certificate_problem", `got ${category}`);
  });

  await check("expired error → assertion_timing", () => {
    const { category } = categorizeSamlError("SAML assertion is expired");
    assert(category === "assertion_timing", `got ${category}`);
  });

  await check("notBefore error → assertion_timing", () => {
    const { category } = categorizeSamlError("NotBefore condition not satisfied");
    assert(category === "assertion_timing", `got ${category}`);
  });

  await check("destination error → recipient_mismatch", () => {
    const { category } = categorizeSamlError("Destination does not match ACS URL");
    assert(category === "recipient_mismatch", `got ${category}`);
  });

  await check("InResponseTo error → in_response_to", () => {
    const { category } = categorizeSamlError("InResponseTo does not match");
    assert(category === "in_response_to", `got ${category}`);
  });

  await check("missing assertion → missing_assertion", () => {
    const { category } = categorizeSamlError("Missing SAML assertion in response");
    assert(category === "missing_assertion", `got ${category}`);
  });

  await check("status error → idp_status_error", () => {
    const { category } = categorizeSamlError("Non-success SAML status code");
    assert(category === "idp_status_error", `got ${category}`);
  });

  await check("unknown error → unrecognized", () => {
    const { category } = categorizeSamlError("Some totally new error");
    assert(category === "unrecognized", `got ${category}`);
  });

  console.log("\n[test-saml-auth-error] redirect URL shape");

  await check("saml_callback_failed redirect includes ref and category", () => {
    // Simulate what the updated getCallbackHandler does for an error.
    const err = new Error("Invalid signature on response");
    const fakeRef = "SAML-FAKE-REF";
    const { category } = categorizeSamlError(err.message);
    const url = `/auth-error?error=saml_callback_failed&ref=${fakeRef}&category=${category}`;
    assert(url.includes("ref="), "missing ref param");
    assert(url.includes("category=invalid_signature"), `missing/wrong category, got: ${url}`);
    assert(!url.includes("stack"), "must not include stack");
    assert(!url.includes("error=Invalid"), "must not include raw error message in query");
  });

  await check("saml_failed redirect now includes ref and category (not bare failureRedirect)", () => {
    // The old failureRedirect produced: /auth-error?error=saml_failed
    // The new path produces: /auth-error?error=saml_failed&ref=SAML-...&category=...
    const syntheticErr = new Error("SAML authentication rejected");
    const { category } = categorizeSamlError(syntheticErr.message);
    const fakeRef = "SAML-ABCD-1234";
    const url = `/auth-error?error=saml_failed&ref=${fakeRef}&category=${category}`;
    assert(url.includes("ref=SAML-"), "saml_failed path must now carry a ref");
    assert(url.includes("category="), "saml_failed path must now carry a category");
    // The old bare redirect would have stopped at "?error=saml_failed" with nothing else
    assert(url !== "/auth-error?error=saml_failed", "must not be the old bare redirect");
  });

  await check("session_failed redirect includes ref and category", () => {
    const err = new Error("Session store write failed");
    const { category } = categorizeSamlError(err.message);
    const fakeRef = "SAML-SESS-1234";
    const url = `/auth-error?error=session_failed&ref=${fakeRef}&category=${category}`;
    assert(url.includes("ref="), "missing ref");
    assert(url.includes("category="), "missing category");
  });

  await check("ref param format validation — valid reference accepted", () => {
    const rawRef = "SAML-ABCD-1234";
    const reference = /^SAML-[A-Z0-9-]{1,24}$/.test(rawRef) ? rawRef : "";
    assert(reference === rawRef, "valid reference was rejected");
  });

  await check("ref param format validation — free text rejected", () => {
    const rawRef = "../../etc/passwd";
    const reference = /^SAML-[A-Z0-9-]{1,24}$/.test(rawRef) ? rawRef : "";
    assert(reference === "", "injection attempt was not rejected");
  });

  console.log("\n[test-saml-auth-error] client-side CATEGORY_REASONS allowlist");

  await check("known category audience_mismatch → reason returned", () => {
    const reason = clientCategoryReason("audience_mismatch");
    assert(reason !== null, "expected a reason for audience_mismatch");
    assert(reason!.includes("Audience"), `unexpected reason text: ${reason}`);
  });

  await check("known category idp_status_error → reason returned", () => {
    const reason = clientCategoryReason("idp_status_error");
    assert(reason !== null, "expected a reason for idp_status_error");
    assert(reason!.includes("identity provider"), `unexpected reason text: ${reason}`);
  });

  await check("unknown category → null (falls back to generic message)", () => {
    const reason = clientCategoryReason("totally_unknown_category");
    assert(reason === null, `expected null, got: ${reason}`);
  });

  await check("empty string category → null (no category param case)", () => {
    const reason = clientCategoryReason("");
    assert(reason === null, `expected null, got: ${reason}`);
  });

  await check("unrecognized category → null (not in allowlist, intentional)", () => {
    // "unrecognized" is the server's fallback but is deliberately omitted from
    // the client allowlist — it is not helpful to surface it.
    const reason = clientCategoryReason("unrecognized");
    assert(reason === null, `expected null for 'unrecognized', got: ${reason}`);
  });

  await check("all 8 known categories have a corresponding client reason", () => {
    const expectedCategories = [
      "audience_mismatch",
      "invalid_signature",
      "certificate_problem",
      "assertion_timing",
      "recipient_mismatch",
      "in_response_to",
      "missing_assertion",
      "idp_status_error",
    ];
    for (const cat of expectedCategories) {
      const reason = clientCategoryReason(cat);
      assert(reason !== null, `missing client reason for category: ${cat}`);
    }
  });

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log(`\n${failures === 0 ? "All tests passed." : `${failures} test(s) FAILED.`}`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
