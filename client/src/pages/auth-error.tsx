import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";

/**
 * Landing page for server-side authentication failures. Auth providers
 * redirect here with ?error=<code> (e.g. the SAML callback handler);
 * without this route those redirects fell through to the 404 page.
 */
const ERROR_MESSAGES: Record<string, string> = {
  saml_failed:
    "Sign-in with your identity provider failed. The sign-in response could not be verified.",
  saml_callback_failed:
    "Something went wrong while processing the sign-in response from your identity provider.",
  saml_wrong_binding:
    "Your identity provider sent the sign-in response in an unsupported way (Redirect binding). Configure it to use the HTTP-POST binding for this application's callback URL.",
  saml_not_configured:
    "Single sign-on is not configured in this environment. Contact an administrator.",
  access_denied:
    "Your sign-in succeeded, but this account is not authorized to access this application. Contact an administrator.",
  session_failed:
    "Sign-in succeeded but your session could not be created. Please try again.",
};

const DEFAULT_MESSAGE =
  "Sign-in failed. Please try again, or contact an administrator if the problem persists.";

/**
 * Allowlist of SAML failure categories that the server may include as the
 * `?category=` param.  Mirrors the category strings produced by
 * `categorizeSamlError` on the server.  Unknown or missing values are ignored
 * so no free-text ever appears from the URL.
 */
const CATEGORY_REASONS: Record<string, string> = {
  audience_mismatch:
    "Audience mismatch: the identity provider's Audience URI (SP Entity ID) does not match this application's issuer. Make both sides identical.",
  invalid_signature:
    "Signature validation failed: the response/assertion signature does not verify against the configured IdP certificate, or a required signature is missing. Check the certificate pasted in SAML_CERT and that the IdP signs the assertion.",
  certificate_problem:
    "Certificate problem: the configured IdP signing certificate is missing or invalid (SAML_CERT).",
  assertion_timing:
    "Assertion timing rejected (expired or not yet valid): usually clock skew between the identity provider and this server, or a stale/replayed response.",
  recipient_mismatch:
    "Recipient/Destination mismatch: the identity provider is posting to a different callback URL than this application expects. The Single sign-on (ACS) URL must exactly match the application's callback URL.",
  in_response_to:
    "InResponseTo validation failed: the response does not match an outstanding login request (IdP-initiated flow or an expired login attempt).",
  missing_assertion:
    "The sign-in response contained no SAML assertion (malformed or truncated response from the identity provider).",
  idp_status_error:
    "The identity provider returned a non-success SAML status. Check the IdP-side assignment/configuration for this user and application.",
  // "unrecognized" is intentionally omitted — the generic error message is
  // more helpful than surfacing "Unrecognized SAML error" to the user.
};

export default function AuthErrorPage() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("error") ?? "";
  // Short opaque reference persisted server-side with the failure details;
  // admins can look it up in the system logs. Reject anything that doesn't
  // look like one of our generated references.
  const rawRef = params.get("ref") ?? "";
  const reference = /^SAML-[A-Z0-9-]{1,24}$/.test(rawRef) ? rawRef : "";

  // Validate category against the allowlist — never show free-text from the URL.
  const rawCategory = params.get("category") ?? "";
  const categoryReason = CATEGORY_REASONS[rawCategory] ?? null;

  const message = ERROR_MESSAGES[code] ?? DEFAULT_MESSAGE;

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2 items-center">
            <AlertCircle className="h-8 w-8 text-red-500 shrink-0" />
            <h1
              className="text-xl md:text-2xl font-bold text-gray-900"
              data-testid="text-auth-error-title"
            >
              Sign-in problem
            </h1>
          </div>
          <p className="text-sm text-gray-600" data-testid="text-auth-error-message">
            {message}
          </p>
          {categoryReason && (
            <p
              className="mt-3 text-sm text-gray-700 bg-gray-100 rounded p-3"
              data-testid="text-auth-error-category-reason"
            >
              {categoryReason}
            </p>
          )}
          {code && (
            <p className="mt-2 text-xs text-gray-400 font-mono" data-testid="text-auth-error-code">
              Error code: {code}
            </p>
          )}
          {reference && (
            <p className="mt-1 text-xs text-gray-400 font-mono" data-testid="text-auth-error-reference">
              Reference: {reference}
            </p>
          )}
          {reference && (
            <p className="mt-2 text-xs text-gray-500" data-testid="text-auth-error-reference-hint">
              Give this reference to an administrator — the failure details are
              recorded in the system logs.
            </p>
          )}
          <div className="mt-6">
            <Button asChild data-testid="button-auth-error-login">
              <Link href="/login">Back to sign-in</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
