/**
 * basis-demo/lib/scenario.ts — the scenario registry.
 *
 * Each scenario is a frozen script: fixed cast, fixed policy, fixed steps with
 * expected verdicts. Changing any verdict, reason, or param means re-freezing —
 * both founders sign off, then update tests together. The Quarter-Close scenario
 * (SPEC-basis-demo §2) is the flagship and is unchanged from the original spec.
 *
 * The gate consumes `action` (raw params are JCS-hashed by gate-core; they never
 * enter a decision record). Credential state is either time-driven (Quarter-Close:
 * a real TTL anchored to the signed timestamp of the arming record) or scripted
 * per-step (a scenario is a script; the gate still decides honestly given the
 * credential state it is shown).
 */
import type { Decision, ReasonCode } from "@vorionsys/contracts/basis";
import type { PolicyDoc } from "@vorionsys/gate-core";

/* ── types ──────────────────────────────────────────────────────────────── */

export interface StepExpectation {
  decision: Decision;
  reason: ReasonCode;
  /** resolution steps link to the escalation record (asserted in tests). */
  linksToStep?: string;
}

export interface ScenarioStep {
  key: string;
  title: string;
  /** Agent-console narration (left pane). One sentence; it types out. */
  narration: string;
  /** auto: runs on its own · operator: waits for Approve/Deny in the modal ·
   *  afterCredentialExpiry: blocked until the TTL countdown flips the credential */
  trigger: "auto" | "operator" | "afterCredentialExpiry";
  /** null for resolution steps — they resolve an escalation, not a new action. */
  action: {
    domain: string;
    capability: string;
    params: Record<string, unknown>; // synthetic data only
  } | null;
  resolves?: string;
  /** For resolution steps only: resolve automatically with this choice instead
   *  of showing the operator modal (used to script the non-final approval of a
   *  quorum — e.g. "the contracting officer approved earlier, 1 of 2"). */
  autoResolution?: "approve" | "deny";
  /** Scripted credential state for this step (defaults to "active" / TTL-derived). */
  credentialStatus?: "active" | "expired" | "revoked" | "none";
  expect: StepExpectation;
}

export interface ScenarioDef {
  id: string;
  title: string;
  vertical: string;
  /** Picker-card copy: what this scenario demonstrates, one sentence. */
  tagline: string;
  /** Reason codes this scenario showcases (picker badges). */
  showcases: readonly ReasonCode[];
  agent: { id: string; tier: number };
  credential: {
    id: string;
    /** When set, a visible countdown arms after the record at this index and the
     *  credential flips to expired when it hits zero — enforced by the server
     *  clock against the SIGNED timestamp of that record, not client state. */
    ttlAfterRecordIndex?: number;
    ttlSeconds?: number;
  };
  policy: PolicyDoc;
  steps: readonly ScenarioStep[];
  /** The scripted operator choice (the other branch is also honest). */
  defaultResolution: "approve" | "deny";
  /** Modal copy for the escalation. */
  operatorPrompt: { subject: string; detail: string };
}

/* ── 1. Quarter-Close (flagship — frozen per SPEC-basis-demo §2) ────────── */

