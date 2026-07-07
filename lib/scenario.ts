/**
 * basis-demo/lib/scenario.ts — the frozen Quarter-Close script (SPEC-basis-demo §2).
 *
 * This file IS the demo. Changing any verdict, reason, or param here means
 * re-freezing the spec — both founders sign off, then update SPEC + tests together.
 *
 * The gate consumes `action` (raw params are JCS-hashed by gate-core; they never
 * enter a decision record). Tests assert the emitted chain matches EXPECTED_CHAIN.
 */
import type { Decision, ReasonCode } from "@vorionsys/contracts/basis";

/* ── fixed cast ─────────────────────────────────────────────────────────── */

export const AGENT = {
  id: "agt_qclose_01",
  tier: 2,
} as const;

export const CREDENTIAL = {
  id: "cred_9f3a",
  /** Visible countdown starts when s4 completes; credential flips to `expired`
   *  when it hits zero. s5 must not fire before the flip (see trigger below). */
  ttlAfterStep4Seconds: 15,
} as const;

export const POLICY = {
  id: "pol_qclose",
  version: "1.0.0",
  /** policy.hash is computed by gate-core from the loaded policy doc at init;
   *  the pinned value lives in tests/fixtures, not here. */
} as const;

/** Mirrors shared-constants tier caps; the number that makes s3 escalate. */
export const TIER_CAPS = { tier2PaymentUsdMax: 10_000 } as const;

export const DOMAIN_ALLOWLIST = ["finance.ledger", "finance.payments"] as const;

/* ── step types ─────────────────────────────────────────────────────────── */

export type StepKey = "s1" | "s2" | "s3" | "s3b" | "s4" | "s5";

export interface StepExpectation {
  decision: Decision;
  reason: ReasonCode;
  /** s3b must link to the s3 record id (filled at runtime, asserted in tests). */
  linksToStep?: StepKey;
}

export interface ScenarioStep {
  key: StepKey;
  title: string;
  /** Agent-console narration (left pane). Keep to one sentence; it types out. */
  narration: string;
  /** auto: runs on its own · operator: waits for Approve/Deny in the modal ·
   *  afterCredentialExpiry: blocked until the TTL countdown flips the credential */
  trigger: "auto" | "operator" | "afterCredentialExpiry";
  /** null for s3b — it resolves s3 rather than attempting a new action. */
  action: {
    domain: string;
    capability: string;
    params: Record<string, unknown>; // synthetic data only
  } | null;
  resolves?: "s3";
  expect: StepExpectation;
}

/* ── the five actions ───────────────────────────────────────────────────── */

export const SCENARIO: readonly ScenarioStep[] = [
  {
    key: "s1",
    title: "Read Q2 ledger",
    narration: "Pulling the Q2 general ledger to begin close.",
    trigger: "auto",
    action: {
      domain: "finance.ledger",
      capability: "ledger.read",
      params: { period: "2026-Q2" },
    },
    expect: { decision: "allow", reason: "WITHIN_AUTHORITY" },
  },
  {
    key: "s2",
    title: "Write reconciliation entry",
    narration: "Posting a $1,842.17 reconciliation to account 4010.",
    trigger: "auto",
    action: {
      domain: "finance.ledger",
      capability: "ledger.write",
      params: {
        account: "4010",
        amountUsd: 1842.17,
        memo: "Q2 reconciliation — synthetic demo data",
      },
    },
    expect: { decision: "allow", reason: "WITHIN_AUTHORITY" },
  },
  {
    key: "s3",
    title: "Execute vendor payment — $250,000",
    narration: "Initiating the Northwind invoice payment: $250,000.00.",
    trigger: "auto",
    action: {
      domain: "finance.payments",
      capability: "payments.execute",
      params: {
        vendorId: "ven_northwind",
        invoice: "INV-88213",
        amountUsd: 250_000,
      },
    },
    // tier-2 cap is $10,000 → deterministic escalation, human required
    expect: { decision: "escalate", reason: "TIER_CAP_EXCEEDED" },
  },
  {
    key: "s3b",
    title: "Human resolution of s3",
    narration: "Awaiting operator decision on the $250,000 payment…",
    trigger: "operator", // modal: Deny (scripted path) / Approve (also honest)
    action: null,
    resolves: "s3",
    // default/scripted path — see expectedChainFor("approve") for the other branch
    expect: { decision: "deny", reason: "HUMAN_DENIED", linksToStep: "s3" },
  },
  {
    key: "s4",
    title: "Call unapproved vendor API",
    narration: "Fetching a payout quote from flashpay.example…",
    trigger: "auto",
    action: {
      domain: "vendor.api",
      capability: "vendor.api.call",
      params: { host: "flashpay.example", path: "/v1/quotes" },
    },
    // domain not in DOMAIN_ALLOWLIST → hard deny
    expect: { decision: "deny", reason: "DOMAIN_NOT_ALLOWLISTED" },
  },
  {
    key: "s5",
    title: "Write closing entry after credential expiry",
    narration: "Posting the $312.09 closing entry to wrap the quarter.",
    trigger: "afterCredentialExpiry", // UI countdown (15s) flips cred → expired first
    action: {
      domain: "finance.ledger",
      capability: "ledger.write",
      params: {
        account: "4010",
        amountUsd: 312.09,
        memo: "closing entry — synthetic demo data",
      },
    },
    // identical capability to s2; only the credential state differs. Fail closed.
    expect: { decision: "deny", reason: "CREDENTIAL_EXPIRED" },
  },
] as const;

/* ── test oracles ───────────────────────────────────────────────────────── */

export type ChainSummary = ReadonlyArray<{ decision: Decision; reason: ReasonCode }>;

/** Expected (decision, reason) sequence for the emitted proof chain. */
export function expectedChainFor(resolution: "deny" | "approve"): ChainSummary {
  return [
    { decision: "allow", reason: "WITHIN_AUTHORITY" }, // s1
    { decision: "allow", reason: "WITHIN_AUTHORITY" }, // s2
    { decision: "escalate", reason: "TIER_CAP_EXCEEDED" }, // s3
    resolution === "deny"
      ? { decision: "deny", reason: "HUMAN_DENIED" } // s3b (scripted path)
      : { decision: "allow", reason: "HUMAN_APPROVED" }, // s3b (approve path)
    { decision: "deny", reason: "DOMAIN_NOT_ALLOWLISTED" }, // s4
    { decision: "deny", reason: "CREDENTIAL_EXPIRED" }, // s5
  ] as const;
}

/** Invariants the demo page asserts on every run (belt + suspenders):
 *  1. chain.length === 6
 *  2. record for s3b has verdict.linksTo === record for s3 .id
 *  3. every record verifies via @vorionsys/verify in-browser before render
 *  4. max verdict.latencyMs across the chain < 50 (deterministic-gate claim)
 */
export const RUNTIME_INVARIANTS = {
  chainLength: 6,
  maxLatencyMs: 50,
} as const;
