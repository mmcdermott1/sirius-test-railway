---
name: Template preview contexts (sample personas + real records)
description: How template previews may reach real data — the two context forms, how the real-record form is gated per entity kind, and how named sample personas are keyed by entity kind.
---

# Preview contexts

A template preview renders against either a **named sample persona** or a
**context the caller supplies in the request**. There are exactly two
context forms:

- **raw root values** — a JSON object of named root values the author
  already has on screen, rendered as LITERAL TEXT.
- **an entity reference** — a real record named by kind and id.

The raw form is accepted on the route's plain staff gate with no
per-record check, which is only defensible while it cannot reach a
record — and by default it CAN. Token plugins traverse to related
records by reading a foreign key off the row they stand on, and a seeded
contact's `id` becomes the render's recipient (from which every
recipient-rooted root loads for real). So a raw row is vetted before it
is seeded: **scalar values only** (a nested object is a smuggled record)
and **no identifier keys** (`id`, `*_id`, `*Id`), refused rather than
stripped. With no ids on the row there is nothing to traverse, relations
resolve to null, and those roots honestly fall back to samples. A raw
seed also carries no Drizzle table, so `field()` never follows a foreign
key to a named row either.

**Why:** without that vetting, a staff caller forges `grievanceId` on a
root and reads back any grievance through the relation — walking around
the very gate the entity form exists to apply. `scripts/dev/test-preview-context-safety.ts`
(workflow `preview-context-safety`) drives the real route and asserts
the seam stays closed.

Previewing against a real record IS a read of that record, so it is
gated exactly like any other read of it: the token entity kind's own
declaration says which access policy applies, and the same id is both
checked and loaded (no split authz/data lookup). **Fail closed:** a kind
that has not declared how it is gated cannot be used as a preview
context at all, so adding a token entity kind never quietly adds a new
way to read its records.

**Why:** an earlier design let the *editor* own the offer list — it
listed a few of its own recent records and re-listed on resolve to
authorize ("the offer IS the authorization"). That stitched three
different access models behind one endpoint and made the preview
endpoint's real gate invisible. Before that, any Studio user could
search and render *any* record of a kind — a PII hole.

**How to apply:** when a surface wants to preview against real records,
declare the gate on the token plugin that owns the KIND (one
declaration, inherited by every editor rooted at that kind) — never a
per-editor offer list.

## Sample personas are keyed by the entity kind that OWNS the leaf

Persona values are declared per token entity kind and looked up with the
`field(name=…)` argument, or the leaf's segment name for non-field
leaves. A chain like `{{worker.member_status}}` desugars to the
`member_status` kind's default leaf — so a `member_status` key on the
*worker* persona is dead weight and never renders. Declare the value on
the plugin that owns the produced kind, reusing the same persona id so
one pick tells one coherent story across kinds.

**How to apply:** the author check (`scripts/dev/check-token-sample-data`)
enforces this — every persona key must be a field of its kind or a value
leaf reading it, and the whole catalog is re-rendered once per persona.

A persona only earns its place if the DEFAULT templates render visibly
differently under it: a default that touches only fields no persona names
makes the picker look broken. Give each persona a distinct value for every
field the defaults use, including the record `id` behind a link path.

## Seedless (system) roots are never sampled

A root with no record behind it (`system` — site origin, today's date)
resolves for real in EVERY render, all-sample previews included. Its
values are identical in a preview and at delivery, and faking them hides
exactly what the author is previewing to catch: an unclickable link and a
wrong date format. Consequence: `preview.sample === true` means "every
RECORD is a sample", not "nothing here is real" — don't reintroduce a
consumer that reads it as the latter, and keep the studio's sample note
honest about it.
