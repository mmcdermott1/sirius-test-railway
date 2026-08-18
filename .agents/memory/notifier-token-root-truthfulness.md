---
name: Notifier token roots must be truthful
description: Why a token root's name must be its entity kind and why flattened extras are a delivery-only failure; how a rename must migrate stored templates.
---

# A token root's name and fields are a promise about a record

A notifier declares named record roots; the token field catalog is built from what
a root DECLARES (its kind's table columns + any extras), not from what its
`build()` actually returns.

## The failure mode this creates
A field that is advertised but absent from the built row:
- passes save-time validation,
- renders a REAL value in the Template Studio preview (previews seed real rows
  from `recentRecords`, which may merge extras delivery never merges),
- and arrives BLANK in the delivered message.

Nothing anywhere reports it. This is the one gap author-time static checks
cannot see, so there are two guards: a static check on the declarations and a
development-only runtime comparison of the built row against the catalog at
seed time.

## Rules
- **Root name IS the entity kind.** A shortened/prettified name describes the
  record as something it is not, and template authors then write fields that
  belong to the thing the NAME suggests rather than the row it holds.
- **No extras named after a related record's value.** Reach the related record
  (relation hop, or seed it as its own root). An extra only resolves for as long
  as every seeding path remembers to merge it.
- **Load the specific row the event names**, not "the entity's current X" —
  re-deriving at delivery time races later mutations. That requires the event
  payload to carry the row id.
- If the row is gone by delivery, return null and skip the notice: there is
  nothing truthful left to say.

**Why:** the grievance status notifier shipped a root named `grievance_status`
holding a `grievance_status_history` row with `grievance_title`/`status_name`
flattened on; both were fabricated and one duplicated what the status FK already
renders.

## Renames must migrate stored templates
Default templates live in code, but admin-customised ones are stored verbatim in
`plugin_configs.data.templates` and rendered verbatim. A rename without a
boot-time rewrite turns every customised token into `[unknown token: …]`.

**How to apply:** rewrite the PARSED chain (shared `TOKEN_PATTERN` +
`parseTokenChain` + re-serialize), never a text regex — the grammar allows
arguments in any order, arbitrary whitespace, and quotes/braces inside argument
values, and a text rewrite corrupts exactly the templates someone bothered to
customise. Leave unparseable tokens verbatim; the rewrite must be idempotent and
must not write unchanged configs.
