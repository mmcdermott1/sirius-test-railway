/**
 * Delivery-parity check for registered template surfaces.
 *
 * A template surface exists for one reason: what an author previews in
 * the studio must be what the recipient receives. This check renders
 * fields through the preview pipeline and through the SAME functions
 * delivery uses, then asserts the two agree — including the fields that
 * are deliberately NOT tokenized (a literal link URL must preview
 * verbatim, not substituted).
 *
 * Covered today:
 *   - bulk email body (HTML: escape tokens, then sanitize)
 *   - bulk in-app (tokenized title/body/label, literal link URL)
 *   - event-notifier in-app (tokenized fields incl. the link label)
 *
 * Run: npx tsx scripts/dev/test-template-surface-parity.ts
 */
import { storage } from "../../server/storage";
import { loadComponentCache } from "../../server/services/component-cache";
import { initializeTokenPluginSystem, createTokenEvalContext } from "../../server/plugins/tokens";
import {
  getTemplateSurface,
  initializeTemplateSurfaces,
  renderTemplateSurface,
} from "../../server/plugins/template-surfaces";
import { renderEmailBodyHtmlForDelivery } from "../../server/modules/bulk/deliver-email";
import { renderInappContentForDelivery } from "../../server/modules/bulk/deliver-inapp";
import { initializeEventNotifierPluginSystem } from "../../server/plugins/event-notifier";
import { eventNotifierRegistry } from "../../server/plugins/event-notifier/registry";
import { composeFromTemplates, resolveTemplates } from "../../server/plugins/event-notifier/token-templates";
import { NOTIFIER_CHANNEL_FIELDS } from "../../server/plugins/event-notifier/field-media";
import { applyFieldEligibility } from "../../server/plugins/template-surfaces/shape";

/** A token every contact resolves (display name), so both paths substitute real text. */
const CONTACT_TOKEN = "{{contact}}";

const HTML_CASES: { label: string; bodyHtml: string }[] = [
  {
    label: "script tag and event handler",
    bodyHtml: `<p onclick="steal()">Hello <b>${CONTACT_TOKEN}</b></p><script>steal()</script>`,
  },
  {
    label: "iframe and javascript: link",
    bodyHtml: '<iframe src="https://evil.test"></iframe><a href="javascript:alert(1)">click</a>',
  },
  {
    label: "token used as a whole attribute value",
    bodyHtml: `<a href="{{contact.field(name=\\"email\\")}}">mail me</a><p>plain text</p>`,
  },
];

/**
 * Ordinary authored markup must survive both paths untouched, so an
 * over-eager sanitizer change can't quietly strip real content from
 * delivered mail (and still "pass" by matching an equally broken
 * preview).
 */
const PRESERVED_HTML =
  '<p>Hi there,</p><p><a href="https://example.test/notice">Read the notice</a></p><ul><li><strong>bold</strong></li></ul>';