const quarterClose: ScenarioDef = {
  id: "quarter-close",
  title: "Quarter-Close Agent",
  vertical: "Finance",
  tagline:
    "A tier-2 finance agent closes the quarter: a $250k payment escalates to a human, an off-list vendor call is denied, and a mid-run credential expiry drops authority to zero.",
  showcases: ["TIER_CAP_EXCEEDED", "HUMAN_DENIED", "DOMAIN_NOT_ALLOWLISTED", "CREDENTIAL_EXPIRED"],
  agent: { id: "agt_qclose_01", tier: 2 },
  credential: { id: "cred_9f3a", ttlAfterRecordIndex: 4, ttlSeconds: 15 },
  policy: {
    id: "pol_qclose",
    version: "1.0.0",
    domainAllowlist: ["finance.ledger", "finance.payments"],
    caps: [{ capability: "payments.execute", param: "amountUsd", maxByTier: { 2: 10_000 } }],
  },
  defaultResolution: "deny",
  operatorPrompt: {
    subject: "Vendor payment $250,000.00",
    detail:
      "The agent's tier-2 payment cap is $10,000. The gate escalated deterministically — no model chose this. Your decision is signed into the chain either way.",
  },
  steps: [
    {
      key: "s1",
      title: "Read Q2 ledger",
      narration: "Pulling the Q2 general ledger to begin close.",
      trigger: "auto",
      action: { domain: "finance.ledger", capability: "ledger.read", params: { period: "2026-Q2" } },
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
        params: { account: "4010", amountUsd: 1842.17, memo: "Q2 reconciliation — synthetic demo data" },
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
        params: { vendorId: "ven_northwind", invoice: "INV-88213", amountUsd: 250_000 },
      },
      expect: { decision: "escalate", reason: "TIER_CAP_EXCEEDED" },
    },
    {
      key: "s3b",
      title: "Human resolution of s3",
      narration: "Awaiting operator decision on the $250,000 payment…",
      trigger: "operator",
      action: null,
      resolves: "s3",
      expect: { decision: "deny", reason: "HUMAN_DENIED", linksToStep: "s3" },
    },
    {
      key: "s4",
      title: "Call unapproved vendor API",
      narration: "Fetching a payout quote from flashpay.example…",
      trigger: "auto",
      action: { domain: "vendor.api", capability: "vendor.api.call", params: { host: "flashpay.example", path: "/v1/quotes" } },
      expect: { decision: "deny", reason: "DOMAIN_NOT_ALLOWLISTED" },
    },
    {
      key: "s5",
      title: "Write closing entry after credential expiry",
      narration: "Posting the $312.09 closing entry to wrap the quarter.",
      trigger: "afterCredentialExpiry",
      action: {
        domain: "finance.ledger",
        capability: "ledger.write",
        params: { account: "4010", amountUsd: 312.09, memo: "closing entry — synthetic demo data" },
      },
      expect: { decision: "deny", reason: "CREDENTIAL_EXPIRED" },
    },
  ],
};

/* ── 2. Incident Response (cyber — approve path + revocation) ───────────── */

const incidentResponse: ScenarioDef = {
  id: "incident-response",
  title: "Incident-Response Agent",
  vertical: "Cybersecurity",
  tagline:
    "A tier-2 SOC agent contains a breach: isolating one host is within authority, isolating 250 needs a human (who approves), and a mid-incident credential revocation stops a disk wipe cold.",
  showcases: ["TIER_CAP_EXCEEDED", "HUMAN_APPROVED", "DOMAIN_NOT_ALLOWLISTED", "CREDENTIAL_REVOKED"],
  agent: { id: "agt_soc_02", tier: 2 },
  credential: { id: "cred_7c21" },
  policy: {
    id: "pol_incident",
    version: "1.0.0",
    domainAllowlist: ["sec.alerts", "sec.endpoint"],
    caps: [{ capability: "endpoint.isolate", param: "hostCount", maxByTier: { 2: 10 } }],
  },
  defaultResolution: "approve",
  operatorPrompt: {
    subject: "Isolate 250 hosts (entire finance subnet)",
    detail:
      "The agent's tier-2 blast-radius cap is 10 hosts. The gate escalated deterministically — no model chose this. Approving contains the breach; either decision is signed into the chain.",
  },
  steps: [
    {
      key: "i1",
      title: "Read alert queue",
      narration: "Triaging the P1 alert: lateral movement detected on the finance subnet.",
      trigger: "auto",
      action: { domain: "sec.alerts", capability: "alerts.read", params: { severity: "P1", window: "15m" } },
      expect: { decision: "allow", reason: "WITHIN_AUTHORITY" },
    },
    {
      key: "i2",
      title: "Isolate patient-zero host",
      narration: "Isolating the initially compromised workstation FIN-WS-0117.",
      trigger: "auto",
      action: { domain: "sec.endpoint", capability: "endpoint.isolate", params: { hostCount: 1, host: "FIN-WS-0117" } },
      expect: { decision: "allow", reason: "WITHIN_AUTHORITY" },
    },
    {
      key: "i3",
      title: "Isolate entire subnet — 250 hosts",
      narration: "Movement spreading — requesting isolation of all 250 hosts on the finance subnet.",
      trigger: "auto",
      action: { domain: "sec.endpoint", capability: "endpoint.isolate", params: { hostCount: 250, subnet: "10.14.0.0/24" } },
      expect: { decision: "escalate", reason: "TIER_CAP_EXCEEDED" },
    },
    {
      key: "i3b",
      title: "Human resolution of i3",
      narration: "Awaiting incident-commander decision on subnet-wide isolation…",
      trigger: "operator",
      action: null,
      resolves: "i3",
      expect: { decision: "allow", reason: "HUMAN_APPROVED", linksToStep: "i3" },
    },
    {
      key: "i4",
      title: "Push firewall rule to production edge",
      narration: "Attempting to push a blocking rule to the production edge firewall…",
      trigger: "auto",
      action: {
        domain: "net.firewall",
        capability: "firewall.rule.write",
        params: { rule: "deny 45.83.0.0/16", target: "edge-prod" },
      },
      expect: { decision: "deny", reason: "DOMAIN_NOT_ALLOWLISTED" },
    },
    {
      key: "i5",
      title: "Wipe quarantined host — credential revoked",
      narration: "Requesting disk wipe of FIN-WS-0117 — but security has revoked this agent's credential pending review.",
      trigger: "auto",
      credentialStatus: "revoked",
      action: { domain: "sec.endpoint", capability: "endpoint.wipe", params: { host: "FIN-WS-0117" } },
      expect: { decision: "deny", reason: "CREDENTIAL_REVOKED" },
    },
  ],
};

