# basis-demo

> The BASIS Quarter-Close demo — a gated finance agent gets allowed, escalated, and denied
> in five actions, and hands you a proof chain you can verify offline with no Vorion server in the loop.

![license](https://img.shields.io/badge/license-Apache--2.0-blue)

Live at **[demo.basis.vorion.org](https://demo.basis.vorion.org)** (no login, ~2 minutes, phone-friendly).

## Six scenarios, one gate

| Scenario | Vertical | What it uniquely shows |
|---|---|---|
| **Quarter-Close Agent** (flagship) | Finance | Tier cap escalation, operator deny, and a **live 15s credential TTL** — the same capability allowed at step 2 is denied at step 5 |
| **Incident-Response Agent** | Cybersecurity | The **approve** path, a blast-radius cap (1 host fine, 250 escalates), and a **revoked** credential stopping a disk wipe |
| **Patient-Records Agent** | Healthcare | A privacy-officer denial of a bulk export and an **unenrolled** agent (`credential: none`) getting zero authority |
| **Contract-Award Agent** | Gov Contracts | **Dual control**: a $1.8M award needs two signed approvals — the 1-of-2 vote is `escalate/HUMAN_APPROVED`, visibly still pending — plus `CAPABILITY_NOT_GRANTED` on a novation attempt |
| **Loan-Origination Agent** | Lending | **No human at all**: a prohibited decision basis (applicant zip code) denied by param policy — the fair-lending check — and a **chain-derived velocity cap** stopping the 4th decision in a minute |
| **Grid-Ops Agent** | Energy | Switching caps under storm load, an ungranted firmware push, and a lapsed shift credential |

Same gate, same record format, same verifier — only the policy document and script change.
The flagship Quarter-Close table (SPEC §2):

| # | Action | Verdict | Reason |
|---|--------|---------|--------|
| 1 | Read Q2 ledger | **ALLOW** | `WITHIN_AUTHORITY` |
| 2 | Write $1,842.17 reconciliation | **ALLOW** | `WITHIN_AUTHORITY` |
| 3 | Execute $250,000 vendor payment | **ESCALATE** | `TIER_CAP_EXCEEDED` (tier-2 cap: $10,000) |
| 3b | Operator resolves #3 | **DENY** (or ALLOW) | `HUMAN_DENIED` / `HUMAN_APPROVED` — links to #3 |
| 4 | Call unapproved vendor API | **DENY** | `DOMAIN_NOT_ALLOWLISTED` |
| 5 | Write closing entry after credential expiry | **DENY** | `CREDENTIAL_EXPIRED` — fail closed |

Three things to notice while it runs:

1. **Deterministic** — every verdict lands in single-digit milliseconds with the policy id
   on screen. No LLM evaluated any decision on the page.
2. **Fail closed** — a visible 15-second credential TTL runs out between #4 and #5;
   the same capability that was allowed at #2 is denied at #5. The server refuses #5
   until the clock has actually passed expiry — the countdown is real, not theater.
3. **Tamper-evident** — download `chain.json` + `keys.json`, verify offline, then use the
   in-page tamper control and watch verification break at exactly record #3.

## Verify the chain yourself

```bash
npx @vorionsys/verify chain.json --keys keys.json
```

or open [`/verifier.html`](public/verifier.html) — a single static file that works from
`file://` on an air-gapped machine.

## Where this sits in BASIS

```
basis-spec (standard)
   └── basis-gate (pre-action authority pipeline)
         ├── contracts / shared-constants (types, tiers, reason codes)
         ├── gate-core (reference gate engine — what this demo runs)
         ├── basis-verify (offline proof-chain verification)
         └── THIS REPO ◄ (the two-minute proof it all works)
```

The demo imports the same published packages anyone can `npm install` — that is the
credibility mechanism. Gate evaluation and Ed25519 signing run server-side; the browser
only renders and *re-verifies* (every appended record re-verifies the whole chain
in-browser with `@vorionsys/verify` before it is drawn).

**The server holds no session state.** Your chain travels with every request and is
cryptographically re-verified server-side before each append — the chain *is* the
session. Tamper with it mid-run and the server refuses with the exact failing record
(the e2e asserts this). Standard:
[`basis-spec`](https://github.com/vorionsys/basis-spec) · [vorion.org](https://vorion.org)

## Development

```bash
npm install
npm run dev        # http://localhost:3000
npm run build && npm run e2e   # drives the full scenario incl. the honest 15s TTL (~25s)
```

Node ≥ 18. All data synthetic. No auth, no DB, no analytics beyond Vercel defaults.
See [EXPLAINER.md](EXPLAINER.md) for what each record field proves.

## License

Apache-2.0 © Vorion LLC