let failures = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${label}${detail !== undefined ? " :: " + JSON.stringify(detail) : ""}`,
  );
};

async function main() {
  await loadComponentCache();
  initializeTokenPluginSystem();
  initializeEventNotifierPluginSystem();
  initializeTemplateSurfaces();

  const bulk = getTemplateSurface("bulk-message");
  const notifier = getTemplateSurface("event-notifier");
  if (!bulk || !notifier) throw new Error("expected surfaces are not registered");

  // A real contact so preview and delivery substitute the same values.
  const { db } = await import("../../server/storage/db");
  const { sql } = await import("drizzle-orm");
  const contact = (
    await db.execute(
      sql`SELECT id, display_name FROM contacts WHERE display_name IS NOT NULL AND display_name <> '' LIMIT 1`,
    )
  ).rows[0] as { id: string } | undefined;
  if (!contact) throw new Error("no contact with a display name in this database");
  const evalCtx = () => createTokenEvalContext(storage, contact.id);

  // ── bulk email body ───────────────────────────────────────────────────────
  for (const { label, bodyHtml } of [...HTML_CASES, { label: "ordinary markup", bodyHtml: PRESERVED_HTML }]) {
    const preview = await renderTemplateSurface({
      storage,
      surface: bulk,
      params: { channel: "email" },
      values: { subject: "s", bodyHtml },
      contactId: contact.id,
    });
    const delivered = await renderEmailBodyHtmlForDelivery(bodyHtml, evalCtx());
    check(`bulk email — ${label}: preview matches delivery`, preview.fields.bodyHtml?.rendered === delivered, {
      previewed: preview.fields.bodyHtml?.rendered,
      delivered,
    });
    if (label === "ordinary markup") {
      check("bulk email — ordinary markup kept intact", delivered === PRESERVED_HTML, { delivered });
    } else {
      check(`bulk email — ${label}: shaping actually applied`, delivered !== bodyHtml, { delivered });
    }
  }

  // ── bulk in-app ───────────────────────────────────────────────────────────
  {
    const content = {
      title: `Notice for ${CONTACT_TOKEN}`,
      bodyHtml: `<p>Hello ${CONTACT_TOKEN}</p><p>second line</p>`,
      // Not tokenized in the editor: must stay literal on both paths.
      linkUrl: `https://example.test/notice?who=${CONTACT_TOKEN}`,
      linkLabel: `Open, ${CONTACT_TOKEN}`,
    };
    const preview = await renderTemplateSurface({
      storage,
      surface: bulk,
      params: { channel: "inapp" },
      values: content,
      contactId: contact.id,
    });
    // Delivery stores the body flattened to plain text, then renders it.
    const { htmlToPlainText } = await import("../../shared/html-to-text");
    const delivered = await renderInappContentForDelivery(
      {
        title: content.title,
        body: htmlToPlainText(content.bodyHtml),
        linkUrl: content.linkUrl,
        linkLabel: content.linkLabel,
      },
      evalCtx(),
    );
    check("bulk in-app — title matches delivery", preview.fields.title?.rendered === delivered.title, {
      previewed: preview.fields.title?.rendered,
      delivered: delivered.title,
    });
    check("bulk in-app — body matches delivery", preview.fields.body?.rendered === delivered.body, {
      previewed: preview.fields.body?.rendered,
      delivered: delivered.body,
    });
    check("bulk in-app — link label matches delivery", preview.fields.linkLabel?.rendered === delivered.linkLabel, {
      previewed: preview.fields.linkLabel?.rendered,
      delivered: delivered.linkLabel,
    });
    check("bulk in-app — literal link URL matches delivery", preview.fields.linkUrl?.rendered === delivered.linkUrl, {
      previewed: preview.fields.linkUrl?.rendered,
      delivered: delivered.linkUrl,
    });
    check(
      "bulk in-app — tokenized fields really substituted (test is not vacuous)",
      delivered.title !== content.title && preview.fields.linkUrl?.rendered === content.linkUrl,
      { title: delivered.title, linkUrl: delivered.linkUrl },
    );
  }

  // ── event-notifier (every channel, incl. whitespace + blank cases) ────────
  {
    const plugin = eventNotifierRegistry
      .list()
      .find((p: any) => p.tokenTemplates && p.tokenTemplates.defaultTemplates({})?.inapp) as any;
    if (!plugin) {
      check("event-notifier — a token-templated notifier exists", false);
      return finish();
    }
    // Seed every root the notifier declares with an empty row: parity is
    // about SHAPING, so the values don't matter — but an unseeded root
    // would render sample values on one side and nothing on the other.
    const seeds = (plugin.tokenTemplates.roots as Array<{ name: string; kind: string }>).map(
      (root) => ({ name: root.name, entity: { kind: root.kind, row: {} } }),
    );

    /**
     * Render one channel's templates through delivery and through the
     * preview and compare every declared field, plus the "would anything
     * be sent at all" decision.
     */
    const compareChannel = async (
      label: string,
      channel: "email" | "sms" | "inapp",
      channelTemplates: Record<string, string>,
      expect?: { deliverable?: boolean },
    ) => {
      const configData = { templates: { [channel]: channelTemplates } };
      const delivered: any = await composeFromTemplates(
        plugin,
        channel as any,
        { contactId: contact.id },
        seeds as any,
        resolveTemplates(plugin, configData),
        new Map<string, unknown>(),
      );
      const preview = await renderTemplateSurface({
        storage,
        surface: notifier,
        params: { pluginId: plugin.id, channel, configData },
        values: channelTemplates,
        contactId: contact.id,
        // Seed the same roots delivery composes with: parity is about
        // shaping, and an unseeded root would render sample values
        // (which delivery never does) instead.
        seeds: seeds as any,
      });
      check(`${label}: "is anything delivered?" matches`, preview.deliverable === (delivered !== null), {
        previewDeliverable: preview.deliverable,
        delivered: delivered !== null,
      });
      if (expect?.deliverable !== undefined) {
        check(`${label}: delivery decision is the expected one`, (delivered !== null) === expect.deliverable, {
          delivered: delivered !== null,
        });
      }
      if (!delivered) return preview;
      for (const spec of NOTIFIER_CHANNEL_FIELDS[channel]) {
        // Delivery omits blank optional fields; preview drops them too.
        const deliveredValue = delivered[spec.key] || undefined;
        const previewedValue = preview.fields[spec.key]?.rendered || undefined;
        check(`${label}: ${spec.key} matches delivery`, previewedValue === deliveredValue, {
          previewed: previewedValue,
          delivered: deliveredValue,
        });
      }
      return preview;
    };

    await compareChannel("notifier in-app", "inapp", {
      title: `Update for ${CONTACT_TOKEN}`,
      body: `Hello ${CONTACT_TOKEN}`,
      linkUrl: "/notifications",
      linkLabel: `Open, ${CONTACT_TOKEN}`,
    }, { deliverable: true });

    // Whitespace: delivery trims every in-app field, and trims BEFORE
    // deciding whether the link is a safe relative path.
    const padded = await compareChannel("notifier in-app (padded whitespace)", "inapp", {
      title: "  Padded title  ",
      body: "\n  Padded body \n",
      linkUrl: "  /notifications  ",
      linkLabel: "  Open  ",
    }, { deliverable: true });
    check(
      "notifier in-app (padded whitespace): preview shows trimmed values, keeps the padded link",
      padded.fields.title?.rendered === "Padded title" && padded.fields.linkUrl?.rendered === "/notifications",
      { title: padded.fields.title?.rendered, linkUrl: padded.fields.linkUrl?.rendered },
    );

    // Whitespace-only required fields: nothing is sent, so the preview
    // must say nothing would be sent.
    const blank = await compareChannel("notifier in-app (blank required fields)", "inapp", {
      title: "   ",
      body: "  ",
      linkUrl: "/notifications",
      linkLabel: "Open",
    });
    check("notifier in-app (blank required fields): preview agrees with delivery", blank.deliverable === false, {
      deliverable: blank.deliverable,
    });

    // An unsafe link is dropped on delivery; the preview blanks it and
    // drops the label with it.
    const unsafe = await compareChannel("notifier in-app (unsafe link)", "inapp", {
      title: "t",
      body: "b",
      linkUrl: "https://evil.test",
      linkLabel: "Click",
    }, { deliverable: true });
    check(
      "notifier in-app (unsafe link): link blanked and label suppressed",
      !unsafe.fields.linkUrl?.rendered && unsafe.fields.linkLabel === undefined,
      { linkUrl: unsafe.fields.linkUrl?.rendered, linkLabel: unsafe.fields.linkLabel },
    );

    await compareChannel("notifier email", "email", {
      subject: `  Subject for ${CONTACT_TOKEN}  `,
      bodyHtml: `<p onclick="x()">Hi ${CONTACT_TOKEN}</p><script>x()</script>`,
    }, { deliverable: true });
    await compareChannel("notifier email (blank subject)", "email", {
      subject: "   ",
      bodyHtml: "<p>body</p>",
    });

    // The rule itself, independent of any notifier's default templates:
    // a blank required field means nothing is delivered, and a blank
    // link takes its label with it.
    const blankRequired = applyFieldEligibility(NOTIFIER_CHANNEL_FIELDS.inapp, {
      title: "",
      body: "b",
      linkUrl: "",
      linkLabel: "Open",
    });
    check("shared shaping — blank required field means nothing is delivered", !blankRequired.deliverable);
    check("shared shaping — label dropped with its link", !("linkLabel" in blankRequired.values));

    await compareChannel("notifier sms", "sms", { message: `  Hi ${CONTACT_TOKEN}  ` }, { deliverable: true });
    // A blank custom field falls back to the notifier's default
    // template, so "blank" here does not mean "nothing is sent" — only
    // parity with whatever delivery decides is asserted.
    await compareChannel("notifier sms (blank message)", "sms", { message: "  " });
  }

  return finish();
}

function finish(): never {
  console.log(
    failures === 0
      ? "\nPASS: previews match delivery for every checked surface field"
      : `\nFAIL: ${failures} parity problem(s)`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("Parity check failed to run:", error);
  process.exit(1);
});