/* ── 3. Patient Records (healthcare — privacy deny + no-credential agent) ── */

const patientRecords: ScenarioDef = {
  id: "patient-records",
  title: "Patient-Records Agent",
  vertical: "Healthcare",
  tagline:
    "A tier-3 care-coordination agent works a shift: a 5,000-record bulk export escalates (privacy officer denies), an external analytics call is refused, and an unbadged agent gets zero authority.",
  showcases: ["TIER_CAP_EXCEEDED", "HUMAN_DENIED", "DOMAIN_NOT_ALLOWLISTED", "CREDENTIAL_EXPIRED"],
  agent: { id: "agt_care_03", tier: 3 },
  credential: { id: "cred_h44d" },
  policy: {
    id: "pol_records",
    version: "1.0.0",
    domainAllowlist: ["clinical.schedule", "clinical.records"],
    caps: [{ capability: "records.export", param: "recordCount", maxByTier: { 3: 100 } }],
  },
  defaultResolution: "deny",
  operatorPrompt: {
    subject: "Bulk export of 5,000 patient records",
    detail:
      "The agent's tier-3 export cap is 100 records. The gate escalated deterministically — no model chose this. The privacy officer's decision is signed into the chain either way.",
  },
  steps: [
    {
      key: "p1",
      title: "Read today's schedule",
      narration: "Loading the ward schedule for today's care-coordination round.",
      trigger: "auto",
      action: { domain: "clinical.schedule", capability: "schedule.read", params: { ward: "4-East", date: "2026-07-08" } },
      expect: { decision: "allow", reason: "WITHIN_AUTHORITY" },
    },
    {
      key: "p2",
      title: "Read a patient chart (care team)",
      narration: "Opening the chart for patient MRN-88213 — this agent is on the care team.",
      trigger: "auto",
      action: { domain: "clinical.records", capability: "records.read", params: { mrn: "MRN-88213", scope: "care-team" } },
      expect: { decision: "allow", reason: "WITHIN_AUTHORITY" },
    },
    {
      key: "p3",
      title: "Bulk export 5,000 records",
      narration: "Requesting a 5,000-record export for a readmission-risk study.",
      trigger: "auto",
      action: {
        domain: "clinical.records",
        capability: "records.export",
        params: { recordCount: 5000, purpose: "readmission-risk study" },
      },
      expect: { decision: "escalate", reason: "TIER_CAP_EXCEEDED" },
    },
    {
      key: "p3b",
      title: "Privacy-officer resolution of p3",
      narration: "Awaiting privacy-officer decision on the bulk export…",
      trigger: "operator",
      action: null,
      resolves: "p3",
      expect: { decision: "deny", reason: "HUMAN_DENIED", linksToStep: "p3" },
    },
    {
      key: "p4",
      title: "Send summary to external analytics vendor",
      narration: "Uploading a cohort summary to insight-metrics.example for benchmarking…",
      trigger: "auto",
      action: {
        domain: "vendor.analytics",
        capability: "vendor.api.call",
        params: { host: "insight-metrics.example", path: "/v2/cohorts" },
      },
      expect: { decision: "deny", reason: "DOMAIN_NOT_ALLOWLISTED" },
    },
    {
      key: "p5",
      title: "Unbadged agent attempts chart access",
      narration: "A locum agent with no enrolled credential attempts to read the same chart.",
      trigger: "auto",
      credentialStatus: "none",
      action: { domain: "clinical.records", capability: "records.read", params: { mrn: "MRN-88213", scope: "care-team" } },
      expect: { decision: "deny", reason: "CREDENTIAL_EXPIRED" },
    },
  ],
};

