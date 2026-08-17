---
name: Template preview subjects (sample personas + surface contexts)
description: How template previews may reach real data — surface-owned contexts, their authorization, and how named sample personas are keyed by entity kind.
---

# Preview subjects

A template preview renders against either a **named sample persona** or a
**context the surface itself offered**. The client never names a record
id: it posts back only a context id the surface just handed it, and the
surface re-lists to authorize on resolve ("the offer IS the
authorization"). Any future "let me preview against record X" request
must go through a surface that can authorize X, not through a generic
per-kind lookup.

**Why:** the earlier design let any Studio user search and render *any*
record of a kind — a PII hole that no per-kind record picker could fix.

## A surface's context hooks carry their own authorization

The preview routes are gated at the lowest common bar (staff) because
several surfaces share them. That gate is NOT the editor's gate: notifier
templates are admin-only, bulk-message recipients are `bulk.edit` data.
So each surface's `listPreviewContexts`/`resolvePreviewContext` must
check the access its own editor needs, before touching data, and return
`[]`/`null` when denied. Re-listing on resolve is worthless if the
listing itself was never authorized.

**How to apply:** when adding a template surface that offers real
records, ask "which route gates the page this editor lives on?" and
check that same policy inside both hooks.

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
