"use client";
/**
 * The demo orchestrator (SPEC-basis-demo §3, generalized to a scenario picker).
 *
 * The gate runs server-side (/api/run); this component only narrates, renders,
 * and VERIFIES — every appended record re-verifies the whole chain in-browser
 * with @vorionsys/verify before it is rendered (RUNTIME_INVARIANTS).
 * The tamper control mutates a client-side COPY, never the signed original.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChainFile, KeysFile } from "@vorionsys/contracts/basis";
import { verifyChain, type VerifyResult } from "@vorionsys/verify";
import { RUNTIME_INVARIANTS, SCENARIOS, type ScenarioDef, type ScenarioStep } from "@/lib/scenario";
import { ChainStrip, CountdownPill, DecisionRow, EscalationModal } from "./parts";

type Phase = "idle" | "running" | "operator" | "countdown" | "done" | "error";

interface ConsoleCard {
  key: string;
  title: string;
  narration: string; // grows char-by-char
  done: boolean;
  params: Record<string, unknown> | null;
}

interface StepResponse {
  record: { id: string };
  chain: ChainFile;
  credentialExpiresAtMs?: number;
  error?: string;
}

const STEP_DELAY_MS = 700;
const TYPE_MS = 18;

export default function Demo() {
  const [scenario, setScenario] = useState<ScenarioDef | null>(null);
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
  /** The chain we hold IS the session — the server is stateless and re-verifies
   *  this cryptographically on every request before appending. */
  const chainRef = useRef<ChainFile | null>(null);
  const runIdRef = useRef(0); // invalidates in-flight runs on Replay
  const operatorResolveRef = useRef<((r: "approve" | "deny") => void) | null>(null);

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

  const post = useCallback(async (def: ScenarioDef, body: Record<string, unknown>): Promise<StepResponse> => {
    const res = await fetch("/api/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenarioId: def.id, chain: chainRef.current, ...body }),
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
    chainRef.current = c;
    setChain(c);
    setLiveResult(result);
    if (!result.valid) throw new Error(`in-browser verification failed: ${result.firstFailure?.message}`);
    return result;
  }, []);

  const run = useCallback(
    async (def: ScenarioDef) => {
      const runId = ++runIdRef.current;
      setScenario(def);
      setPhase("running");
      setCards([]);
      setChain(null);
      setLiveResult(null);
      setTamperResult(null);
      setTamperedChain(null);
      setSecondsLeft(null);
      setErrorMsg(null);
      setInvariantsOk(null);
      chainRef.current = null;

      try {
        keysRef.current = (await (await fetch("/keys.json")).json()) as KeysFile;

        let expiresAtMs = 0;
        let latestChain: ChainFile | null = null;
        for (const step of def.steps) {
          if (runIdRef.current !== runId) return;
          await typeNarration(step, runId);
          if (runIdRef.current !== runId) return;

          if (step.action === null) {
            // resolution: scripted (quorum non-final votes) or operator modal
            let resolution: "approve" | "deny";
            if (step.autoResolution) {
              resolution = step.autoResolution;
            } else {
              setPhase("operator");
              resolution = await new Promise<"approve" | "deny">((resolve) => {
                operatorResolveRef.current = resolve;
              });
              if (runIdRef.current !== runId) return;
            }
            const resolved = await post(def, { op: "resolve", resolution });
            if (runIdRef.current !== runId) return;
            acceptChain(resolved.chain);
            latestChain = resolved.chain;
            setPhase("running");
          } else {
            if (step.trigger === "afterCredentialExpiry") {
              // visible countdown must reach zero before the server will accept it
              setPhase("countdown");
              while (Date.now() < expiresAtMs + 250) {
                if (runIdRef.current !== runId) return;
                setSecondsLeft(Math.max(0, Math.ceil((expiresAtMs - Date.now()) / 1000)));
                await sleep(200);
              }
              setSecondsLeft(0);
              setPhase("running");
            }
            const resp = await post(def, { op: "step", key: step.key });
            if (runIdRef.current !== runId) return;
            acceptChain(resp.chain);
            latestChain = resp.chain;
            if (resp.credentialExpiresAtMs && !expiresAtMs) {
              expiresAtMs = resp.credentialExpiresAtMs;
              setSecondsLeft(Math.ceil((expiresAtMs - Date.now()) / 1000));
            }
          }
          await sleep(STEP_DELAY_MS);
        }

        // RUNTIME_INVARIANTS (lib/scenario.ts)
        if (latestChain) {
          const rs = latestChain.records;
          const escalations = new Map(rs.filter((r) => r.verdict.decision === "escalate").map((r) => [r.id, r]));
          const resolutions = rs.filter((r) => r.verdict.reason === "HUMAN_APPROVED" || r.verdict.reason === "HUMAN_DENIED");
          const ok =
            rs.length === def.steps.length &&
            resolutions.every((r) => r.verdict.linksTo !== null && escalations.has(r.verdict.linksTo)) &&
            Math.max(...rs.map((r) => r.verdict.latencyMs)) < RUNTIME_INVARIANTS.maxLatencyMs;
          setInvariantsOk(ok);
        }
        setPhase("done");
      } catch (e) {
        if (runIdRef.current !== runId) return;
        setErrorMsg((e as Error).message);
        setPhase("error");
      }
    },
    [acceptChain, post, typeNarration],
  );

  // countdown ticker (the pre-step loop keeps it fresh while actively waiting)
  useEffect(() => {
    if (secondsLeft === null || secondsLeft <= 0) return;
    const t = setInterval(() => setSecondsLeft((s) => (s === null ? null : Math.max(0, s - 1))), 1000);
    return () => clearInterval(t);
  }, [secondsLeft]);

  /** Tamper with the escalation record's paramsHash in a CLIENT-SIDE COPY. */
  const tamper = useCallback(() => {
    if (!chain || !keysRef.current) return;
    const copy = JSON.parse(JSON.stringify(chain)) as ChainFile;
    const idx = copy.records.findIndex((r) => r.verdict.decision === "escalate");
    const target = copy.records[idx === -1 ? 0 : idx];
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
  const tamperIndex = stripRecords.findIndex((r) => r.verdict.decision === "escalate");

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-4">
        <h1 className="text-xl font-bold">BASIS demo — deterministic gates, provable history</h1>
        <p className="text-sm text-[#8b949e]">
          Pick a scenario. Every action passes a deterministic gate; every verdict is signed into a proof chain you can
          verify offline. All data synthetic.
        </p>
      </header>

      <div className="mb-4 rounded-lg border border-[#58a6ff] bg-[#58a6ff]/10 px-4 py-2 text-sm font-semibold text-[#58a6ff]">
        Gate decisions are deterministic. No LLM evaluated any decision on this page.
      </div>

      {secondsLeft !== null && (
        <div className="mb-4">
          <CountdownPill secondsLeft={secondsLeft} credentialId={scenario?.credential.id ?? ""} />
        </div>
      )}

      {phase === "idle" && (
        <div className="grid gap-4 md:grid-cols-3">
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              onClick={() => run(s)}
              className="group rounded-xl border border-[#30363d] bg-[#161b22] p-4 text-left transition hover:border-[#58a6ff]"
            >
              <div className="text-xs font-bold tracking-wide text-[#58a6ff]">{s.vertical.toUpperCase()}</div>
              <h2 className="mb-1 text-base font-semibold text-[#e6edf3]">{s.title}</h2>
              <p className="mb-3 text-xs leading-relaxed text-[#8b949e]">{s.tagline}</p>
              <div className="flex flex-wrap gap-1">
                {s.showcases.map((code) => (
                  <span key={code} className="rounded border border-[#30363d] px-1.5 py-0.5 font-mono text-[10px] text-[#8b949e]">
                    {code}
                  </span>
                ))}
              </div>
              <div className="mt-3 text-sm font-semibold text-[#58a6ff] opacity-80 group-hover:opacity-100">
                Run this scenario →
              </div>
            </button>
          ))}
        </div>
      )}

      {phase === "error" && (
        <div className="mb-4 rounded-lg border border-[#f85149] bg-[#f85149]/10 px-4 py-2 text-sm text-[#f85149]">
          {errorMsg}
          {scenario && (
            <button onClick={() => run(scenario)} className="ml-3 underline">
              retry
            </button>
          )}
        </div>
      )}

      {phase !== "idle" && scenario && (
        <div className="grid gap-6 md:grid-cols-2">
          {/* Left — Agent Console */}
          <section>
            <div className="mb-1 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-[#8b949e]">
                Agent console — {scenario.title} <span className="text-[#58a6ff]">({scenario.vertical})</span>
              </h2>
              <span
                className="rounded border border-[#30363d] px-2 py-0.5 text-[10px] text-[#8b949e]"
                title="Live LLM mode ships later; the gate never depends on which mode is active."
              >
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
      )}

      {phase === "done" && scenario && (
        <footer className="mt-8 rounded-xl border border-[#30363d] bg-[#161b22] p-4">
          {invariantsOk !== null && (
            <p className={`mb-3 text-xs ${invariantsOk ? "text-[#3fb950]" : "text-[#f85149]"}`}>
              {invariantsOk
                ? `✓ runtime invariants hold: ${scenario.steps.length} records · every human resolution links to its escalation · every gate decision < ${RUNTIME_INVARIANTS.maxLatencyMs}ms · chain verified in-browser before every render`
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
                Tamper with record #{tamperIndex === -1 ? 0 : tamperIndex}
              </button>
            ) : (
              <button onClick={resetTamper} className="rounded-lg border border-[#30363d] px-4 py-2 text-sm hover:border-[#58a6ff]">
                Reset tamper
              </button>
            )}
            <button onClick={() => run(scenario)} className="rounded-lg border border-[#30363d] px-4 py-2 text-sm hover:border-[#58a6ff]">
              Replay
            </button>
            <button
              onClick={() => {
                runIdRef.current++;
                setPhase("idle");
                setScenario(null);
                setChain(null);
                chainRef.current = null;
                setLiveResult(null);
                setTamperResult(null);
                setTamperedChain(null);
                setSecondsLeft(null);
                setCards([]);
              }}
              className="rounded-lg border border-[#30363d] px-4 py-2 text-sm hover:border-[#58a6ff]"
            >
              Choose another scenario
            </button>
          </div>
          <p className="mt-3 text-xs text-[#8b949e]">
            Verify offline: <code className="rounded bg-[#0d1117] px-1.5 py-0.5">npx @vorionsys/verify chain.json --keys keys.json</code>{" "}
            · or use the{" "}
            <a href="/verifier.html" target="_blank" rel="noopener" className="text-[#58a6ff] underline">
              static verifier
            </a>{" "}
            (works from file:// on an air-gapped machine).
          </p>
        </footer>
      )}

      {phase === "operator" && scenario && (
        <EscalationModal
          subject={scenario.operatorPrompt.subject}
          detail={scenario.operatorPrompt.detail}
          onResolve={(r) => {
            operatorResolveRef.current?.(r);
            operatorResolveRef.current = null;
          }}
        />
      )}
    </main>
  );
}
