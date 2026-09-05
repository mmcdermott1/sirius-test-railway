---
name: Retiring a timestamp column that screens actually read
description: How a bespoke created/updated column moves into entity_metadata when lists show, sort and filter on it, and how an upsert declares which of create/modify it did.
---

# Retiring a creation column the UI reads

Most bespoke provenance columns are dead weight and just get dropped. One that a
list **shows, sorts by and filters on** is different: the read has to land
somewhere before the column goes, and the two candidate landing places are not
interchangeable.

**A list read joins `entity_metadata`; a single-record screen asks the record's
history endpoint.** A list cannot make one HTTP call per row, so its query
left-joins provenance on `(entity_id = <table>.id AND table_name = '<table>')`
and exposes the date as an ordinary field on the row. A detail page already has
the record-history badge on it, so it reads the same query the badge does
(shared client hook) rather than inventing a second source. Naming the joined
field something *new* is deliberate: the old field name disappearing from API
responses is the proof no response still promises the retired column.

Always include `table_name` in the join even though `entity_id` is unique — a
row naming another table is not this record's history.

**Sort order has to decide what a missing stamp means.** Provenance is written
after the insert commits, so a just-created record can legitimately have no row
for a moment. For a newest-first list that makes NULL the *newest* thing there
is (`DESC NULLS FIRST`), not the oldest.

**Why:** the column is the only copy of the date. Seeding must precede the drop
in the *same* migration, or a deployment that runs the drop alone answers "when
was this made" with a blank forever.

**How to apply:** seed each table with the shared seeding routine, then
`ALTER TABLE ... DROP COLUMN IF EXISTS` it, table by table, so a part-way
failure leaves every table in a re-runnable state.

# An upsert has to be asked which thing it did

The storage logging middleware infers creation from the method NAME
(`create*` / `delete*`, everything else "modified"). An `upsert` is invisible to
that rule and a static override lies in one direction or the other: mark it
`created` and every later repair restamps the record with whoever repaired it;
leave it `modified` and the one moment the real author was observable is thrown
away.

The framework therefore accepts a **function** for `metadataMode`, handed the
same `(args, result, beforeState)` every other logging hook gets. A config with
a `before` hook that looks the record up answers `beforeState ? 'modified' :
'created'` and is right both times.

**Why:** provenance fills a null creator with COALESCE, so a wrong `created`
does not merely mislabel one event — it permanently names the wrong person as
author of a record created long before.

**How to apply:** any storage method whose name does not say what it did
(`upsert`, `set*`, `ensure*`) and whose table carries provenance.
