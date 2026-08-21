/**
 * One-off verification for {{employer.compliance_message(wizard=…, account=…)}}.
 *
 * Covers the happy path plus every way the chain is meant to render
 * nothing: an unknown wizard sirius id, a sirius id belonging to a
 * config of the WRONG kind, an unknown account sirius id, and a missing
 * required argument (rejected at validation time, before any render).
 *
 * Creates its own throwaway ledger account and plugin configurations and
 * deletes them again — it never renders against, or mutates, real
 * compliance data.
 *
 * Run: npx tsx scripts/oneoffs/verify-compliance-message-token.ts
 */
import { employers } from "../../shared/schema";
import { initializeTokenPluginSystem } from "../../server/plugins/tokens";
import { storage } from "../../server/storage/database";
import { loadComponentCache } from "../../server/services/component-cache";

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const STAMP = Date.now().toString(36).toUpperCase();
const WIZARD_SIRIUS = `VERIFY-CMT-WIZ-${STAMP}`;
const OTHER_KIND_SIRIUS = `VERIFY-CMT-OTHER-${STAMP}`;
const ACCOUNT_SIRIUS = `VERIFY-CMT-ACCT-${STAMP}`;
const WIZARD_CONFIG_NAME = "Verification Upload Type";
const ACCOUNT_NAME = "Verification Compliance Account";