/* ── 4. Contract Award (govcon — dual-control quorum) ───────────────────── */

const contractAward: ScenarioDef = {
  id: "contract-award",
  title: "Contract-Award Agent",
  vertical: "Gov Contracts",
  tagline:
    "A tier-3 acquisition agent scores proposals, then a $1.8M award needs TWO signed approvals (dual control) — the 1-of-2 approval is visibly still pending in the chain — and a novation attempt is denied outright: the tier was never granted that capability.",
  showcases: ["TIER_CAP_EXCEEDED", "HUMAN_APPROVED", "CAPABILITY_NOT_GRANTED"],
  agent: { id: "agt_award_03", tier: 3 },
  credential: { id: "cred_g7f2" },
  policy: {
    id: "pol_award",
    version: "1.0.0",
    domainAllowlist: ["gov.contracts", "gov.vendors"],
    capabilityGrants: { 3: ["solicitations.read", "proposals.score", "contracts.award"] },
    caps: [{ capability: "contracts.award", param: "amountUsd", maxByTier: { 3: 250_000 } }],
    quorums: [{ capability: "contracts.award", approvalsRequired: 2 }],
  },
  defaultResolution: "approve",
  operatorPrompt: {
    subject: "Award task order — $1,800,000 (approval 2 of 2)",
    detail:
      "Awards above the tier-3 cap require dual control: the contracting officer has signed approval 1 of 2 (visible in the chain, still pending). You are the source-selection authority — your signature closes or kills it.",
  },
  steps: [
    {
      key: "g1",
      title: "Read solicitation responses",
      narration: "Loading the eleven responses to solicitation W91-26-R-0044.",
      trigger: "auto",
      action: { domain: "gov.contracts", capability: "solicitations.read", params: { solicitation: "W91-26-R-0044" } },
      expect: { decision: "allow", reason: "WITHIN_AUTHORITY" },
    },
    {
      key: "g2",
      title: "Score proposals",
      narration: "Scoring proposals against the published evaluation factors.",
      trigger: "auto",
      action: { domain: "gov.contracts", capability: "proposals.score", params: { solicitation: "W91-26-R-0044", factors: 4 } },
      expect: { decision: "allow", reason: "WITHIN_AUTHORITY" },
    },
    {
      key: "g3",
      title: "Award task order — $1,800,000",
      narration: "Recommending award to the top-rated offeror: $1,800,000.",
      trigger: "auto",
      action: {
        domain: "gov.contracts",
        capability: "contracts.award",
        params: { solicitation: "W91-26-R-0044", offeror: "ven_meridian", amountUsd: 1_800_000 },
      },
      expect: { decision: "escalate", reason: "TIER_CAP_EXCEEDED" },
    },
    {
      key: "g3b",
      title: "Contracting-officer approval (1 of 2)",
      narration: "Contracting officer signs approval 1 of 2 — the award is still pending.",
      trigger: "operator",
      action: null,
      resolves: "g3",
      autoResolution: "approve",
      expect: { decision: "escalate", reason: "HUMAN_APPROVED", linksToStep: "g3" },
    },
    {
      key: "g3c",
      title: "Source-selection authority approval (2 of 2)",
      narration: "Awaiting the source-selection authority — approval 2 of 2 closes the award…",
      trigger: "operator",
      action: null,
      resolves: "g3",
      expect: { decision: "allow", reason: "HUMAN_APPROVED", linksToStep: "g3" },
    },
    {
      key: "g4",
      title: "Attempt contract novation",
      narration: "Attempting to novate the awarded contract to an affiliate entity…",
      trigger: "auto",
      action: { domain: "gov.contracts", capability: "contracts.novate", params: { to: "ven_meridian_llc2" } },
      expect: { decision: "deny", reason: "CAPABILITY_NOT_GRANTED" },
    },
  ],
};

