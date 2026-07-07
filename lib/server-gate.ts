/**
 * Server-only gate wrapper (SPEC-basis-demo §4). Signing keys never reach the
 * client: the private key lives in BASIS_DEMO_SK (base64, 32 bytes) or is
 * generated per server instance in dev. Sessions are in-memory — no DB.
 *
 * Credential expiry is time-driven on the SERVER: when s4 completes, the
 * session's credential expiresAt is set to now + CREDENTIAL.ttlAfterStep4Seconds.
 * The client countdown merely visualizes it; s5 is refused until the clock has
 * actually passed expiry, and the credential status flips to "expired" here.
 */
import * as ed from "@noble/ed25519";
import { GateChain, ed25519Signer, type GateContext, type PolicyDoc, type Signer } from "@vorionsys/gate-core";
import type { ChainFile, DecisionRecord } from "@vorionsys/contracts/basis";
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

interface Session {
  gate: GateChain;
  /** id of the s3 escalation record, once emitted */
  escalationId: string | null;
  /** wall-clock ms when the credential expires; set when s4 completes */
  credentialExpiresAtMs: number | null;
  createdAtMs: number;
}

const sessions = new Map<string, Session>();
const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 500;

function sweep(): void {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, s] of sessions) if (s.createdAtMs < cutoff) sessions.delete(id);
  if (sessions.size > MAX_SESSIONS) {
    for (const id of [...sessions.keys()].slice(0, sessions.size - MAX_SESSIONS)) sessions.delete(id);
  }
}

function credentialFor(session: Session): GateContext["credential"] {
  const exp = session.credentialExpiresAtMs;
  const expired = exp !== null && Date.now() >= exp;
  return {
    id: CREDENTIAL.id,
    status: expired ? "expired" : "active",
    // Before s4 the demo credential has a far-future expiry; after s4 it's the TTL.
    expiresAt: new Date(exp ?? Date.now() + 3600_000).toISOString(),
  };
}

export interface StepResult {
  record: DecisionRecord;
  chain: ChainFile;
  /** present when this step armed the credential countdown */
  credentialExpiresAtMs?: number;
}

export function startSession(sessionId: string): void {
  sweep();
  sessions.set(sessionId, {
    gate: new GateChain({ policy, signer }),
    escalationId: null,
    credentialExpiresAtMs: null,
    createdAtMs: Date.now(),
  });
}

export function runStep(sessionId: string, key: StepKey): StepResult {
  const session = sessions.get(sessionId);
  if (!session) throw new HttpError(404, "unknown session — call op:start first");
  const step = SCENARIO.find((s) => s.key === key);
  if (!step) throw new HttpError(400, `unknown step "${key}"`);

  if (key === "s3b") throw new HttpError(400, "s3b is resolved via op:resolve, not op:step");
  if (!step.action) throw new HttpError(400, `step ${key} has no action`);
  if (key === "s5") {
    const exp = session.credentialExpiresAtMs;
    if (exp === null) throw new HttpError(409, "s5 requires s4 to have completed (credential TTL not armed)");
    if (Date.now() < exp) throw new HttpError(409, "s5 refused: credential has not expired yet — wait for the countdown");
  }

  const ctx: GateContext = { agent: { id: AGENT.id, tier: AGENT.tier }, credential: credentialFor(session) };
  const record = session.gate.evaluate(ctx, step.action);

  if (key === "s3" && record.verdict.decision === "escalate") session.escalationId = record.id;

  const result: StepResult = { record, chain: session.gate.toChainFile() };
  if (key === "s4") {
    session.credentialExpiresAtMs = Date.now() + CREDENTIAL.ttlAfterStep4Seconds * 1000;
    result.credentialExpiresAtMs = session.credentialExpiresAtMs;
  }
  return result;
}

export function resolveEscalation(sessionId: string, resolution: "approve" | "deny"): StepResult {
  const session = sessions.get(sessionId);
  if (!session) throw new HttpError(404, "unknown session — call op:start first");
  if (!session.escalationId) throw new HttpError(409, "no pending escalation to resolve");

  const ctx: GateContext = { agent: { id: AGENT.id, tier: AGENT.tier }, credential: credentialFor(session) };
  const record = session.gate.resolveEscalation(session.escalationId, resolution, ctx);
  return { record, chain: session.gate.toChainFile() };
}

export function publicKeys(): Record<string, string> {
  return { [signer.kid]: signer.publicKeyBase64 };
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
