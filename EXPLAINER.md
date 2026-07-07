# What you just watched

One page, for the person who ran the demo and wants to know what it actually proved.

## The claim

An AI agent acted five times. Before each action, a **deterministic gate** — a fixed
pipeline of checks, no model — decided whether the agent had the authority to act.
Every decision was signed and hash-linked into a **proof chain** you can carry away
and verify on any machine, with no Vorion service involved.

## What each record field proves

| Field | What it proves | Audit question it answers |
|---|---|---|
| `agent.id`, `agent.tier` | Which agent, at what authority level | *Who acted?* |
| `agent.credential.status`, `expiresAt` | The credential state **at decision time** | *Was it authorized then — not now, then?* |
| `action.domain`, `action.capability` | Exactly what was attempted | *What did it try to do?* |
| `action.paramsHash` | A commitment to the exact parameters (raw params never enter the record) | *Were the details what they claim? Recompute the hash and compare.* |
| `policy.id`, `version`, `hash` | The exact policy document evaluated | *Under which rules was this decided?* |
| `verdict.decision`, `reason` | The outcome and the machine-readable why | *What happened, and why?* |
| `verdict.latencyMs` | Single-digit milliseconds — no model inference in the path | *Could an LLM have made this call? No: too fast, and none is wired in.* |
| `verdict.linksTo` | Human resolutions point at the escalation they resolve | *Who approved/denied the exception?* |
| `ts` (monotonic) | Order of events | *In what sequence?* |
| `prev` (hash link) | Nothing was inserted, removed, or reordered | *Is the history complete?* |
| `sig` (Ed25519) | Nothing was altered after signing | *Is the history authentic?* |

## The three moments, replayed

**The escalation (#3).** The $250,000 payment exceeded the tier-2 cap ($10,000). The gate
did not ask a model for an opinion — it compared a number to a cap and emitted
`ESCALATE / TIER_CAP_EXCEEDED`. A human clicked Deny (or Approve); either way the
resolution was signed into the chain with a link back to the escalation record.
Accountability is structural, not procedural.

**The expiry (#5).** The credential's TTL ran out on screen. The very capability that was
allowed at #2 (`ledger.write`) was denied at #5 — same agent, same action, zero remaining
authority. Fail-closed means authority is something you *have*, not something you *had*.

**The tamper.** Changing one hash character in record #3's `paramsHash` broke signature
verification at exactly that record. Not "the file looks different" — a cryptographic
proof of *where* the history diverges.

## Verify it yourself, right now

```bash
npx @vorionsys/verify chain.json --keys keys.json
```

No network access is used or needed — the verifier has no HTTP client in it. The static
`verifier.html` does the same from `file://`.

## Why this matters for compliance

Emerging AI-governance regimes (e.g. Colorado SB 26-189-style algorithmic accountability
provisions) converge on the same questions: who acted, under what authority, by which
policy, with what oversight, and can you prove the record is complete and unaltered.
Each of those maps to a field in the table above. The proof chain is that evidence,
generated as a side effect of the gate doing its job — not reconstructed after the fact.

---

Spec: [`basis-spec`](https://github.com/vorionsys/basis-spec) ·
Record schema: [`contracts`](https://github.com/vorionsys/contracts) ·
Verifier: [`basis-verify`](https://github.com/vorionsys/basis-verify) ·
[vorion.org](https://vorion.org)
