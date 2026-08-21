import { registerTokenPlugin } from "../registry";
import { memo, tokenEntityOf, type TokenEvalContext } from "../types";

/**
 * {{employer.compliance_message(wizard="…", account="…")}} — a sentence
 * describing an employer's compliance standing for one kind of upload,
 * measured against one ledger account.
 *
 * The two arguments are EXTERNAL identifiers (`sirius_id`), not internal
 * row ids: an author writes the same id the rest of the organization
 * uses, and the token survives a re-import that changes primary keys.
 *
 *   - `wizard`  — the sirius id of a WIZARD plugin configuration
 *                 (`plugin_configs.sirius_id`). The lookup is kind-blind,
 *                 so the kind is asserted here; without that check a
 *                 charge or dashboard config sharing the id would be
 *                 silently accepted and named as an upload type.
 *   - `account` — the sirius id of a ledger account.
 *
 * Neither argument declares `choices`. Validation checks a supplied value
 * against the COMPLETE declared list, and that list would be frozen at
 * plugin-registration time: every wizard configuration or ledger account
 * created after boot would then be rejected as invalid until the next
 * restart. Free text is the honest shape for an id that is minted at
 * runtime.
 */
const COMPONENT = "ledger";

/** Plugin kind a `wizard` argument must name. */
const WIZARD_PLUGIN_KIND = "wizard";

/**
 * The upload type's display name. `plugin_configs.name` is nullable, so
 * fall through to the registered wizard plugin's own name and finally to
 * the id the author wrote — a message must never read "uploads of type
 * null".
 */
async function wizardDisplayName(
  configName: string | null,
  pluginId: string,
  siriusId: string,
): Promise<string> {
  if (configName && configName.trim()) return configName.trim();
  // Dynamic import: `server/storage` imports the wizard registry, so a
  // static import here would close a storage → tokens → wizards → storage
  // cycle (see the header of server/plugins/wizards/registry.ts).
  const { wizardPluginRegistry } = await import("../../wizards/registry");
  const plugin = wizardPluginRegistry.get(pluginId);
  if (plugin?.name && plugin.name.trim()) return plugin.name.trim();
  return siriusId;
}

/** Resolve the wizard configuration named by a sirius id, or null. */
async function loadWizardName(
  ctx: TokenEvalContext,
  siriusId: string,
): Promise<string | null> {
  return memo(ctx, `compliance:wizard-name:${siriusId}`, async () => {
    const config = await ctx.storage.pluginConfigs.findBySiriusId(siriusId);
    // A sirius id that names a config of some OTHER kind is not a
    // near-miss to be papered over — it is the wrong record.
    if (!config || config.pluginKind !== WIZARD_PLUGIN_KIND) return null;
    return wizardDisplayName(config.name ?? null, config.pluginId, siriusId);
  });
}

/** Resolve the ledger account named by a sirius id, or null. */
async function loadAccountName(
  ctx: TokenEvalContext,
  siriusId: string,
): Promise<string | null> {
  return memo(ctx, `compliance:account-name:${siriusId}`, async () => {
    const account = await ctx.storage.ledger.accounts.getBySiriusId(siriusId);
    if (!account) return null;
    return account.name?.trim() || null;
  });
}

/** The one wording every surface renders — sample previews included. */
export function composeComplianceMessage(
  employerName: string,
  wizardName: string,
  accountName: string,
): string {
  return (
    `I am the example compliance message for ${employerName} for uploads ` +
    `of type ${wizardName}. I am operating against account ${accountName}. ` +
    `Hear me roar.`
  );
}

registerTokenPlugin({
  metadata: {
    id: "token.employer.compliance_message",
    name: "Compliance message",
    shortLabel: "compliance message",
    description:
      "The employer's compliance message for one upload type, measured " +
      "against one ledger account",
    segmentName: "compliance_message",
    inputTypes: ["employer"],
    outputType: "value",
    // The `account` argument is meaningless without the ledger. Gating is
    // OFFER-only: a template already naming this token keeps validating
    // and renders blank while the component is off.
    requiredComponent: COMPONENT,
    args: {
      wizard: {
        required: true,
        description: "Sirius ID of the wizard configuration (the upload type)",
      },
      account: {
        required: true,
        description: "Sirius ID of the ledger account to measure against",
      },
    },
    // Fallback for a persona that does not name this leaf; the three
    // employer personas each supply their own sentence.
    example: composeComplianceMessage(
      "Olympus Mons Freight",
      "Monthly Hours Upload",
      "Health & Welfare Trust",
    ),
  },
  async resolve(entity, args, ctx) {
    const employer = tokenEntityOf(entity, "employer");
    const employerName =
      typeof employer?.row.name === "string" ? employer.row.name.trim() : "";
    if (!employerName) return null;

    const wizardSiriusId = (args.wizard ?? "").trim();
    const accountSiriusId = (args.account ?? "").trim();
    if (!wizardSiriusId || !accountSiriusId) return null;

    const [wizardName, accountName] = await Promise.all([
      loadWizardName(ctx, wizardSiriusId),
      loadAccountName(ctx, accountSiriusId),
    ]);
    // A half-resolved sentence would read as fact. Render the chain's
    // default (the author's `defaultValue`, else blank) instead.
    if (!wizardName || !accountName) return null;

    return composeComplianceMessage(employerName, wizardName, accountName);
  },
});
