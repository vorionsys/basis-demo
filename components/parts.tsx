"use client";
/**
 * Presentational pieces for the demo page. All state lives in Demo.tsx.
 */
import type { DecisionRecord } from "@vorionsys/contracts/basis";
import type { VerifyResult } from "@vorionsys/verify";

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

export function DecisionRow({ record }: { record: DecisionRecord }) {
  return (
    <div className="record-in flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-2">
      <VerdictBadge decision={record.verdict.decision} />
      <code className="text-xs text-[#e6edf3]">{record.verdict.reason}</code>
      <span className="text-xs text-[#8b949e]">
        {record.action.domain} · {record.action.capability}
      </span>
      <span className="ml-auto flex items-center gap-3 text-xs text-[#8b949e]">
        <span>
          policy {record.policy.id}@{record.policy.version}
        </span>
        <span className="font-mono font-semibold text-[#58a6ff]">{record.verdict.latencyMs}ms</span>
      </span>
    </div>
  );
}

/** Hash-linked chain strip. Colors follow the ACTIVE verify result (live or tampered). */
export function ChainStrip({
  records,
  result,
  tampered,
}: {
  records: DecisionRecord[];
  result: VerifyResult | null;
  tampered: boolean;
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
              <div className={`rounded border px-2 py-1 font-mono text-[10px] leading-tight ${cls}`} title={r.id}>
                <div className="font-bold">#{i}</div>
                <div>{r.id.slice(-6)}</div>
              </div>
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