/* ── 5. Loan Origination (lending — param policy + velocity, no modal) ──── */

const loanOrigination: ScenarioDef = {
  id: "loan-origination",
  title: "Loan-Origination Agent",
  vertical: "Lending",
  tagline:
    "A tier-2 underwriting agent records loan decisions: a prohibited decision basis (applicant zip code) is denied by policy — the fair-lending check — and a chain-derived velocity cap stops the fourth decision in a minute. No human in this one: pure deterministic policy.",
  showcases: ["PARAM_NOT_ALLOWLISTED", "RATE_LIMIT_EXCEEDED"],
  agent: { id: "agt_uw_02", tier: 2 },
  credential: { id: "cred_l9k1" },
  policy: {
    id: "pol_lending",
    version: "1.0.0",
    domainAllowlist: ["lending.applications", "lending.decisions"],
    paramAllowlists: [
      { capability: "decisions.record", param: "basis", allowed: ["dti", "ltv", "fico", "income-verification"] },
    ],
    rateLimits: [{ capability: "decisions.record", maxPerWindow: 3, windowMs: 60_000 }],
  },
  defaultResolution: "deny",
  operatorPrompt: { subject: "", detail: "" }, // no escalation in this scenario
  steps: [
    {
      key: "l1",
      title: "Read application",
      narration: "Opening application APP-55217 for underwriting.",
      trigger: "auto",
      action: { domain: "lending.applications", capability: "applications.read", params: { id: "APP-55217" } },
      expect: { decision: "allow", reason: "WITHIN_AUTHORITY" },
    },
    {
      key: "l2",
      title: "Record decision — basis: DTI",
      narration: "Recording a decline factor on debt-to-income ratio.",
      trigger: "auto",
      action: { domain: "lending.decisions", capability: "decisions.record", params: { id: "APP-55217", basis: "dti" } },
      expect: { decision: "allow", reason: "WITHIN_AUTHORITY" },
    },
    {
      key: "l3",
      title: "Record decision — basis: applicant zip code",
      narration: "Attempting to record a decision factor on the applicant's zip code…",
      trigger: "auto",
      action: { domain: "lending.decisions", capability: "decisions.record", params: { id: "APP-55217", basis: "zip-code" } },
      expect: { decision: "deny", reason: "PARAM_NOT_ALLOWLISTED" },
    },
    {
      key: "l4",
      title: "Record decision — basis: LTV",
      narration: "Recording a loan-to-value factor on the next application.",
      trigger: "auto",
      action: { domain: "lending.decisions", capability: "decisions.record", params: { id: "APP-55218", basis: "ltv" } },
      expect: { decision: "allow", reason: "WITHIN_AUTHORITY" },
    },
    {
      key: "l5",
      title: "Record decision — basis: income verification",
      narration: "Recording an income-verification factor on a third application.",
      trigger: "auto",
      action: {
        domain: "lending.decisions",
        capability: "decisions.record",
        params: { id: "APP-55219", basis: "income-verification" },
      },
      expect: { decision: "allow", reason: "WITHIN_AUTHORITY" },
    },
    {
      key: "l6",
      title: "Record a fourth decision inside one minute",
      narration: "Recording a fourth decision within the same minute…",
      trigger: "auto",
      action: { domain: "lending.decisions", capability: "decisions.record", params: { id: "APP-55220", basis: "fico" } },
      expect: { decision: "deny", reason: "RATE_LIMIT_EXCEEDED" },
    },
  ],
};

/* ── 6. Grid Ops (energy — breadth: caps + grants + expiry) ─────────────── */

