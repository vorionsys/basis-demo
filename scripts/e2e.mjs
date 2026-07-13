/**
 * End-to-end drive of the demo API — the same CHAIN-DRIVEN path the UI takes.
 * The server is stateless: the chain travels with every request and is
 * cryptographically re-verified before each append. Resolutions are applied
 * while an escalation is pending (multi-record conflict resolutions and
 * operator branches are first-class).
 *
 * Oracles are restated INDEPENDENTLY of lib/scenario.ts.
 * Run after `npm run build`:  node scripts/e2e.mjs   (~40s; honest 15s TTL)
 */
import { spawn, spawnSync } from "node:child_process";
import { verifyChain } from "@vorionsys/verify";

const PORT = 3123;
const BASE = `http://localhost:${PORT}`;

/** Default-path oracles: action keys + resolution plan + full expected sequence. */
const ORACLE = {
  "quarter-close": {
    actions: ["s1", "s2", "s3", "s4", "s5"], resolutions: ["deny"], ttlBefore: "s5",
    expected: ["allow/WITHIN_AUTHORITY", "allow/WITHIN_AUTHORITY", "escalate/TIER_CAP_EXCEEDED", "deny/HUMAN_DENIED", "deny/DOMAIN_NOT_ALLOWLISTED", "deny/CREDENTIAL_EXPIRED"],
  },
  "incident-response": {
    actions: ["i1", "i2", "i3", "i4", "i5"], resolutions: ["approve"],
    expected: ["allow/WITHIN_AUTHORITY", "allow/WITHIN_AUTHORITY", "escalate/TIER_CAP_EXCEEDED", "allow/HUMAN_APPROVED", "deny/DOMAIN_NOT_ALLOWLISTED", "deny/CREDENTIAL_REVOKED"],
  },
  "patient-records": {
    actions: ["p1", "p2", "p3", "p4", "p5"], resolutions: ["deny"],
    expected: ["allow/WITHIN_AUTHORITY", "allow/WITHIN_AUTHORITY", "escalate/TIER_CAP_EXCEEDED", "deny/HUMAN_DENIED", "deny/DOMAIN_NOT_ALLOWLISTED", "deny/CREDENTIAL_EXPIRED"],
  },
  "contract-award": {
    actions: ["g1", "g2", "g3", "g4"], resolutions: ["approve", "approve"],
    expected: ["allow/WITHIN_AUTHORITY", "allow/WITHIN_AUTHORITY", "escalate/TIER_CAP_EXCEEDED", "escalate/HUMAN_APPROVED", "allow/HUMAN_APPROVED", "deny/CAPABILITY_NOT_GRANTED"],
  },
  "loan-origination": {
    actions: ["l1", "l2", "l3", "l4", "l5", "l6"], resolutions: [],
    expected: ["allow/WITHIN_AUTHORITY", "allow/WITHIN_AUTHORITY", "deny/PARAM_NOT_ALLOWLISTED", "allow/WITHIN_AUTHORITY", "allow/WITHIN_AUTHORITY", "deny/RATE_LIMIT_EXCEEDED"],
  },
  "grid-ops": {
    actions: ["e1", "e2", "e3", "e4", "e5"], resolutions: ["deny"],
    expected: ["allow/WITHIN_AUTHORITY", "allow/WITHIN_AUTHORITY", "escalate/TIER_CAP_EXCEEDED", "deny/HUMAN_DENIED", "deny/CAPABILITY_NOT_GRANTED", "deny/CREDENTIAL_EXPIRED"],
  },
  // the two conflict scenarios: a quorate human approval that policy still denies
  "defense-logistics": {
    actions: ["d1", "d2", "d3", "d4", "d5", "d6", "d7"], resolutions: ["approve", "approve"],
    expected: [
      "allow/WITHIN_AUTHORITY", "allow/WITHIN_AUTHORITY", "deny/PARAM_NOT_ALLOWLISTED",
      "escalate/TIER_CAP_EXCEEDED", "escalate/HUMAN_APPROVED", "escalate/HUMAN_APPROVED",
      "deny/APPROVAL_CEILING_EXCEEDED", // quorum met — policy still says no
      "deny/CAPABILITY_NOT_GRANTED", "allow/WITHIN_AUTHORITY", "deny/RATE_LIMIT_EXCEEDED",
    ],
  },
  "claims-processing": {
    actions: ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"], resolutions: ["approve"],
    expected: [
      "allow/WITHIN_AUTHORITY", "allow/WITHIN_AUTHORITY", "deny/PARAM_NOT_ALLOWLISTED", "allow/WITHIN_AUTHORITY",
      "escalate/TIER_CAP_EXCEEDED", "escalate/HUMAN_APPROVED", "deny/APPROVAL_CEILING_EXCEEDED",
      "allow/WITHIN_AUTHORITY", "deny/RATE_LIMIT_EXCEEDED", "deny/CREDENTIAL_EXPIRED",
    ],
  },
};

