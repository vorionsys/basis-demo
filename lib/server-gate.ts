/**
 * Stateless server-side gate, parametrized by scenario (SPEC-basis-demo §4,
 * hardened for serverless).
 *
 * There is NO session store. The client submits its scenario id + chain with
 * every request; the server cryptographically re-verifies the chain (same
 * @vorionsys/verify core as everyone else), reconstructs all state FROM the
 * verified records and the static scenario definition, appends one signed
 * record, and returns the new chain. A cold lambda changes nothing.
 *
 * State derived from records + static defs, never from memory:
 *   - next expected step  = chain length (each scenario is a fixed script)
 *   - pending escalation  = escalate record with no later linksTo resolution
 *   - credential expiry   = SIGNED ts of the TTL-arming record + def ttlSeconds
 *   - scripted credential = per-step status from the scenario definition
 * Signing keys never reach the client: BASIS_DEMO_SK (base64, 32 bytes) or a
 * per-instance dev key.
 */
import * as ed from "@noble/ed25519";
import { GateChain, ed25519Signer, type GateContext, type Signer } from "@vorionsys/gate-core";
import { verifyChain } from "@vorionsys/verify";
import { parseChainFile, type ChainFile, type DecisionRecord } from "@vorionsys/contracts/basis";
import { getScenario, type ScenarioDef, type ScenarioStep } from "@/lib/scenario";

const KID = "vorion-demo-2026-07";
/** Nominal expiresAt stamped on scripted expired/revoked credentials. */
const SCRIPTED_PAST = "2026-01-01T00:00:00.000Z";

function loadSigner(): Signer {
  const envKey = process.env.BASIS_DEMO_SK;
  const privateKey = envKey ? Uint8Array.from(Buffer.from(envKey, "base64")) : ed.utils.randomPrivateKey();
  if (privateKey.length !== 32) throw new Error("BASIS_DEMO_SK must be 32 bytes, base64-encoded");
  return ed25519Signer(privateKey, KID);
}
const signer = loadSigner();

export interface StepResult {
  record: DecisionRecord;
  chain: ChainFile;
  /** wall-clock ms when the credential expires; present once the TTL is armed */
  credentialExpiresAtMs?: number;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function requireScenario(id: unknown): ScenarioDef {
  const def = typeof id === "string" ? getScenario(id) : undefined;
  if (!def) throw new HttpError(400, `unknown scenario "${String(id)}"`);
  return def;
}

/** Parse + cryptographically verify a submitted chain; returns its records. */
function acceptSubmittedChain(def: ScenarioDef, chainInput: unknown): DecisionRecord[] {
  if (chainInput === null || chainInput === undefined) return [];
  let chain: ChainFile;
  try {
    chain = parseChainFile(chainInput);
  } catch {
    throw new HttpError(400, "submitted chain does not match the chain-file schema");
  }
  if (chain.records.length > def.steps.length) throw new HttpError(400, "chain longer than the scenario");
  const result = verifyChain(chain, { [KID]: signer.publicKeyBase64 });
  if (!result.valid) {
    const f = result.firstFailure!;
    throw new HttpError(409, `submitted chain failed verification at record ${f.index} (${f.check}): ${f.message}`);
  }
  return [...chain.records];
}

function expectNext(def: ScenarioDef, records: DecisionRecord[], attempted: string | "resolve"): ScenarioStep {
  const expected = def.steps[records.length];
  if (!expected) throw new HttpError(409, "scenario already complete — replay to start over");
  const expectedToken = expected.action === null ? "resolve" : expected.key;
  if (expectedToken !== attempted) {
    throw new HttpError(
      409,
      `out of order: expected ${expected.action === null ? "operator resolution" : expected.key} next`,
    );
  }
  return expected;
}

/** Credential expiry anchored to the SIGNED timestamp of the arming record. */
function expiryMsFrom(def: ScenarioDef, records: DecisionRecord[]): number | null {
  const { ttlAfterRecordIndex, ttlSeconds } = def.credential;
  if (ttlAfterRecordIndex === undefined || ttlSeconds === undefined) return null;
  const anchor = records[ttlAfterRecordIndex];
  if (!anchor) return null;
  return Date.parse(anchor.ts) + ttlSeconds * 1000;
}

function contextFor(def: ScenarioDef, step: ScenarioStep, records: DecisionRecord[]): GateContext {
  const expiry = expiryMsFrom(def, records);
  const ttlExpired = expiry !== null && Date.now() >= expiry;
  const status = step.credentialStatus ?? (ttlExpired ? "expired" : "active");
  const expiresAt =
    status === "none" ? null : status === "active" ? new Date(expiry ?? Date.now() + 3600_000).toISOString() : SCRIPTED_PAST;
  return {
    agent: { id: def.agent.id, tier: def.agent.tier },
    credential: { id: def.credential.id, status, expiresAt },
  };
}

function resultFrom(def: ScenarioDef, gate: GateChain, record: DecisionRecord): StepResult {
  const chain = gate.toChainFile();
  const expiry = expiryMsFrom(def, chain.records);
  return expiry === null ? { record, chain } : { record, chain, credentialExpiresAtMs: expiry };
}

export function runStep(scenarioId: unknown, chainInput: unknown, key: string): StepResult {
  const def = requireScenario(scenarioId);
  const records = acceptSubmittedChain(def, chainInput);
  const step = def.steps.find((s) => s.key === key);
  if (!step || !step.action) throw new HttpError(400, `unknown or actionless step "${key}"`);
  expectNext(def, records, key);

  if (step.trigger === "afterCredentialExpiry") {
    const expiry = expiryMsFrom(def, records);
    if (expiry === null) throw new HttpError(409, `${key} requires the TTL-arming step in the chain`);
    if (Date.now() < expiry) {
      throw new HttpError(409, `${key} refused: credential has not expired yet — wait for the countdown`);
    }
  }

  const gate = new GateChain({ policy: def.policy, signer, resume: records });
  const record = gate.evaluate(contextFor(def, step, records), step.action);
  return resultFrom(def, gate, record);
}

export function resolveEscalation(scenarioId: unknown, chainInput: unknown, resolution: "approve" | "deny"): StepResult {
  const def = requireScenario(scenarioId);
  const records = acceptSubmittedChain(def, chainInput);
  const step = expectNext(def, records, "resolve");

  const resolved = new Set(records.map((r) => r.verdict.linksTo).filter(Boolean));
  const pending = records.find((r) => r.verdict.decision === "escalate" && !resolved.has(r.id));
  if (!pending) throw new HttpError(409, "no pending escalation to resolve");

  const gate = new GateChain({ policy: def.policy, signer, resume: records });
  const record = gate.resolveEscalation(pending.id, resolution, contextFor(def, step, records));
  return resultFrom(def, gate, record);
}

export function publicKeys(): Record<string, string> {
  return { [signer.kid]: signer.publicKeyBase64 };
}
