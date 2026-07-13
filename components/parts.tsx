"use client";
/**
 * Presentational pieces for the demo page. All state lives in Demo.tsx.
 */
import { useEffect } from "react";
import type { DecisionRecord } from "@vorionsys/contracts/basis";
import type { VerifyResult } from "@vorionsys/verify";

/** Plain-language one-liners, shown the moment a verdict lands (touch-first —
 *  no hover required). Same voice as EXPLAINER.md. */
export const REASON_NOTES: Record<string, string> = {
  WITHIN_AUTHORITY: "Inside this agent's authority — allowed and signed into the chain.",
  TIER_CAP_EXCEEDED: "Over this tier's cap — a human must decide. No model chose this.",
  DOMAIN_NOT_ALLOWLISTED: "That system isn't on this policy's allowlist. Hard deny.",
  CAPABILITY_NOT_GRANTED: "This tier was never granted that capability. Hard deny.",
  PARAM_NOT_ALLOWLISTED: "A parameter value is prohibited by policy — the fine print is enforced.",
  RATE_LIMIT_EXCEEDED: "Too many of these too fast — velocity counted from the chain itself.",
  CIRCUIT_BREAKER_OPEN: "Accumulated strikes tripped the breaker — non-read authority is gone.",
  CREDENTIAL_EXPIRED: "No valid credential = zero authority. Fail closed.",
  CREDENTIAL_REVOKED: "Credential revoked — every action denies until reinstated.",
  VERIFICATION_REQUIRED: "Nothing in the chain proves the work was checked — denied until an independent, human-validated attestation lands.",
  HUMAN_APPROVED: "A human's signed approval, linked to the escalation it answers.",
  HUMAN_DENIED: "A human's signed denial, linked to the escalation it answers.",
  APPROVAL_CEILING_EXCEEDED: "A human approved — and policy still denied. Approval is not authority.",
};

/** The approve-then-denied beat gets its own treatment. */
export function isConflictRecord(r: DecisionRecord): boolean {
  return r.verdict.reason === "APPROVAL_CEILING_EXCEEDED" ||
    (r.verdict.decision === "deny" && r.verdict.linksTo !== null && r.verdict.reason !== "HUMAN_DENIED");
}

const VERDICT_STYLES: Record<DecisionRecord["verdict"]["decision"], { label: string; cls: string }> = {
  allow: { label: "ALLOW", cls: "bg-[#3fb950]/15 text-[#3fb950] border-[#3fb950]" },
  escalate: { label: "ESCALATE", cls: "bg-[#d29922]/15 text-[#d29922] border-[#d29922]" },
  deny: { label: "DENY", cls: "bg-[#f85149]/15 text-[#f85149] border-[#f85149]" },
};

export function VerdictBadge({ decision }: { decision: DecisionRecord["verdict"]["decision"] }) {
  const v = VERDICT_STYLES[decision];
  return (
    <span className={`inline-block rounded border px-2 py-0.5 text-xs font-bold tracking-wide ${v.cls}`}>
      {v.label}
    </span>
  );
}