const server = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["next", "start", "-p", String(PORT)], {
  cwd: new URL("..", import.meta.url),
  stdio: ["ignore", "pipe", "pipe"],
  shell: process.platform === "win32",
});
let serverOut = "";
server.stdout.on("data", (d) => (serverOut += d));
server.stderr.on("data", (d) => (serverOut += d));
const stopServer = () => {
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"]);
  else server.kill();
};
const die = (msg, code = 1) => {
  console.error(`FAIL: ${msg}`);
  stopServer();
  process.exit(code);
};

let ready = false;
for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch(`${BASE}/keys.json`);
    if (r.ok) { ready = true; break; }
  } catch { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 500));
}
if (!ready) die(`server never became ready.\n${serverOut}`);
const keys = await (await fetch(`${BASE}/keys.json`)).json();

const pendingIn = (chain) => {
  const closed = new Set(chain.records.filter((r) => r.verdict.linksTo && r.verdict.decision !== "escalate").map((r) => r.verdict.linksTo));
  return chain.records.find((r) => r.verdict.decision === "escalate" && r.verdict.linksTo === null && !closed.has(r.id));
};
const sig = (chain) => chain.records.map((r) => `${r.verdict.decision}/${r.verdict.reason}`).join(",");

async function runScripted(scenarioId, o, { resolutions = o.resolutions, tamperProbe = true } = {}) {
  let chain = null;
  const post = async (body, expect = 200) => {
    const res = await fetch(`${BASE}/api/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenarioId, chain, ...body }),
    });
    const data = await res.json();
    if (res.status !== expect) die(`${scenarioId}: expected HTTP ${expect}, got ${res.status}: ${JSON.stringify(data)}`);
    return data;
  };

  // out-of-order guard: last action first must be refused
  await post({ op: "step", key: o.actions[o.actions.length - 1] }, 409);

  const plan = [...resolutions];
  let ttlDeadline = 0;
  let probed = false;
  for (const key of o.actions) {
    if (o.ttlBefore === key && ttlDeadline) {
      await post({ op: "step", key }, 409); // pre-expiry refusal
      const wait = ttlDeadline - Date.now() + 500;
      console.log(`  waiting ${(wait / 1000).toFixed(1)}s TTL…`);
      await new Promise((r) => setTimeout(r, Math.max(0, wait)));
    }
    const r = await post({ op: "step", key });
    if (r.credentialExpiresAtMs && !ttlDeadline) ttlDeadline = r.credentialExpiresAtMs;
    chain = r.chain;

    while (pendingIn(chain)) {
      if (tamperProbe && !probed) {
        probed = true;
        const saved = chain;
        chain = JSON.parse(JSON.stringify(saved));
        chain.records[0].action.paramsHash = chain.records[0].action.paramsHash.replace(/.$/, (ch) => (ch === "0" ? "1" : "0"));
        await post({ op: "resolve", resolution: "deny" }, 409);
        chain = saved;
      }
      const resolution = plan.shift() ?? "deny";
      const r2 = await post({ op: "resolve", resolution });
      chain = r2.chain;
    }
  }
  await post({ op: "step", key: o.actions[0] }, 409); // completed: refuses more
  const v = verifyChain(chain, keys);
  if (!v.valid) die(`${scenarioId}: chain does not verify: ${JSON.stringify(v.firstFailure)}`);
  const maxLatency = Math.max(...chain.records.map((r) => r.verdict.latencyMs));
  if (maxLatency >= 50) die(`${scenarioId}: latency invariant violated (${maxLatency}ms)`);
  return chain;
}

// unknown scenario must 400
{
  const res = await fetch(`${BASE}/api/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scenarioId: "not-a-scenario", op: "step", key: "s1", chain: null }),
  });
  if (res.status !== 400) die(`unknown scenario: expected 400, got ${res.status}`);
  console.log("✓ unknown scenario refused (400)");
}

for (const [id, o] of Object.entries(ORACLE)) {
  console.log(`\n━━ ${id}`);
  const chain = await runScripted(id, o);
  if (sig(chain) !== o.expected.join(",")) {
    die(`${id} sequence mismatch:\nexpected ${o.expected.join(",")}\nactual   ${sig(chain)}`);
  }
  console.log(`✓ out-of-order · tamper-reject · frozen default path (${chain.records.length} records) · completed-refusal · verifies`);
}

