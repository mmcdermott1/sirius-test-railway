---
name: Token editing invariants
description: Owner-stated rules for where tokenized strings are edited, what a token evaluation is, and whose job it is to clean the result.
---

# Token editing invariants

Owner-stated, authoritative. These are product invariants, not code
observations — the code has drifted from them before and will again.

## The studio is the only door

A user only ever edits a tokenized string inside the Template Studio.
Any token tooling at all — picker, tree/browser, live validation,
preview, context — means you are in the studio. There is no second door.

**Why:** every piece of token tooling has to agree about roots, gating
and shaping. A second surface with its own half of the tooling is a
second, quietly divergent answer to all of it.

**How to apply:** when a host wants token help in its own popover or
inline editor, that is a request to open the studio, not to grow a
parallel one. Two adjacent things are NOT this case and stay allowed:
editing the *result* of an evaluation (plain text, no tooling), and
raw-editing a tokenized string with no tooling at all.

## Evaluation is a medium-independent string operation

A token returns text. It does not know or care about the destination.
The token catalogue is deliberately medium-independent: tokens do not
vary by medium — *shaping* does.

**How to apply:** never branch a token's own evaluation on email vs SMS
vs in-app. Push the difference into the container that receives the text.

## Cleaning belongs to the container, and ignores position

Cleaning the rendered text for its destination is the container's job.
A clean callback may be told the value **and which token produced it**,
so a container can treat different tokens differently — and nothing
else.

Cleaning must NOT depend on a token's position in the surrounding
template. A token's value must not change because of what the author
typed before or after it (position-aware sanitization was proposed and
rejected outright).

**Why:** the goal is modest and local — `Sam > Nelson` should render as
`Sam &gt; Nelson`. The goal is NOT guaranteed-valid markup, and NOT that
a page can never render badly. Aiming at those is what tempts you into
reading the surroundings.
