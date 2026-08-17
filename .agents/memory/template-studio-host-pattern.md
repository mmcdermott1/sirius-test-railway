---
name: Template Studio surface pattern
description: How tokenized-text editors preview, and the delivery-parity contract a template surface promises
---

Every tokenized-text editor previews through ONE server route, keyed by a registered *template surface*. Callers supply a surface id, the in-progress values and a context object — never their own preview fetcher or response normalization.

**Rules learned:**
- A surface exists for **delivery parity**, not access control: it declares how each field is shaped and nothing about who may look. Preview access is one staff-level gate.
  **Why:** a preview that renders differently from the sent message is a bug; per-surface gating was duplicated access logic protecting nothing (the delivered message exposes the same data).
- Declaring a field's shaping is a *claim about the delivery path*, and the claim is usually wrong the first time. Before declaring one, read what delivery actually does to that exact field — including whether it renders tokens at all. Fields whose editor offers no token insertion are delivered verbatim and must preview verbatim; a field can be tokenized on one channel and literal on another.
  **How to apply:** when preview and delivery disagree, fix delivery to match the shaping the editor implies (that is what the author expects), and route both paths through ONE shared function so they cannot drift again.
- Shaping is more than "what kind of content is this": whitespace trimming, blank-value fallbacks and "this channel sends nothing when a required field is empty" are delivery behaviour too, and a preview that ignores them lies in ordinary cases (padded text, a padded-but-valid link, a whitespace-only title). Declare them per field alongside the media, and have delivery read the same declarations.
- Guard parity with a test that renders through the preview pipeline and the delivery function and compares, using content the shaping really changes **and** ordinary content it must leave alone — otherwise "no shaping at all" and "over-sanitizing" both pass vacuously. Substituting a real token value matters: unknown tokens render identically on both sides and hide a missing render step.
- A field whose value blanks out can suppress a companion field (an in-app link label follows its link URL). Express that on the field spec so every surface inherits it, and assert both paths drop the pair together.
- A surface only needs its own client host when it has *editor-side* logic (e.g. default-vs-override text). Previewing never justifies a host.
- Token catalog endpoints are gated differently from preview (generic catalog is admin, the bulk catalog is bulk-permission), so the catalog URL must stay per-caller overridable even though preview is plain staff.
- Event-scoped token catalogs: the event root and per-kind relation plugins are hidden from the catalog, so the event-root walk must use the FULL registry, not the visible subset.
- Real-record preview is a property of an **entity kind**, never of a notifier or surface: the kind's token plugin declares its own search/load in metadata and every editor rooted at that kind inherits it. Payload-snapshot notifiers simply have no provider for their kind.
- The eval context seeds a **bag of roots keyed by kind** (plus the recipient contact), and sample-vs-real is decided per root at the chain's root segment: an unseeded root samples, a seeded one resolves real, so one render honestly mixes both.
  **Why:** a single global "sample" flag made real preview all-or-nothing and reachable only by relation-walking from contact-or-event.
  **How to apply:** delivery never enables sample fallback, so per-root logic must live behind that flag or delivery starts rendering examples. A root that needs no record (system values) must follow the render instead of always sampling.
- A delivery-parity check must seed the very root delivery composes with; otherwise the unseeded root samples and parity fails for a behavior that is correct.
