# basis-demo

> The BASIS Quarter-Close demo — a gated finance agent gets allowed, escalated, and denied
> in five actions, and hands you a proof chain you can verify offline with no Vorion server in the loop.

**Status.** Nine scripted scenarios, two operator branches, and a seed-derived gauntlet run in this repo; `npm run build && npm run e2e` prints `E2E PASS — 9 scenarios + 2 branches + gauntlet`.
Public anchoring stays off unless `BASIS_DEMO_ANCHOR` is exactly `1`.
Open: `npm audit --omit=dev` reports 4 high runtime findings, all from `zod` below 4.6.6 via `@vorionsys/contracts`, `@vorionsys/verify`, and `@vorionsys/gate-core`; npm reports no fix inside the current ranges (see Known issues).

![license](https://img.shields.io/badge/license-Apache--2.0-blue)

This repository is not what `https://demo.basis.vorion.org` serves. On 2026-10-30 that host returned HTTP 307 to `https://demo.vorion.org/`, whose title is "Vorion Mission Control — live AI-agent governance, across regulated industries". `https://demo.vorion.org/keys.json` returned 404. Run the demo locally.

## Nine scenarios, one gate

`lib/scenario.ts` exports nine scripts (`SCENARIOS`). Taglines below are copied from that file. The e2e oracle in `scripts/e2e.mjs` drives these nine, plus a deny branch of Forward-Resupply, a reject-evidence branch of Release-Engineering, and a seed-derived gauntlet (`lib/gauntlet.ts`, id `gauntlet`) that is not one of the nine.

| Scenario | Vertical | Tagline in source |
|---|---|---|
| **Quarter-Close Agent** (flagship) | Finance | A tier-2 finance agent closes the quarter: a $250k payment escalates to a human, an off-list vendor call is denied, and a mid-run credential expiry drops authority to zero. |
| **Incident-Response Agent** | Cybersecurity | A tier-2 SOC agent contains a breach: isolating one host is within authority, isolating 250 needs a human (who approves), and a mid-incident credential revocation stops a disk wipe cold. |
| **Patient-Records Agent** | Healthcare | A tier-3 care-coordination agent works a shift: a 5,000-record bulk export escalates (privacy officer denies), an external analytics call is refused, and an unbadged agent gets zero authority. |
| **Contract-Award Agent** | Gov Contracts | A tier-3 acquisition agent scores proposals, then a $1.8M award needs TWO signed approvals (dual control) — the 1-of-2 approval is visibly still pending in the chain — and a novation attempt is denied outright: the tier was never granted that capability. |
| **Loan-Origination Agent** | Lending | A tier-2 underwriting agent records loan decisions: a prohibited decision basis (applicant zip code) is denied by policy — the fair-lending check — and a chain-derived velocity cap stops the fourth decision in a minute. No human in this one: pure deterministic policy. |
| **Grid-Ops Agent** | Energy | A tier-2 grid agent rides through a storm: setpoint trims are in-authority, shedding 40 feeders escalates (operator denies), a firmware push was never granted to this tier, and an expired credential ends the shift. |
| **Forward-Resupply Agent** | Defense Logistics | A tier-2 resupply agent stages a forward munitions package: an off-geofence route is denied, a 120,000-round release collects BOTH signed approvals and the gate still denies it — the dual-control ceiling is 50,000 rounds; approval is not authority — then a self-issued export waiver and a salami-sliced second release are stopped cold. |
| **Claims-Processing Agent** | Insurance | A tier-2 claims agent works the morning queue: small claims auto-pay, a genetic-screening decision basis is refused outright, a $48,500 payout escalates and the senior adjuster approves — but the $25,000 approval ceiling still denies it — and a payout surge trips the chain-derived velocity brake. |
| **Release-Engineering Agent** | DevOps | No agent has final say: the deploy is denied until the chain proves the work was CHECKED — by a different principal, committing to the actual test evidence, validated by a human. Then the attestation rots and the next deploy is denied again. |

Same gate, same record format, same verifier — only the policy document and script change.
The flagship Quarter-Close steps (`lib/scenario.ts`, default path). Step numbers here start at 1. The page labels records from 0, so the escalation is record `#2` on screen.

| # | Action | Verdict | Reason |
|---|--------|---------|--------|
| 1 | Read Q2 ledger | **ALLOW** | `WITHIN_AUTHORITY` |
| 2 | Write $1,842.17 reconciliation | **ALLOW** | `WITHIN_AUTHORITY` |
| 3 | Execute $250,000 vendor payment | **ESCALATE** | `TIER_CAP_EXCEEDED` (tier-2 cap: $10,000) |
| 3b | Operator resolves #3 | **DENY** (or ALLOW) | `HUMAN_DENIED` / `HUMAN_APPROVED` — links to #3 |
| 4 | Call unapproved vendor API | **DENY** | `DOMAIN_NOT_ALLOWLISTED` |
| 5 | Write closing entry after credential expiry | **DENY** | `CREDENTIAL_EXPIRED` — fail closed |

Three things to notice while it runs:

1. **Deterministic** — the e2e fails if any `verdict.latencyMs` is 50 or more (`RUNTIME_INVARIANTS.maxLatencyMs`). No LLM evaluated any decision on the page.
2. **Fail closed** — a visible 15-second credential TTL (`ttlSeconds: 15`) runs out between #4 and #5;
   the same capability that was allowed at #2 is denied at #5. The server refuses #5
   until the clock has actually passed expiry — the countdown is real, not theater.
3. **Tamper-evident** — download `chain.json` + `keys.json`, verify offline, then use the
   in-page tamper control. It flips one character of the first escalation record's `paramsHash`
   (quarter-close index 2, labeled `#2` on the page) and verification fails on that record.

## Key pinning — don't take our server's word for the key

`/keys.json` is served by the same server that signs, so on its own it proves
integrity of the chain under whatever key that process holds, not an identity you
learned somewhere else. The kid in `lib/server-gate.ts` is `vorion-demo-2026-07`.
The public key and fingerprint below match each other: SHA-256 of the 32 decoded
key bytes is the fingerprint. This process serves that key only when `BASIS_DEMO_SK`
is the matching private key. With `BASIS_DEMO_SK` unset, each process generates a
new key, and `/keys.json` will not match this table.

| Channel | Value |
|---|---|
| kid | `vorion-demo-2026-07` |
| Ed25519 public key (base64) | `TKTwRU35rdqRuyVJ0RjCLsjLpFMiIhxn2ymCH453KWY=` |
| SHA-256 fingerprint | `a84a2d6a2e467895447211b2666296de998f10a564f8c7bb34e30c6567ceca92` |

There is no DNS pin. On 2026-10-30, `TXT basis-demo-key.vorion.org` was NXDOMAIN
(`vorion.org` has a Cloudflare SOA; that name does not exist). If `/keys.json`
disagrees with this table, trust neither.

## Public anchoring is off

**Anchor tip to public log** is disabled in the UI. `POST /api/anchor` returns 403
unless `BASIS_DEMO_ANCHOR` is exactly `1` (see `.env.example`). The fetch to Rekor
stays in the server code so the path can be turned back on later; both the route
and `anchorTip` refuse before any network call when the flag is unset.

If the flag is set, the button posts three things to the
[Sigstore Rekor](https://rekor.sigstore.dev) log (`kind: rekord`), not a hash:

- the full last decision record (canonical JSON of that record)
- the Ed25519 signature over that JSON
- the signing public key

Rekor is append-only and public, operated by the OpenSSF, so the write is
permanent. The demo's records are made-up data only. Do not point this at a
chain you would not publish.

The versions this demo's lockfile installs publish an npm provenance attestation
(SLSA v1) read from the registry. Each statement names a git commit and a GitHub
Actions run: `@vorionsys/verify@0.6.0` commit `39bd0014701da20277626ffbfccc0abd08b2a8d4`
(run 29221025077), `@vorionsys/contracts@1.6.1` commit `86a180ba31f2467c1b3349636ee05649a9e1d63a`
(run 30041028556), `@vorionsys/gate-core@0.6.0` commit `c8257cd94b817d8922600adb755931ec91b94274`
(run 29221008971). Nested `@vorionsys/verify@0.1.1` (via gate-core) has one too.
Those signatures were not re-verified in this repo. Not every historical release
has provenance: `@vorionsys/verify@0.1.0`, `@vorionsys/gate-core@0.1.0`, and
`@vorionsys/contracts` versions before 1.1.0 do not.

## Verify the chain yourself

```bash
npx @vorionsys/verify chain.json --keys keys.json
```

or open [`/verifier.html`](public/verifier.html) — a single static file. Its script
contains no `fetch` or `XMLHttpRequest`. The page says it works from `file://`.

## Where this sits in BASIS

```
basis-spec (standard)          github.com/vorionsys/basis-spec
   └── basis-gate (pipeline spec)   github.com/vorionsys/basis-gate
         ├── @vorionsys/contracts   this demo imports it (repo: contracts)
         ├── @vorionsys/gate-core   reference gate — what this demo runs
         ├── @vorionsys/verify      offline verification (repo: basis-verify)
         └── THIS REPO
```

`@vorionsys/shared-constants` exists on npm (2.0.1 when checked) and is not a
dependency of this repo. The demo imports the published packages above — gate
evaluation and Ed25519 signing run server-side; the browser only renders and
re-verifies (every appended record re-verifies the whole chain in-browser with
`@vorionsys/verify` before it is drawn).

**The server holds no session state.** Your chain travels with every request and is
cryptographically re-verified server-side before each append — the chain *is* the
session. Tamper with it mid-run and the server refuses with the exact failing record
(the e2e asserts this). Standard:
[`basis-spec`](https://github.com/vorionsys/basis-spec) · [vorion.org](https://vorion.org)

## Known issues

Runtime, still open. [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5):
`zod` below 4.6.6 can exhaust memory while validating oversized constrained
collections. The lockfile has `zod@3.25.76` because `@vorionsys/contracts@1.6.1`
depends on `zod@^3.24.1`. `npm audit --omit=dev` counts that as 4 high findings
(`zod`, `@vorionsys/contracts`, `@vorionsys/verify`, `@vorionsys/gate-core`) and
reports no fix. The patched line is zod 4.6.6 or newer, a major bump this change
does not take. The `@vorionsys` packages are not modified here. A full `npm audit`
reports the same 4 findings and no dev-only ones.

`next@15.5.28` depended on exact `postcss@8.4.31`. An override to `postcss@8.5.32`
(still major 8) clears the PostCSS advisories npm had grouped under `postcss` and
`next`. npm's offered fix was `next@16`, which was not applied.

## Development

```bash
npm ci
npm run dev        # http://localhost:3000
npm run build && npm run e2e   # nine scenarios, two branches, gauntlet, and a 403 from /api/anchor
```

Node `^18.18.0 || ^19.8.0 || >=20.0.0`, matching `next@15.5.28` engines (Node 18.0–18.17 is outside that range). All data synthetic. No auth, no database, and no analytics SDK added by this repo. `next build` prints Next.js's own anonymous telemetry notice; opt out at [nextjs.org/telemetry](https://nextjs.org/telemetry).
See [EXPLAINER.md](EXPLAINER.md) for what each record field proves. That note is about the quarter-close flagship.

## License

Apache-2.0. Copyright 2026 Vorion Systems.
