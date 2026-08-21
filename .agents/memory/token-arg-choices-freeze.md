---
name: Token argument choices are frozen at registration
description: Why a token argument naming a runtime-minted id must stay free text, and how a leaf's reach is scoped
---

# Never declare `choices` for a token argument whose values are minted at runtime

A `TokenArgSpec.choices` list is read from the plugin's metadata, which is
built once when the plugin registers at boot. Chain validation checks a
supplied value against the COMPLETE declared list and rejects anything
outside it.

**Why:** if the list is populated from the database (ledger accounts,
plugin configurations, options rows), every record created after boot is
absent from the frozen list, so a template naming a brand-new record is
rejected as invalid until the process restarts. The author sees a valid
id called invalid, with nothing in the UI explaining why.

**How to apply:** declare `choices` only for a closed set that is part of
the code (media names, a fixed enum of formats). For an argument that
carries an id a user can mint — a sirius id, a config id, an account
number — leave it free text and resolve it at render time, returning null
when it does not resolve.

# A leaf's reach is by ENTITY KIND, not by root

`inputTypes: ["employer"]` means "any chain that has arrived at an
employer", which includes hops such as `worker.home_employer.<leaf>`. It
does NOT mean "only a chain that starts at the `employer` root": there is
no root-scoping mechanism on a leaf, and adding one would be a framework
change.

**Why:** this reads like a containment hole in review, but it is not one.
The leaf reads the employer it was handed, exactly as `employer.name`
does on the same chain — an author who can hop to that employer can
already read its fields.

**How to apply:** when a requirement says a token is reachable "only from
X", check whether it means the entity kind (what `inputTypes` gives you)
or the root. Kind is the normal reading, and the three things worth
verifying are: rejected as a bare root, rejected after a non-X entity,
accepted after any chain arriving at X.

# Half-resolved sentences

A leaf that composes prose from several lookups must return null when ANY
of them misses, so the chain renders the author's `defaultValue` (else
blank). A partial sentence with a name missing reads to the recipient as
a statement of fact.