// BRANCH TEST: defense-logistics, commander DENIES at the final approval —
// the other branch is honest: no ceiling denial, escalation closed by the human.
{
  console.log("\n━━ defense-logistics (deny branch)");
  const o = ORACLE["defense-logistics"];
  const chain = await runScripted("defense-logistics", o, { resolutions: ["approve", "deny"], tamperProbe: false });
  const expected = [
    "allow/WITHIN_AUTHORITY", "allow/WITHIN_AUTHORITY", "deny/PARAM_NOT_ALLOWLISTED",
    "escalate/TIER_CAP_EXCEEDED", "escalate/HUMAN_APPROVED", "deny/HUMAN_DENIED",
    "deny/CAPABILITY_NOT_GRANTED", "allow/WITHIN_AUTHORITY", "deny/RATE_LIMIT_EXCEEDED",
  ];
  if (sig(chain) !== expected.join(",")) die(`deny branch mismatch:\nexpected ${expected.join(",")}\nactual   ${sig(chain)}`);
  console.log(`✓ deny branch honest (${chain.records.length} records, no ceiling denial) · verifies`);
}

/* ── Gauntlet: seed-derived randomized mode ─────────────────────────────── */

async function runGauntlet(seed, resolveWith = "approve") {
  let chain = null;
  const post = async (body, expect = 200) => {
    const res = await fetch(`${BASE}/api/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenarioId: "gauntlet", seed, chain, ...body }),
    });
    const data = await res.json();
    if (res.status !== expect) die(`gauntlet(${seed}): expected ${expect}, got ${res.status}: ${JSON.stringify(data)}`);
    return data;
  };
  for (let guard = 0; guard < 60; guard++) {
    const r = await post({ op: "step" });
    chain = r.chain;
    if (r.record.verdict.decision === "escalate" && !r.done) {
      const r2 = await post({ op: "resolve", resolution: resolveWith });
      chain = r2.chain;
      if (r2.done) return chain;
    }
    if (r.done) return chain;
  }
  die(`gauntlet(${seed}): never finished`);
}

{
  const seed = "E2ETEST1";
  const c1 = await runGauntlet(seed);
  const c2 = await runGauntlet(seed);
  const gsig = (c) => c.records.map((r) => [r.verdict.decision, r.verdict.reason, r.agent.tier].join("/")).join(",");
  if (gsig(c1) !== gsig(c2)) die(`gauntlet determinism: same seed produced different runs`);
  const result = verifyChain(c1, keys);
  if (!result.valid) die(`gauntlet chain does not verify: ${JSON.stringify(result.firstFailure)}`);
  console.log(`\n━━ gauntlet (${seed})\n✓ deterministic replay (${c1.records.length} records) · chain verifies`);

  let breakerSeen = 0, conflictSeen = 0;
  for (const s of ["SWEEP001", "SWEEP002", "SWEEP003", "SWEEP004", "SWEEP005", "SWEEP006", "SWEEP007", "SWEEP008"]) {
    const c = await runGauntlet(s, s === "SWEEP002" ? "deny" : "approve");
    const v = verifyChain(c, keys);
    if (!v.valid) die(`gauntlet sweep ${s}: chain invalid`);
    if (c.records.some((r) => r.agent.tier < 0)) die(`gauntlet sweep ${s}: negative tier`);
    const bIdx = c.records.findIndex((r) => r.verdict.reason === "CIRCUIT_BREAKER_OPEN");
    if (bIdx !== -1) {
      breakerSeen++;
      // PROBATION (score 6) already breaker-gates execute-class: two weight-3
      // denies suffice. Assert real strike history, not a naive deny count.
      const priorDenies = c.records.slice(0, bIdx).filter((r) => r.verdict.decision === "deny").length;
      if (priorDenies < 2) die(`gauntlet sweep ${s}: breaker after only ${priorDenies} denies`);
    }
    // emergent approval-conflict: any ceiling denial must directly follow a signed vote for the same escalation
    for (let i = 0; i < c.records.length; i++) {
      const r = c.records[i];
      if (r.verdict.reason === "APPROVAL_CEILING_EXCEEDED") {
        conflictSeen++;
        const vote = c.records[i - 1];
        if (!(vote?.verdict.reason === "HUMAN_APPROVED" && vote.verdict.linksTo === r.verdict.linksTo)) {
          die(`gauntlet sweep ${s}: ceiling denial without its paired signed vote`);
        }
      }
    }
  }
  console.log(`✓ 8-seed sweep verifies · ${breakerSeen} breaker run(s) · ${conflictSeen} emergent approval-conflict(s), each paired with its signed vote`);
}

stopServer();
console.log("\nE2E PASS — 8 scenarios + deny branch + gauntlet");
process.exit(0);