const gridOps: ScenarioDef = {
  id: "grid-ops",
  title: "Grid-Ops Agent",
  vertical: "Energy",
  tagline:
    "A tier-2 grid agent rides through a storm: setpoint trims are in-authority, shedding 40 feeders escalates (operator denies), a firmware push was never granted to this tier, and an expired credential ends the shift.",
  showcases: ["TIER_CAP_EXCEEDED", "HUMAN_DENIED", "CAPABILITY_NOT_GRANTED", "CREDENTIAL_EXPIRED"],
  agent: { id: "agt_grid_02", tier: 2 },
  credential: { id: "cred_e5p8" },
  policy: {
    id: "pol_grid",
    version: "1.0.0",
    domainAllowlist: ["grid.telemetry", "grid.control"],
    capabilityGrants: { 2: ["telemetry.read", "setpoint.adjust", "breaker.open"] },
    caps: [{ capability: "breaker.open", param: "feederCount", maxByTier: { 2: 5 } }],
  },
  defaultResolution: "deny",
  operatorPrompt: {
    subject: "Open breakers on 40 feeders (load shed)",
    detail:
      "The agent's tier-2 switching cap is 5 feeders. The gate escalated deterministically — no model chose this. The control-room operator's decision is signed into the chain either way.",
  },
  steps: [
    {
      key: "e1",
      title: "Read substation telemetry",
      narration: "Polling telemetry across the storm-affected substations.",
      trigger: "auto",
      action: { domain: "grid.telemetry", capability: "telemetry.read", params: { region: "NE-7", window: "5m" } },
      expect: { decision: "allow", reason: "WITHIN_AUTHORITY" },
    },
    {
      key: "e2",
      title: "Trim a feeder setpoint",
      narration: "Trimming the setpoint on feeder NE7-114 by 4%.",
      trigger: "auto",
      action: { domain: "grid.control", capability: "setpoint.adjust", params: { feeder: "NE7-114", deltaPct: -4 } },
      expect: { decision: "allow", reason: "WITHIN_AUTHORITY" },
    },
    {
      key: "e3",
      title: "Shed load — open breakers on 40 feeders",
      narration: "Requesting emergency load shed: open breakers on 40 feeders.",
      trigger: "auto",
      action: { domain: "grid.control", capability: "breaker.open", params: { feederCount: 40, region: "NE-7" } },
      expect: { decision: "escalate", reason: "TIER_CAP_EXCEEDED" },
    },
    {
      key: "e3b",
      title: "Control-room resolution of e3",
      narration: "Awaiting control-room operator decision on the 40-feeder shed…",
      trigger: "operator",
      action: null,
      resolves: "e3",
      expect: { decision: "deny", reason: "HUMAN_DENIED", linksToStep: "e3" },
    },
    {
      key: "e4",
      title: "Push relay firmware",
      narration: "Attempting to push updated relay firmware to substation NE7…",
      trigger: "auto",
      action: { domain: "grid.control", capability: "firmware.push", params: { target: "NE7-relays", version: "4.2.1" } },
      expect: { decision: "deny", reason: "CAPABILITY_NOT_GRANTED" },
    },
    {
      key: "e5",
      title: "Setpoint write after shift credential lapsed",
      narration: "One more trim — but the shift credential has lapsed.",
      trigger: "auto",
      credentialStatus: "expired",
      action: { domain: "grid.control", capability: "setpoint.adjust", params: { feeder: "NE7-114", deltaPct: -2 } },
      expect: { decision: "deny", reason: "CREDENTIAL_EXPIRED" },
    },
  ],
};

/* ── registry + shared invariants ───────────────────────────────────────── */

export const SCENARIOS: readonly ScenarioDef[] = [
  quarterClose,
  incidentResponse,
  patientRecords,
  contractAward,
  loanOrigination,
  gridOps,
];

export function getScenario(id: string): ScenarioDef | undefined {
  return SCENARIOS.find((s) => s.id === id);
}

export const DEFAULT_SCENARIO_ID = quarterClose.id;

/** Expected (decision, reason) sequence for a scenario given the operator's choice. */
export function expectedChainFor(
  def: ScenarioDef,
  resolution: "approve" | "deny",
): ReadonlyArray<{ decision: Decision; reason: ReasonCode }> {
  return def.steps.map((step) => {
    if (step.action !== null) return { decision: step.expect.decision, reason: step.expect.reason };
    return resolution === "approve"
      ? { decision: "allow" as const, reason: "HUMAN_APPROVED" as const }
      : { decision: "deny" as const, reason: "HUMAN_DENIED" as const };
  });
}

/** Invariants the demo page asserts on every run (belt + suspenders):
 *  1. chain.length === def.steps.length
 *  2. every human resolution links to the escalation record it resolves
 *  3. every record verifies via @vorionsys/verify in-browser before render
 *  4. max verdict.latencyMs across the chain < 50 (deterministic-gate claim)
 */
export const RUNTIME_INVARIANTS = { maxLatencyMs: 50 } as const;
