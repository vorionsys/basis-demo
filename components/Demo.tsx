"use client";
/**
 * The Quarter-Close demo orchestrator (SPEC-basis-demo §3).
 *
 * The gate runs server-side (/api/run); this component only narrates, renders,
 * and VERIFIES — every appended record re-verifies the whole chain in-browser
 * with @vorionsys/verify before it is rendered (RUNTIME_INVARIANTS §3).
 * The tamper control mutates a client-side COPY, never the signed original.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChainFile, DecisionRecord, KeysFile } from "@vorionsys/contracts/basis";
import { verifyChain, type VerifyResult } from "@vorionsys/verify";
import { RUNTIME_INVARIANTS, SCENARIO, type ScenarioStep, type StepKey } from "@/lib/scenario";
import { ChainStrip, CountdownPill, DecisionRow, EscalationModal } from "./parts";

type Phase = "idle" | "running" | "operator" | "countdown" | "done" | "error";

interface ConsoleCard {
  key: StepKey;
  title: string;
  narration: string; // grows char-by-char
  done: boolean;
  params: Record<string, unknown> | null;
}

interface StepResponse {
  record: DecisionRecord;
  chain: ChainFile;
  credentialExpiresAtMs?: number;
  error?: string;
}

const STEP_DELAY_MS = 700;
const TYPE_MS = 18;

export default function Demo() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [cards, setCards] = useState<ConsoleCard[]>([]);
  const [chain, setChain] = useState<ChainFile | null>(null);
  const [liveResult, setLiveResult] = useState<VerifyResult | null>(null);
  const [tamperResult, setTamperResult] = useState<VerifyResult | null>(null);
  const [tamperedChain, setTamperedChain] = useState<ChainFile | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [invariantsOk, setInvariantsOk] = useState<boolean | null>(null);

  const keysRef = useRef<KeysFile | null>(null);
  const sessionRef = useRef<string>("");
  const runIdRef = useRef(0); // invalidates in-flight runs on Replay

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const typeNarration = useCallback(async (step: ScenarioStep, runId: number) => {
    setCards((c) => [...c, { key: step.key, title: step.title, narration: "", done: false, params: step.action?.params ?? null }]);
    for (let i = 1; i <= step.narration.length; i++) {
      if (runIdRef.current !== runId) return;
      setCards((c) => c.map((card) => (card.key === step.key ? { ...card, narration: step.narration.slice(0, i) } : card)));
      await sleep(TYPE_MS);
    }
    setCards((c) => c.map((card) => (card.key === step.key ? { ...card, done: true } : card)));
  }, []);

  const post = useCallback(async (body: Record<string, unknown>): Promise<StepResponse> => {
    const res = await fetch("/api/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: sessionRef.current, ...body }),
    });
    const data = (await res.json()) as StepResponse;
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    return data;
  }, []);

  /** Verify in-browser BEFORE rendering the new chain state. */
  const acceptChain = useCallback((c: ChainFile): VerifyResult => {
    const keys = keysRef.current;
    if (!keys) throw new Error("keys.json not loaded");
    const result = verifyChain(c, keys);
    setChain(c);
    setLiveResult(result);
    if (!result.valid) throw new Error(`in-browser verification failed: ${result.firstFailure?.message}`);
    return result;
  }, []);

  const run = useCallback(async () => {
    const runId = ++runIdRef.current;
    setPhase("running");
    setCards([]);
    setChain(null);
    setLiveResult(null);
    setTamperResult(null);
    setTamperedChain(null);
    setSecondsLeft(null);
    setErrorMsg(null);
    setInvariantsOk(null);
    sessionRef.current = crypto.randomUUID();

    try {
      await post({ op: "start" });
      keysRef.current = (await (await fetch("/keys.json")).json()) as KeysFile;

      let expiresAtMs = 0;
      for (const step of SCENARIO) {
        if (runIdRef.current !== runId) return;

        if (step.key === "s3b") {
          // handled inside the s3 branch below (operator modal)
          continue;
        }

        await typeNarration(step, runId);
        if (runIdRef.current !== runId) return;

        if (step.key === "s5") {
          // visible countdown must reach zero before the server will accept s5
          setPhase("countdown");
          while (Date.now() < expiresAtMs + 250) {
            if (runIdRef.current !== runId) return;
            setSecondsLeft(Math.max(0, Math.ceil((expiresAtMs - Date.now()) / 1000)));
            await sleep(200);
          }
          setSecondsLeft(0);
          setPhase("running");
        }

        const resp = await post({ op: "step", key: step.key });
        if (runIdRef.current !== runId) return;
        acceptChain(resp.chain);

        if (step.key === "s3") {
          setPhase("operator");
          const resolution = await new Promise<"approve" | "deny">((resolve) => {
            operatorResolveRef.current = resolve;
          });
          if (runIdRef.current !== runId) return;
          const s3bCard = SCENARIO.find((s) => s.key === "s3b")!;
          await typeNarration(s3bCard, runId);
          const resolved = await post({ op: "resolve", resolution });
          if (runIdRef.current !== runId) return;
          acceptChain(resolved.chain);
          setPhase("running");
        }

        if (step.key === "s4" && resp.credentialExpiresAtMs) {
          expiresAtMs = resp.credentialExpiresAtMs;
          setSecondsLeft(Math.ceil((expiresAtMs - Date.now()) / 1000));
        }

        await sleep(STEP_DELAY_MS);
      }

      // RUNTIME_INVARIANTS (lib/scenario.ts)
      setChain((finalChain) => {
        if (finalChain) {
          const rs = finalChain.records;
          const s3 = rs[2];
          const s3b = rs[3];
          const ok =
            rs.length === RUNTIME_INVARIANTS.chainLength &&
            s3b.verdict.linksTo === s3.id &&
            Math.max(...rs.map((r) => r.verdict.latencyMs)) < RUNTIME_INVARIANTS.maxLatencyMs;
          setInvariantsOk(ok);
        }
        return finalChain;
      });
      setPhase("done");
    } catch (e) {
      if (runIdRef.current !== runId) return;
      setErrorMsg((e as Error).message);
      setPhase("error");
    }
  }, [acceptChain, post, typeNarration]);

  const operatorResolveRef = useRef<((r: "approve" | "deny") => void) | null>(null);

  // countdown ticker while waiting phases other than the s5 loop keep it fresh
  useEffect(() => {
    if (secondsLeft === null || secondsLeft <= 0) return;
    const t = setInterval(() => setSecondsLeft((s) => (s === null ? null : Math.max(0, s - 1))), 1000);
    return () => clearInterval(t);
  }, [secondsLeft]);

  const tamper = useCallback(() => {
    if (!chain || !keysRef.current) return;
    const copy = JSON.parse(JSON.stringify(chain)) as ChainFile;
    const target = copy.records[2]; // record #3 in the UI — the $250k escalation
    target.action.paramsHash = target.action.paramsHash.replace(/.$/, (c) => (c === "0" ? "1" : "0"));
    setTamperedChain(copy);
    setTamperResult(verifyChain(copy, keysRef.current));
  }, [chain]);

  const resetTamper = useCallback(() => {
    setTamperedChain(null);
    setTamperResult(null);
  }, []);

  const download = useCallback((name: string, data: unknown) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const records = chain?.records ?? [];
  const stripRecords = tamperedChain?.records ?? records;
  const stripResult = tamperResult ?? liveResult;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-4">
        <h1 className="text-xl font-bold">BASIS demo — Quarter-Close Agent</h1>
        <p className="text-sm text-[#8b949e]">
          A tier-2 finance agent runs a scripted quarter close against synthetic data. Every action passes a
          deterministic gate; every verdict is signed into a proof chain you can verify offline.
        </p>
      </header>

      <div className="mb-4 rounded-lg border border-[#58a6ff] bg-[#58a6ff]/10 px-4 py-2 text-sm font-semibold text-[#58a6ff]">
        Gate decisions are deterministic. No LLM evaluated any decision on this page.
      </div>

      {secondsLeft !== null && <div className="mb-4"><CountdownPill secondsLeft={secondsLeft} /></div>}

      {phase === "idle" && (
        <button
          onClick={run}
          className="mb-6 rounded-lg bg-[#58a6ff] px-6 py-3 font-bold text-white hover:bg-[#4493e6]"
        >
          Run the scenario
        </button>
      )}
      {phase === "error" && (
        <div className="mb-4 rounded-lg border border-[#f85149] bg-[#f85149]/10 px-4 py-2 text-sm text-[#f85149]">
          {errorMsg}
          <button onClick={run} className="ml-3 underline">retry</button>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {/* Left — Agent Console */}
        <section>
          <div className="mb-1 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-[#8b949e]">Agent console</h2>
            <span className="rounded border border-[#30363d] px-2 py-0.5 text-[10px] text-[#8b949e]" title="Live LLM mode ships later; the gate never depends on which mode is active.">
              Scripted · Live LLM (soon)
            </span>
          </div>
          <div className="space-y-2">
            {cards.map((card) => (
              <div key={card.key} className="record-in rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-2">
                <div className="text-xs font-bold text-[#e6edf3]">{card.title}</div>
                <p className={`text-sm text-[#8b949e] ${card.done ? "" : "type-caret"}`}>{card.narration}</p>
                {card.done && card.params && (
                  <pre className="mt-1 overflow-x-auto rounded bg-[#0d1117] p-2 font-mono text-[11px] text-[#8b949e]">
                    {JSON.stringify(card.params)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Right — Operator view */}
        <section>
          <h2 className="mb-1 text-sm font-semibold text-[#8b949e]">Operator view — decision feed</h2>
          <div className="space-y-2">
            {records.map((r) => (
              <DecisionRow key={r.id} record={r} />
            ))}
          </div>
          {records.length > 0 && (
            <div className="mt-4">
              <ChainStrip records={stripRecords} result={stripResult} tampered={tamperedChain !== null} />
            </div>
          )}
        </section>
      </div>

      {phase === "done" && (
        <footer className="mt-8 rounded-xl border border-[#30363d] bg-[#161b22] p-4">
          {invariantsOk !== null && (
            <p className={`mb-3 text-xs ${invariantsOk ? "text-[#3fb950]" : "text-[#f85149]"}`}>
              {invariantsOk
                ? `✓ runtime invariants hold: 6 records · s3b links to s3 · every gate decision < ${RUNTIME_INVARIANTS.maxLatencyMs}ms · chain verified in-browser before every render`
                : "✗ runtime invariant violation — this run is not trustworthy; please replay"}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <button onClick={() => download("chain.json", chain)} className="rounded-lg border border-[#30363d] px-4 py-2 text-sm hover:border-[#58a6ff]">
              Download chain.json
            </button>
            <button onClick={() => download("keys.json", keysRef.current)} className="rounded-lg border border-[#30363d] px-4 py-2 text-sm hover:border-[#58a6ff]">
              Download keys.json
            </button>
            {tamperedChain === null ? (
              <button onClick={tamper} className="rounded-lg border border-[#f85149] px-4 py-2 text-sm text-[#f85149] hover:bg-[#f85149]/10">
                Tamper with record #3
              </button>
            ) : (
              <button onClick={resetTamper} className="rounded-lg border border-[#30363d] px-4 py-2 text-sm hover:border-[#58a6ff]">
                Reset tamper
              </button>
            )}
            <button onClick={run} className="rounded-lg border border-[#30363d] px-4 py-2 text-sm hover:border-[#58a6ff]">
              Replay
            </button>
          </div>
          <p className="mt-3 text-xs text-[#8b949e]">
            Verify offline: <code className="rounded bg-[#0d1117] px-1.5 py-0.5">npx @vorionsys/verify chain.json --keys keys.json</code>
            {" "}· or use the{" "}
            <a href="/verifier.html" target="_blank" rel="noopener" className="text-[#58a6ff] underline">
              static verifier
            </a>{" "}
            (works from file:// on an air-gapped machine).
          </p>
        </footer>
      )}

      {phase === "operator" && (
        <EscalationModal
          amount="$250,000.00"
          onResolve={(r) => {
            operatorResolveRef.current?.(r);
            operatorResolveRef.current = null;
          }}
        />
      )}
    </main>
  );
}
