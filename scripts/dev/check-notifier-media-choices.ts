/**
 * Author-time check: the Media choices the admin config form offers for a
 * notifier must match that notifier's declared `supportedMedia`.
 *
 * Media is a KIND-level envelope field (one checkbox group shared by every
 * notifier), but `validateConfig` rejects any medium outside the individual
 * notifier's `supportedMedia`. Before the adapter's `envelopeFieldsForPlugin`
 * narrowing existed, the form happily offered Postal for a notifier that has
 * no postal message and the save came back as an opaque 400 — so this asserts
 * the narrowing stays correct as notifiers are added or their media change:
 *
 *   1. every selectable choice is a medium the notifier actually supports
 *      (nothing offered that is certain to be rejected), and
 *   2. every supported medium is selectable (nothing silently unreachable).
 *
 * Run: npx tsx scripts/dev/check-notifier-media-choices.ts
 */
import { initializeEventNotifierPluginSystem } from "../../server/plugins/event-notifier";
import { eventNotifierRegistry } from "../../server/plugins/event-notifier/registry";
import { ALL_NOTIFICATION_MEDIA } from "../../server/plugins/event-notifier/types";
import { getPluginConfigAdapter } from "../../server/plugins/_core";

let failures = 0;
function fail(label: string, detail: string) {
  console.log(`FAIL: ${label}`);
  console.log(`  ${detail}`);
  failures++;
}

function main() {
  initializeEventNotifierPluginSystem();
  const adapter = getPluginConfigAdapter("event-notifier");
  if (!adapter) throw new Error("event-notifier config adapter is not registered");
  if (!adapter.envelopeFieldsForPlugin) {
    throw new Error(
      "event-notifier adapter no longer narrows its envelope fields per plugin — " +
        "the Media group would offer every medium to every notifier again",
    );
  }

  const plugins = eventNotifierRegistry.list();
  if (plugins.length === 0) throw new Error("no event notifiers registered");

  for (const plugin of plugins) {
    const supported = plugin.supportedMedia ?? [];
    const label = `${plugin.id} media choices`;

    const unknown = supported.filter((m) => !ALL_NOTIFICATION_MEDIA.includes(m));
    if (unknown.length > 0) {
      fail(label, `declares unknown media: ${unknown.join(", ")}`);
      continue;
    }

    const fields = adapter.envelopeFieldsForPlugin(plugin) ?? [];
    const media = fields.find((f) => f.name === "media");
    if (!media?.options?.choices) {
      fail(label, "no per-plugin 'media' field with fixed choices was produced");
      continue;
    }

    const selectable = media.options.choices
      .filter((c) => !c.disabled)
      .map((c) => c.value);
    const offeredButUnsupported = selectable.filter((m) => !supported.includes(m as any));
    if (offeredButUnsupported.length > 0) {
      fail(
        label,
        `offers media the notifier cannot send: ${offeredButUnsupported.join(", ")} ` +
          `(supported: ${supported.join(", ") || "(none)"})`,
      );
      continue;
    }

    const supportedButHidden = supported.filter((m) => !selectable.includes(m));
    if (supportedButHidden.length > 0) {
      fail(
        label,
        `supported media are not selectable: ${supportedButHidden.join(", ")}`,
      );
      continue;
    }

    // A locked choice must say why — the form renders the reason inline.
    const unexplained = media.options.choices.filter(
      (c) => c.disabled && !c.disabledReason,
    );
    if (unexplained.length > 0) {
      fail(
        label,
        `locked choices with no explanation: ${unexplained.map((c) => c.value).join(", ")}`,
      );
      continue;
    }

    console.log(
      `PASS: ${label} — selectable [${selectable.join(", ") || "none"}]`,
    );
  }

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
