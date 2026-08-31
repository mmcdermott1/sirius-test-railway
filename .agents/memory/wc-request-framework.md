---
name: Web client (wc) request framework
description: Durable design rules for the single outbound-third-party-request wrapper — caller-declared outcomes, the fourth "local" mode, DB-backed failure holds, and the one hold that must stay in memory.
---

# The wc framework's load-bearing decisions

"wc" is the outbound counterpart to the inbound "ws" web-service tooling: ws is
other systems calling us, wc is us calling them. One wrapper, one cache table,
one behavior registry keyed by (service, request type).

## The caller declares whether the vendor answered

**Rule:** the callback returns an explicit `answered` flag. The wrapper never
infers success from "nothing was thrown".

**Why:** several of our transports catch their own transport failures and
return a locally-derived answer instead. It does not throw and it looks like a
real response — the only tell is a missing enrichment field. Inferring success
there stamps a record fresh on a call that never reached the vendor, and the
freshness window then buys months of silence on a lie.

**How to apply:** any new adopter must look for the vendor's own fingerprint in
the response (the field only a real answer carries), not for the absence of an
exception. A vendor answer meaning "no such record" is `answered: true,
store: false` — a real answer that must not be remembered.

## Four modes, and the fourth is not cosmetic

`default` / `force` / `cached-only` / `local`.

**Why `local` exists:** argument normalization runs through the same code that
reads the cache, and the cache row can live on the very entity being read. A
mode that reads neither the cache nor the network is what stops those two from
waiting on each other, and it is also the mode on the hottest per-row paths, so
it must skip the query as well as the call.

**Why `force` ignores the failure hold:** it is the mode for a person pressing
"refresh" because they believe the stored answer is wrong. Honouring the hold
there hands them the same stale answer while reporting a fresh check.

## The failure hold belongs in the table, not in a process

A failure is stored as its own outcome with its own short window. That is the
hold: it survives a restart and every process observes the same one, which an
in-process map cannot do.

**The one exception that must stay in memory:** the writable-database gate
passed, the vendor was asked and answered, and the write then failed. The money
is spent and the database that just refused a write cannot hold a failure row
either. That single case is remembered in memory for the failure window. Do not
"clean this up" into the table — the table is exactly what is unavailable.

## A failure must not destroy a still-fresh success

The failure upsert carries a guard: it only overwrites a success that is
already past its freshness window. Without it, one forced revalidate during a
vendor outage throws away an answer we paid for and would still be serving.
When a call fails and a stored success exists, the wrapper returns the stored
success rather than the local fallback.

## Everything is judged at read time

Freshness windows are resolved on every request, not captured at registration,
so a shortened setting bites now rather than only on entries written
afterwards. A window that is a configurable setting therefore has to be a
function, and its settings read has to be memoized somewhere both the validator
and the registry share — two different answers to "is this stale" means a
caller asks for a call the wrapper then refuses to make.

## Force-expiring an entry means forgetting it

**Rule:** an operator expiring one cached entry deletes the row. There is no
stored expiry to back-date, and back-dating `fetched_at` would make the row
claim the vendor was asked at a time it was not.

**Why:** the person expiring an entry believes the stored answer is *wrong*,
not merely old. Leaving the row behind would let "a failure must not destroy a
still-fresh success" serve that same answer back as the outage fallback.

**How to apply:** the same holds for any future bulk expiry, and it works
unchanged on a row whose (service, request type) is no longer registered —
removing a row needs no window.

## The request key is the uniqueness contract

Every option that changes the SHAPE of the answer belongs in the canonical key.
An option left out means two different requests collide on one row and the
second caller silently gets the first one's answer. An option that only changes
the *shape of the request* (a fixed field set we always ask for) belongs in the
request TYPE instead.

Uniqueness is carried by a hash column, not the key itself: keys are canonical
strings that can run to a full postal address, and a btree entry has a length
Postgres refuses rather than truncates. The readable key is kept alongside for
browsing. A SQL-side backfill can produce the same hash with
`encode(sha256(convert_to(key,'UTF8')),'hex')` — verified to match Node's
`createHash('sha256').update(key,'utf8')`.

## Adopting a call that already has a cache

Carry the answers already paid for into the table in the same migration that
creates it. If the cache starts empty, the first read of every record buys the
answer again. The old columns stay where they are when a UI reads them; they
become a derived write that happens as the cache fills, not the cache.