async function main() {
  await loadComponentCache();
  initializeTokenPluginSystem();
  // Importing the barrel is what registers the bundled wizard plugins;
  // registering the KIND is what lets a `wizard` plugin config be created.
  const { registerWizardPluginKind, wizardPluginRegistry } = await import(
    "../../server/plugins/wizards"
  );
  registerWizardPluginKind();
  const {
    renderTokens,
    createTokenEvalContext,
    validateTokenExpressionForRoots,
  } = await import("../../server/plugins/tokens");

  const wizardPluginId = wizardPluginRegistry.list()[0]?.id;
  if (!wizardPluginId) {
    check("at least one wizard plugin is registered", false);
    process.exit(1);
  }

  const employer = (await storage.employers.getAllEmployers()).find(
    (e) => typeof e.name === "string" && e.name.trim(),
  );
  if (!employer) {
    check("an employer with a name exists to render against", false);
    process.exit(1);
  }
  const employerName = employer.name.trim();

  const created: Array<() => Promise<unknown>> = [];
  try {
    const account = await storage.ledger.accounts.create({
      name: ACCOUNT_NAME,
      siriusId: ACCOUNT_SIRIUS,
    });
    created.push(() => storage.ledger.accounts.delete(account.id));

    const wizardConfig = await storage.pluginConfigs.create({
      pluginKind: "wizard",
      pluginId: wizardPluginId,
      name: WIZARD_CONFIG_NAME,
      siriusId: WIZARD_SIRIUS,
      enabled: true,
    });
    created.push(() => storage.pluginConfigs.delete(wizardConfig.id));

    // Same sirius-id shape, a different plugin kind: the lookup is
    // kind-blind, so this is what the kind assertion has to reject.
    const otherKindConfig = await storage.pluginConfigs.create({
      pluginKind: "dashboard",
      pluginId: "verify-compliance-message-token",
      name: "Not A Wizard",
      siriusId: OTHER_KIND_SIRIUS,
      enabled: false,
    });
    created.push(() => storage.pluginConfigs.delete(otherKindConfig.id));

    const seedCtx = () =>
      createTokenEvalContext(storage, undefined, {
        seeds: [
          {
            name: "employer",
            entity: {
              kind: "employer",
              row: employer as unknown as Record<string, unknown>,
              table: employers,
            },
          },
        ],
      });
    const render = async (expr: string) =>
      (await renderTokens(`{{${expr}}}`, seedCtx())).output;

    console.log("\n--- validation ---");
    for (const [expr, shouldPass] of [
      [
        `employer.compliance_message(wizard="${WIZARD_SIRIUS}", account="${ACCOUNT_SIRIUS}")`,
        true,
      ],
      [`employer.compliance_message(wizard="${WIZARD_SIRIUS}")`, false],
      [`employer.compliance_message(account="${ACCOUNT_SIRIUS}")`, false],
      ["employer.compliance_message", false],
      // Reach is by ENTITY KIND, which is what "only from an employer"
      // means: never a bare root, never a non-employer entity, but any
      // chain that has actually arrived at an employer — the leaf reads
      // that employer's own name, exactly as `employer.name` would.
      [
        `compliance_message(wizard="${WIZARD_SIRIUS}", account="${ACCOUNT_SIRIUS}")`,
        false,
      ],
      [
        `worker.compliance_message(wizard="${WIZARD_SIRIUS}", account="${ACCOUNT_SIRIUS}")`,
        false,
      ],
      [
        `worker.home_employer.compliance_message(wizard="${WIZARD_SIRIUS}", account="${ACCOUNT_SIRIUS}")`,
        true,
      ],
    ] as const) {
      const v = validateTokenExpressionForRoots(expr, ["employer", "worker"]);
      check(
        `{{${expr}}} ${shouldPass ? "validates" : "is rejected"}`,
        v.ok === shouldPass,
        v.ok ? undefined : v.error,
      );
    }

    console.log("\n--- happy path ---");
    const happy = await render(
      `employer.compliance_message(wizard="${WIZARD_SIRIUS}", account="${ACCOUNT_SIRIUS}")`,
    );
    console.log(`  "${happy}"`);
    check(
      "renders the full sentence with all three names",
      happy ===
        `I am the example compliance message for ${employerName} for uploads ` +
          `of type ${WIZARD_CONFIG_NAME}. I am operating against account ` +
          `${ACCOUNT_NAME}. Hear me roar.`,
    );

    console.log("\n--- unresolvable arguments render nothing ---");
    for (const [label, expr] of [
      [
        "unknown wizard sirius id",
        `employer.compliance_message(wizard="NO-SUCH-WIZ", account="${ACCOUNT_SIRIUS}")`,
      ],
      [
        "sirius id of a non-wizard config",
        `employer.compliance_message(wizard="${OTHER_KIND_SIRIUS}", account="${ACCOUNT_SIRIUS}")`,
      ],
      [
        "unknown account sirius id",
        `employer.compliance_message(wizard="${WIZARD_SIRIUS}", account="NO-SUCH-ACCT")`,
      ],
    ] as const) {
      const out = await render(expr);
      check(`${label} renders blank, not a partial sentence`, out === "", `"${out}"`);
    }

    console.log("\n--- wizard config with no name falls back ---");
    await storage.pluginConfigs.update(wizardConfig.id, { name: null });
    const unnamed = await render(
      `employer.compliance_message(wizard="${WIZARD_SIRIUS}", account="${ACCOUNT_SIRIUS}")`,
    );
    console.log(`  "${unnamed}"`);
    const pluginName = wizardPluginRegistry.get(wizardPluginId)?.name ?? "";
    check(
      "names the wizard plugin instead of rendering 'type null'",
      unnamed.includes(`of type ${pluginName}.`),
      pluginName,
    );

    console.log("\n--- sample mode (each employer persona) ---");
    for (const persona of ["martian", "historical", "mythological"]) {
      const ctx = createTokenEvalContext(storage, undefined, {
        sample: true,
        sampleSetIds: { employer: persona },
      });
      const out = (
        await renderTokens(
          `{{employer.compliance_message(wizard="${WIZARD_SIRIUS}", account="${ACCOUNT_SIRIUS}")}}`,
          ctx,
        )
      ).output;
      console.log(`  ${persona}: "${out}"`);
      check(
        `${persona} persona previews a coherent sentence`,
        out.startsWith("I am the example compliance message for") &&
          out.endsWith("Hear me roar.") &&
          !out.includes("Olympus Mons Freight for uploads of type Monthly"),
      );
    }
  } finally {
    for (const undo of created.reverse()) {
      try {
        await undo();
      } catch (err) {
        console.log(`  cleanup failed: ${(err as Error).message}`);
        failures++;
      }
    }
  }

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
