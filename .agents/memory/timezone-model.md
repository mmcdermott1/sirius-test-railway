---
name: Timezone model
description: Naive timestamp columns store wall clock in the process zone; the site zone is process.env.TZ, not a threaded parameter. Why converting to timestamptz was rejected.
---

# How time zones work here

## The storage contract (verified, not assumed)

Core tables use `timestamp without time zone`. The driver serializes a JS Date
using the **process local offset**, and the naive column keeps only the
wall-clock fields; reading it back reinterprets those fields in the process
zone. Measured:

```
TZ=<unset>            12:00Z -> stored 12:00     "08:00" read back -> 08:00Z
TZ=America/New_York   12:00Z -> stored 08:00     "08:00" read back -> 12:00Z
```

Writes and reads agree as long as the process zone is stable, and the process
zone is the *only* thing that decides what stored history means.

**The matching hazard:** a column default of `now()` is evaluated by POSTGRES,
using the *session* TimeZone, not Node's. If the two disagree, app-written
timestamps and defaulted ones land in the same column offset from each other.
Both zones must be set together — the pg pool sets the session zone on every
connection checkout.

## The decision

The site zone is `process.env.TZ`, registered as an environment variable and
applied once at boot. Storage is not zone-aware and must not become so.

**Why:** setting the process zone fixes day buckets, cron schedules, heartbeat
day boundaries and all server-side formatting in one line, with zero call-site
changes — because it is the mechanism the naive-column schema already assumes.
The alternative (columns to `timestamptz`, or threading a zone through the
storage layer and ~270 display sites) was priced out and rejected by the owner
as far more expensive than the problem.

**Accepted costs — these are not bugs, do not "fix" them:**
- Changing the site zone re-interprets ALL stored history by the offset.
  Expected to happen approximately never after installation.
- If the zone observes DST, the repeated fall-back hour stores
  indistinguishable, unorderable rows. Recurs annually; accepted as small.
- The dispatch seniority date is `timestamptz` and so behaves differently from
  every other column under a zone change.

**Do not** reach for the shortcut in reverse either: nothing may set `TZ`
casually, because it silently rewrites the meaning of the whole database.

## Boot ordering: an in-app override must be read before the first write

The site zone can be supplied either by the real environment or by an in-app
override row, and override rows live in the database. The normal override cache
is installed *after* the schema bring-up — far too late, because migrations and
boot-time seeding already wrote timestamps by then, and a zone applied
afterwards cannot repair rows written in the old one.

**The rule:** anything that must be in force before the first write cannot wait
for the override cache. Read its single row directly, fail-soft (the table may
not exist on a first install, and the database may be unreachable — both are
the bring-up's failure to report, not the peek's), and keep the later cache
read as a no-op safety net that warns if it ever actually moves the value.

**Generalizes:** the same shape applies to any future setting that changes the
meaning of what gets written rather than merely how the app behaves.

## The browser half

There is no client-side equivalent — the resolved zone is read-only and no API
changes it. Per-user display zones are therefore done by centralizing
formatting: the built-in locale formatters can be redirected globally at the
entry point (no file edits), but the date library's `format` reads raw local
field getters and cannot be. Redirecting those getters at the prototype level
would corrupt date *arithmetic* (the library round-trips through them
internally) — that approach is off the table; the library's imports get swapped
to a project wrapper instead, held in place by an architecture-lint rule.
