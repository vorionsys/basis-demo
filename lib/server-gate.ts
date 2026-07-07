/**
 * Stateless server-side gate (SPEC-basis-demo §4, hardened for serverless).
 *
 * There is NO session store. The client submits its chain with every request;
 * the server cryptographically re-verifies it (same @vorionsys/verify core as
 * everyone else), reconstructs all state FROM the verified records, appends one
 * signed record, and returns the new chain. A cold lambda changes nothing —
 * the chain IS the session. State derived from records, never from memory:
 *   - next expected step  = chain length (the scenario is a fixed script)
 *   - pending escalation  = escalate record with no later linksTo resolution
 *   - credential expiry   = ts of the s4 record + CREDENTIAL.ttlAfterStep4Seconds
 * Signing keys never reach the client: BASIS_DEMO_SK (base64, 32 bytes) or a
 * per-instance dev key.
 */
import * as ed from "@noble/ed25519";
import { GateChain, ed25519Signer, type GateContext, type PolicyDoc, type Signer } from "@vorionsys/gate-core";
import { verifyChain } from "@vorionsys/verify";
import { parseChainFile, type ChainFile, type DecisionRecord } from "@vorionsys/contracts/basis";
import { AGENT, CREDENTIAL, DOMAIN_ALLOWLIST, POLICY, SCENARIO, TIER_CAPS, type StepKey } from "@/lib/scenario";

const KID = "vorion-demo-2026-07";

function loadSigner(): Signer {
  const envKey = process.env.BASIS_DEMO_SK;
  const privateKey = envKey ? Uint8Array.from(Buffer.from(envKey, "base64")) : ed.utils.randomPrivateKey();
  if (privateKey.length !== 32) throw new Error("BASIS_DEMO_SK must be 32 bytes, base64-encoded");
  return ed25519Signer(privateKey, KID);
}
const signer = loadSigner();

const policy: PolicyDoc = {
  id: POLICY.id,
  version: POLICY.version,
  domainAllowlist: DOMAIN_ALLOWLIST,
  tierCaps: { [AGENT.tier]: { paymentUsdMax: TIER_CAPS.tier2PaymentUsdMax } },
};

/** The scripted order: chain length → what may come next. */
const SCRIPT: readonly (StepKey | "resolve")[] = ["s1", "s2", "s3", "resolve", "s4", "s5"];

export interface StepResult {
  record: DecisionRecord;
  chain: ChainFile;
  /** wall-clock ms when the credential expires; present once s4 is in the chain */
  credentialExpiresAtMs?: number;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Parse + cryptographically verify a submitted chain; returns its records. */
function acceptSubmittedChain(chainInput: unknown): DecisionRecord[] {
  if (chainInput === null || chainInput === undefined) return [];
  let chain: ChainFile;
  try {
    chain = parseChainFile(chainInput);
  } catch {
    throw new HttpError(400, "submitted chain does not match the chain-file schema");
  }
  if (chain.records.length > SCRIPT.length) throw new HttpError(400, "chain longer than the scenario");
  const result = verifyChain(chain, { [KID]: signer.publicKeyBase64 });
  if (!result.valid) {
    const f = result.firstFailure!;
    throw new HttpError(409, `submitted chain failed verification at record ${f.index} (${f.check}): ${f.message}`);
  }
  return [...chain.records];
}

function expectNext(records: DecisionRecord[], attempted: StepKey | "resolve"): void {
  const expected = SCRIPT[records.length];
  if (expected === undefined) throw new HttpError(409, "scenario already complete — replay to start over");
  if (expected !== attempted) {
    throw new HttpError(409, `out of order: expected ${expected === "resolve" ? "operator resolution of s3" : expected} next`);
  }
}

/** Credential expiry is anchored to the SIGNED timestamp of the s4 record. */
function expiryMsFrom(records: DecisionRecord[]): number | null {
  const s4 = records[4];
  if (!s4) return null;
  return Date.parse(s4.ts) + CREDENTIAL.ttlAfterStep4Seconds * 1000;
}

function contextFor(records: DecisionRecord[]): GateContext {
  const expiry = expiryMsFrom(records);
  const expired = expiry !== null && Date.now() >= expiry;
  return {
    agent: { id: AGENT.id, tier: AGENT.tier },
    credential: {
      id: CREDENTIAL.id,
      status: expired ? "expired" : "active",
      expiresAt: new Date(expiry ?? Date.now() + 3600_000).toISOString(),
    },
  };
}

function resultFrom(gate: GateChain, record: DecisionRecord): StepResult {
  const chain = gate.toChainFile();
  const expiry = expiryMsFrom(chain.records);
  return expiry === null ? { record, chain } : { record, chain, credentialExpiresAtMs: expiry };
}

export function runStep(chainInput: unknown, key: StepKey): StepResult {
  const records = acceptSubmittedChain(chainInput);
  const step = SCENARIO.find((s) => s.key === key);
  if (!step || !step.action) throw new HttpError(400, `unknown or actionless step "${key}"`);
  expectNext(records, key);

  if (key === "s5") {
    const expiry = expiryMsFrom(records);
    if (expiry === null) throw new HttpError(409, "s5 requires s4 in the chain");
    if (Date.now() < expiry) throw new HttpError(409, "s5 refused: credential has not expired yet — wait for the countdown");
  }

  const gate = new GateChain({ policy, signer, resume: records });
  const record = gate.evaluate(contextFor(records), step.action);
  return resultFrom(gate, record);
}

export function resolveEscalation(chainInput: unknown, resolution: "approve" | "deny"): StepResult {
  const records = acceptSubmittedChain(chainInput);
  expectNext(records, "resolve");

  const resolved = new Set(records.map((r) => r.verdict.linksTo).filter(Boolean));
  const pending = records.find((r) => r.verdict.decision === "escalate" && !resolved.has(r.id));
  if (!pending) throw new HttpError(409, "no pending escalation to resolve");

  const gate = new GateChain({ policy, signer, resume: records });
  const record = gate.resolveEscalation(pending.id, resolution, contextFor(records));
  return resultFrom(gate, record);
}

export function publicKeys(): Record<string, string> {
  return { [signer.kid]: signer.publicKeyBase64 };
}
