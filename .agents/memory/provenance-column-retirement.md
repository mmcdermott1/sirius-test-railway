---
name: Retiring a bespoke provenance column
description: What a "retire table X's created_at/created_by" task actually costs — the seed migration, the ordering join, and the two nulls the reads must survive.
---

Retiring a table's own `created_at` / `created_by` columns into `entity_metadata`
is the same shape every time. `docs/provenance-columns.md` is the inventory and
the decision rule; this is what the doc does not say.

## The reads are the hard part, not the drop

A column that only DISPLAYS is easy. A column the queries ORDER BY becomes a
`LEFT JOIN entity_metadata ON entity_id = <record>.id AND table_name = '<table>'`
in every read that ordered by it — and the join has to carry the table name, or
a provenance row belonging to another table can answer.

**A descending sort on the provenance date puts unstamped rows FIRST**
(Postgres DESC defaults to NULLS FIRST), and that is the right place for them:
provenance is written after the capturing transaction commits, so the row with
no stamp yet is the one that was just written. Keep a `desc(id)` tiebreak so a
page boundary is stable. Paging over provenance-ordered rows is not stable
against a stamp landing mid-walk; say so where the pager lives.

**Check which method the live route actually calls before moving a sort.** A
storage method that orders by the column may have no caller at all, while the
list a user sees is ordered by a business date (a job's start date) and must
not change. Porting the provenance join into an uncalled method is worse than
useless — delete the dead method instead, and leave the visible ordering alone.

## Two different nulls, and neither is an error

- **No date** — the framework never wrote history for that record (best
  effort). The row still exists and must still list; say "not recorded" rather
  than invent a time.
- **No person** — a system path with no signed-in user did the write, or the
  account is gone. `withSystemActor`-style paths are normal, so "nobody" is a
  real answer.

**Why:** a retirement that fills either null with a guess (a synthetic user, a
fabricated `now()`) destroys the distinction the framework exists to record.

## What the seed migration can and cannot recover

`storage.entityMetadataSeed.seedFromColumns` takes date and person columns,
wraps its own transaction, is idempotent, and skips a missing table/column
non-fatally. It reads the person column THROUGH `users`, so a stale id becomes
nobody rather than an FK failure.

A denormalised NAME column (`author_name` and friends) is not seedable — the
framework names a person and resolves their current name at read time, which is
the point. Drop it; do not try to preserve the frozen string.

## The change is not done until

The three `<table>.<column>` rows leave the allowlist in
`scripts/dev/check-provenance-columns.ts` AND the RETIRE table in
`docs/provenance-columns.md` — the lint rule fails on an allowlist entry naming
a column that no longer exists, so leaving them behind breaks the gate.