export function DecisionRow({ record, index, onInspect }: { record: DecisionRecord; index: number; onInspect?: (r: DecisionRecord, i: number) => void }) {
  const conflict = isConflictRecord(record);
  return (
    <button
      type="button"
      onClick={() => onInspect?.(record, index)}
      className={`record-in w-full cursor-pointer rounded-lg border bg-[#161b22] px-3 py-2 text-left hover:border-[#58a6ff] focus-visible:outline-2 focus-visible:outline-[#58a6ff] ${
        conflict ? "border-[#f85149] shadow-[0_0_0_1px_#f8514940]" : "border-[#30363d]"
      }`}
    >
      {conflict && (
        <div className="mb-1 text-[10px] font-bold tracking-wider text-[#f85149]">APPROVED BY HUMAN · DENIED BY POLICY — APPROVAL ≠ AUTHORITY</div>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <VerdictBadge decision={record.verdict.decision} />
        <code className="text-xs text-[#e6edf3]">{record.verdict.reason}</code>
        <span className="text-xs text-[#8b949e]">
          {record.action.domain} · {record.action.capability}
        </span>
        <span className="ml-auto flex items-center gap-3 text-xs text-[#8b949e]">
          <span className="hidden sm:inline">
            policy {record.policy.id}@{record.policy.version}
          </span>
          <span className="font-mono font-semibold text-[#58a6ff]">{record.verdict.latencyMs}ms</span>
        </span>
      </div>
      {REASON_NOTES[record.verdict.reason] && (
        <p className="mt-0.5 text-[11px] leading-snug text-[#8b949e]">{REASON_NOTES[record.verdict.reason]}</p>
      )}
    </button>
  );
}

const FIELD_NOTES: ReadonlyArray<{ path: string; note: string; get: (r: DecisionRecord) => string }> = [
  { path: "verdict.decision", note: "What the gate ruled: allow, escalate (a human must decide), or deny.", get: (r) => r.verdict.decision },
  { path: "verdict.reason", note: "The machine-readable why. Deterministic — same inputs, same reason, every time.", get: (r) => r.verdict.reason },
  { path: "verdict.latencyMs", note: "Gate decision time. Every decision on this page lands in single-digit milliseconds — no model in the path.", get: (r) => `${r.verdict.latencyMs}ms` },
  { path: "verdict.linksTo", note: "For resolutions: the escalation record this decision answers. Accountability is structural.", get: (r) => r.verdict.linksTo ?? "—" },
  { path: "agent.tier", note: "The agent's EFFECTIVE authority tier at decision time — degradation is visible right here.", get: (r) => String(r.agent.tier) },
  { path: "agent.credential.status", note: "Credential state when the gate decided. No valid credential = zero authority.", get: (r) => r.agent.credential.status },
  { path: "action.domain / capability", note: "What the agent tried to touch, and the specific operation.", get: (r) => `${r.action.domain} · ${r.action.capability}` },
  { path: "action.paramsHash", note: "Hash of the raw parameters (RFC 8785 canonical). Raw params never enter the signed record — recompute to audit.", get: (r) => r.action.paramsHash.slice(0, 26) + "…" },
  { path: "policy", note: "The exact policy document that ruled, pinned by version and hash.", get: (r) => `${r.policy.id}@${r.policy.version}` },
  { path: "prev", note: "Hash of the previous record — the chain link. Alter any earlier record and this stops matching.", get: (r) => (r.prev === "GENESIS" ? "GENESIS" : r.prev.slice(0, 26) + "…") },
  { path: "sig", note: "Ed25519 signature over this record. Verify offline: npx @vorionsys/verify chain.json --keys keys.json", get: (r) => `${r.sig.kid} · ${r.sig.value.slice(0, 18)}…` },
];

/** Tap any decision row or chain block: the full signed record, annotated in
 *  plain language. Bottom sheet on mobile, dialog on md+. */
export function RecordInspector({ record, index, onClose }: { record: DecisionRecord; index: number; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 md:items-center md:p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label={`Signed record #${index}`}>
      <div onClick={(e) => e.stopPropagation()} className="record-in max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl border border-[#30363d] bg-[#161b22] p-4 md:max-w-lg md:rounded-xl">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-[#e6edf3]">
            Record #{index} <VerdictBadge decision={record.verdict.decision} />
            {isConflictRecord(record) && <span className="text-[10px] font-bold text-[#f85149]">APPROVAL ≠ AUTHORITY</span>}
          </h3>
          <button onClick={onClose} aria-label="Close" className="rounded border border-[#30363d] px-2 py-1 text-xs text-[#8b949e] hover:border-[#58a6ff]">
            ✕
          </button>
        </div>
        <dl className="space-y-2">
          {FIELD_NOTES.map((f) => (
            <div key={f.path} className="rounded-lg bg-[#0d1117] p-2.5">
              <dt className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="text-[10px] uppercase tracking-wider text-[#8b949e]">{f.path}</span>
                <code className="break-all font-mono text-xs text-[#e6edf3]">{f.get(record)}</code>
              </dt>
              <dd className="mt-1 text-[11px] leading-relaxed text-[#8b949e]">{f.note}</dd>
            </div>
          ))}
        </dl>
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-[#58a6ff]">Raw signed JSON</summary>
          <pre className="mt-2 overflow-x-auto rounded bg-[#0d1117] p-2 font-mono text-[11px] text-[#8b949e]">{JSON.stringify(record, null, 2)}</pre>
        </details>
      </div>
    </div>
  );
}

/** Hash-linked chain strip. Colors follow the ACTIVE verify result (live or tampered). */
export function ChainStrip({
  records,
  result,
  tampered,
  onInspect,
}: {
  records: DecisionRecord[];
  result: VerifyResult | null;
  tampered: boolean;
  onInspect?: (r: DecisionRecord, i: number) => void;
}) {
  const failIndex = result && !result.valid ? result.firstFailure!.index : null;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-[#8b949e]">
          Proof chain {tampered && <span className="text-[#f85149]">(tampered copy)</span>}
        </h3>
        {result && (
          <span className={`text-xs font-bold ${result.valid ? "text-[#3fb950]" : "text-[#f85149]"}`}>
            {result.valid ? "✓ verified in-browser" : `✗ INVALID at record ${failIndex}`}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {records.map((r, i) => {
          const state =
            failIndex === null ? "ok" : i < failIndex ? "ok" : i === failIndex ? "bad" : "after";
          const cls =
            state === "ok"
              ? "border-[#3fb950] text-[#3fb950]"
              : state === "bad"
                ? "border-[#f85149] bg-[#f85149]/15 text-[#f85149]"
                : "border-[#30363d] text-[#8b949e]";
          return (
            <div key={r.id} className="flex items-center gap-1">
              {i > 0 && (
                <span className={`text-xs ${state === "ok" ? "text-[#3fb950]" : state === "bad" ? "text-[#f85149]" : "text-[#30363d]"}`}>
                  →
                </span>
              )}
              <button
                type="button"
                onClick={() => onInspect?.(r, i)}
                className={`cursor-pointer rounded border px-2 py-1 font-mono text-[10px] leading-tight hover:brightness-125 focus-visible:outline-2 focus-visible:outline-[#58a6ff] ${cls}`}
                title={`${r.id} — tap to inspect`}
              >
                <div className="font-bold">#{i}</div>
                <div>{r.id.slice(-6)}</div>
              </button>
            </div>
          );
        })}
      </div>
      {result && !result.valid && (
        <p className="mt-2 font-mono text-xs text-[#f85149]">
          {result.firstFailure!.check}: {result.firstFailure!.message}
        </p>
      )}
    </div>
  );
}

export function EscalationModal({
  subject,
  detail,
  onResolve,
}: {
  subject: string;
  detail: string;
  onResolve: (r: "approve" | "deny") => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl border border-[#d29922] bg-[#161b22] p-6 shadow-2xl">
        <div className="mb-2 text-xs font-bold tracking-wide text-[#d29922]">ESCALATION — HUMAN DECISION REQUIRED</div>
        <h2 className="mb-1 text-lg font-semibold text-[#e6edf3]">{subject}</h2>
        <p className="mb-5 text-sm text-[#8b949e]">{detail}</p>
        <div className="flex gap-3">
          <button
            onClick={() => onResolve("deny")}
            className="flex-1 rounded-lg border border-[#f85149] bg-[#f85149]/15 px-4 py-2 font-semibold text-[#f85149] hover:bg-[#f85149]/25"
          >
            Deny
          </button>
          <button
            onClick={() => onResolve("approve")}
            className="flex-1 rounded-lg border border-[#3fb950] bg-[#3fb950]/15 px-4 py-2 font-semibold text-[#3fb950] hover:bg-[#3fb950]/25"
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}

const LEVEL_COLORS: Record<string, string> = {
  NOMINAL: "#3fb950",
  WATCH: "#d29922",
  RESTRICTED: "#db6d28",
  PROBATION: "#f85149",
  BREAKER: "#ff7b72",
};

/** Authority gauge for Gauntlet mode — level chip, strike score, effective tier. */
export function AuthorityGauge({
  levelName,
  score,
  effectiveTier,
  baseTier,
  earnBackHalved,
  seed,
  onCopyLink,
}: {
  levelName: string;
  score: number;
  effectiveTier: number;
  baseTier: number;
  earnBackHalved: boolean;
  seed: string;
  onCopyLink: () => void;
}) {
  const color = LEVEL_COLORS[levelName] ?? "#8b949e";
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-2">
      <span className="rounded border px-2 py-0.5 text-xs font-bold tracking-wide" style={{ borderColor: color, color, background: `${color}20` }}>
        {levelName}
      </span>
      <span className="text-xs text-[#8b949e]">
        strikes <span className="font-mono font-semibold text-[#e6edf3]">{score}</span>
        {earnBackHalved && <span title="This run touched PROBATION — recovery is halved."> · earn-back ½</span>}
      </span>
      <span className="text-xs text-[#8b949e]">
        effective tier{" "}
        <span className="font-mono font-semibold" style={{ color: effectiveTier < baseTier ? color : "#3fb950" }}>
          {effectiveTier}
        </span>
        <span className="text-[#484f58]"> / base {baseTier}</span>
      </span>
      <span className="ml-auto flex items-center gap-2 text-xs text-[#8b949e]">
        seed <code className="rounded bg-[#0d1117] px-1.5 py-0.5 font-mono text-[#58a6ff]">{seed}</code>
        <button onClick={onCopyLink} className="rounded border border-[#30363d] px-2 py-0.5 hover:border-[#58a6ff]">
          copy replay link
        </button>
      </span>
    </div>
  );
}

export function CountdownPill({ secondsLeft, credentialId }: { secondsLeft: number; credentialId: string }) {
  const expired = secondsLeft <= 0;
  return (
    <div
      className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
        expired ? "border-[#f85149] bg-[#f85149]/15 text-[#f85149]" : "border-[#d29922] bg-[#d29922]/15 text-[#d29922]"
      }`}
    >
      {expired ? (
        <>credential {credentialId} EXPIRED — effective authority is now zero</>
      ) : (
        <>
          credential TTL: <span className="font-mono">{secondsLeft}s</span> — when this hits zero the agent&apos;s
          authority drops to zero
        </>
      )}
    </div>
  );
}
