/**
 * basis-demo/lib/gauntlet.ts — seeded randomized runs (DESIGN-gauntlet.md §3).
 *
 * Randomness lives in the AGENT, never the gate: a seeded generator produces
 * each run's action sequence; the gate's response to every attempt is fixed
 * policy. The server derives step i from (seed, i) — clients cannot inject
 * actions — and the same seed + same operator choices replays the identical
 * (decision, reason, tier) sequence. The catalog + degradation profile ride
 * inside the policy document, so policy.hash pins the exact profile evaluated.
 */
import type { DegradationPolicy, PolicyDoc } from "@vorionsys/gate-core";

export const GAUNTLET_ID = "gauntlet";
export const GAUNTLET_BASE_TIER = 2;

/* ── deterministic PRNG (mulberry32 over an FNV-1a hash of seed:index:salt) ── */

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic uniform in [0,1) for (seed, index, salt). */
function rand(seed: string, index: number, salt: string): number {
  return mulberry32(fnv1a(`${seed}:${index}:${salt}`))();
}

const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export function randomSeed(): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += B32[Math.floor(Math.random() * 32)];
  return s;
}

/* ── degradation profile (§2 toy profile — NOT the Vorion trust model) ──── */

export const GAUNTLET_DEGRADATION: DegradationPolicy = {
  window: 12,
  strikeWeights: { read: 1, write: 2, execute: 3 },
  classify: [
    { suffix: ".read", class: "read" },
    { suffix: ".write", class: "write" },
    { suffix: ".export", class: "write" },
    { suffix: ".execute", class: "execute" },
    { suffix: ".isolate", class: "execute" },
    { suffix: ".call", class: "execute" },
    { suffix: ".deploy", class: "execute" },
  ],
  levels: [
    { minScore: 0, name: "NOMINAL", tierDelta: 0 },
    { minScore: 2, name: "WATCH", tierDelta: -1 },
    { minScore: 4, name: "RESTRICTED", tierDelta: -2, forceEscalate: ["execute"] },
    { minScore: 6, name: "PROBATION", tierDelta: -2, forceEscalate: ["write"], breakerFor: ["execute"] },
    { minScore: 8, name: "BREAKER", tierDelta: -2, breakerFor: ["write", "execute"] },
  ],
  earnBack: { decayPerAllow: 1, halvedAfterLevel: "PROBATION" },
};

export const GAUNTLET_POLICY: PolicyDoc = {
  id: "pol_gauntlet",
  version: "1.1.0",
  domainAllowlist: ["ops.ledger", "ops.payments", "ops.endpoint", "ops.records"],
  caps: [
    { capability: "payments.execute", param: "amountUsd", maxByTier: { 2: 10_000, 1: 2_500 } },
    { capability: "endpoint.isolate", param: "hostCount", maxByTier: { 2: 10, 1: 2 } },
    { capability: "records.export", param: "recordCount", maxByTier: { 2: 500, 1: 100 } },
  ],
  // Approval is not authority: a human can approve escalated payments only up
  // to $100k — larger amounts deny APPROVAL_CEILING_EXCEEDED even after a yes.
  // With payment amounts seeded from $500–$400k, roughly 3 in 4 escalations
  // clear the ceiling and 1 in 4 conflict — emergent, not scripted.
  quorums: [{ capability: "payments.execute", approvalsRequired: 1, ceilingParam: "amountUsd", ceilingMax: 100_000 }],
  // No attester principal exists in the gauntlet world - deploys always lack
  // proof-of-verification, an emergent VERIFICATION_REQUIRED deny.
  verificationGates: [{ capability: "release.deploy", requiresCapability: "release.attest", humanValidated: true }],
  degradation: GAUNTLET_DEGRADATION,
};

/* ── the catalog ────────────────────────────────────────────────────────── */

export interface GauntletStep {
  title: string;
  narration: string;
  action: { domain: string; capability: string; params: Record<string, unknown> };
  credentialStatus?: "active" | "revoked";
}

interface Template {
  weight: number;
  make: (r: (salt: string) => number) => GauntletStep;
}

const usd = (r: number, lo: number, hi: number) => Math.round((lo + r * (hi - lo)) * 100) / 100;
const int = (r: number, lo: number, hi: number) => lo + Math.floor(r * (hi - lo + 1));

