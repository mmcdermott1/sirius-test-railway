---
name: Entity page title bars
description: Record pages share no header component, so "on every entity page" is a per-wrapper sweep — and each wrapper hides three near-identical headers.
---

# Entity page title bars

Record pages share no header. Each kind of record has its own layout wrapper
that hand-rolls its title bar; the generic `PageHeader` with its right-hand
slot belongs to list and section pages. "Put X on every page that shows a
record" is therefore a sweep of every wrapper, not one edit.

**Why:** the wrappers grew one per entity, each with its own back link, badges
and subtitle line, and nothing ever forced them through a common component.

**How to apply:**

- **The trap:** a wrapper typically holds THREE near-identical headers — record
  not found, loading skeleton, and the real one — differing by a few words. A
  sweep (especially a delegated one) lands the new element in the not-found
  header, where the record is undefined. Typecheck catches that only where the
  record's type is still nullable at that point; elsewhere it compiles and
  ships. Check every header in the file, not the first one that matches.
- Not everything in that directory is a record page: section wrappers and ones
  keyed by a type name or a job name have no record id.
- A cross-cutting element should take only the record id and fetch its own
  data, so the sweep stays one line per file and no wrapper learns the feature.