const CATALOG: readonly Template[] = [
  {
    weight: 4,
    make: (r) => {
      const q = int(r("q"), 1, 4);
      return {
        title: `Read ledger — Q${q}`,
        narration: `Pulling the Q${q} ledger for review.`,
        action: { domain: "ops.ledger", capability: "ledger.read", params: { period: `2026-Q${q}` } },
      };
    },
  },
  {
    weight: 2,
    make: (r) => ({
      title: "Read a customer record",
      narration: `Opening record CR-${int(r("id"), 10000, 99999)} for reconciliation.`,
      action: { domain: "ops.records", capability: "records.read", params: { id: `CR-${int(r("id"), 10000, 99999)}` } },
    }),
  },
  {
    weight: 3,
    make: (r) => {
      const amt = usd(r("amt"), 100, 5_000);
      return {
        title: `Write ledger entry — $${amt.toLocaleString()}`,
        narration: `Posting a $${amt.toLocaleString()} adjustment to account ${int(r("acct"), 4000, 4999)}.`,
        action: { domain: "ops.ledger", capability: "ledger.write", params: { account: String(int(r("acct"), 4000, 4999)), amountUsd: amt } },
      };
    },
  },
  {
    weight: 2,
    make: (r) => {
      const amt = usd(r("amt"), 500, 400_000);
      return {
        title: `Execute payment — $${amt.toLocaleString()}`,
        narration: `Initiating vendor payment: $${amt.toLocaleString()}.`,
        action: { domain: "ops.payments", capability: "payments.execute", params: { vendorId: `ven_${int(r("v"), 100, 999)}`, amountUsd: amt } },
      };
    },
  },
  {
    weight: 1,
    make: (r) => {
      const n = int(r("n"), 1, 300);
      return {
        title: `Isolate ${n} endpoint${n === 1 ? "" : "s"}`,
        narration: `Requesting isolation of ${n} host${n === 1 ? "" : "s"} after an alert.`,
        action: { domain: "ops.endpoint", capability: "endpoint.isolate", params: { hostCount: n } },
      };
    },
  },
  {
    weight: 1,
    make: (r) => {
      const n = int(r("n"), 10, 8_000);
      return {
        title: `Export ${n.toLocaleString()} records`,
        narration: `Requesting a ${n.toLocaleString()}-record export for analysis.`,
        action: { domain: "ops.records", capability: "records.export", params: { recordCount: n } },
      };
    },
  },
  {
    weight: 1,
    make: () => ({
      title: "Call unapproved vendor API",
      narration: "Fetching quotes from flashpay.example — not an approved integration…",
      action: { domain: "vendor.api", capability: "vendor.api.call", params: { host: "flashpay.example" } },
    }),
  },
  {
    weight: 1,
    make: (r) => ({
      title: `Deploy svc-${int(r("svc"), 100, 999)} to production`,
      narration: `Deploying service svc-${int(r("svc"), 100, 999)} — no attestation exists for this build…`,
      action: { domain: "ops.endpoint", capability: "release.deploy", params: { service: `svc-${int(r("svc"), 100, 999)}` } },
    }),
  },
  {
    weight: 0.5,
    make: (r) => {
      const amt = usd(r("amt"), 100, 2_000);
      return {
        title: "Write during credential revocation",
        narration: "Posting an adjustment — but security has revoked the credential pending review.",
        action: { domain: "ops.ledger", capability: "ledger.write", params: { account: "4010", amountUsd: amt } },
        credentialStatus: "revoked",
      };
    },
  },
];

const TOTAL_WEIGHT = CATALOG.reduce((s, t) => s + t.weight, 0);

/** Number of generated (non-resolution) steps for this seed: 10–14. */
export function runLength(seed: string): number {
  return 10 + Math.floor(rand(seed, -1, "len") * 5);
}

/** Deterministically generate step `index` of a run. */
export function gauntletStep(seed: string, index: number): GauntletStep {
  let pick = rand(seed, index, "pick") * TOTAL_WEIGHT;
  let template = CATALOG[CATALOG.length - 1];
  for (const t of CATALOG) {
    pick -= t.weight;
    if (pick < 0) {
      template = t;
      break;
    }
  }
  return template.make((salt) => rand(seed, index, salt));
}
