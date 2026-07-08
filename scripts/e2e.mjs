/**
 * End-to-end drive of the demo API — the same path the UI takes, across ALL
 * scenarios. The server is STATELESS: the chain travels with every request and
 * is cryptographically re-verified before each append.
 *
 * Expected sequences are restated INDEPENDENTLY of lib/scenario.ts — this file
 * is the oracle, not a mirror of the implementation.
 *
 * Run after `npm run build`:  node scripts/e2e.mjs
 * NOTE: quarter-close waits its honest 15s credential TTL — total ~35s.
 */
import { spawn, spawnSync } from "node:child_process";
import { verifyChain } from "@vorionsys/verify";

const PORT = 3123;
const BASE = `http://localhost:${PORT}`;

/** Independent restatement of each frozen script (default operator choice). */
const ORACLE = {
  "quarter-close": {
    steps: ["s1", "s2", "s3", "resolve", "s4", "s5"],
    resolution: "deny",
    hasTtl: true,
    expected: [
      ["allow", "WITHIN_AUTHORITY"],
      ["allow", "WITHIN_AUTHORITY"],
      ["escalate", "TIER_CAP_EXCEEDED"],
      ["deny", "HUMAN_DENIED"],
      ["deny", "DOMAIN_NOT_ALLOWLISTED"],
      ["deny", "CREDENTIAL_EXPIRED"],
    ],
  },
  "incident-response": {
    steps: ["i1", "i2", "i3", "resolve", "i4", "i5"],
    resolution: "approve",
    hasTtl: false,
    expected: [
      ["allow", "WITHIN_AUTHORITY"],
      ["allow", "WITHIN_AUTHORITY"],
      ["escalate", "TIER_CAP_EXCEEDED"],
      ["allow", "HUMAN_APPROVED"],
      ["deny", "DOMAIN_NOT_ALLOWLISTED"],
      ["deny", "CREDENTIAL_REVOKED"],
    ],
  },
  "patient-records": {
    steps: ["p1", "p2", "p3", "resolve", "p4", "p5"],
    resolution: "deny",
    hasTtl: false,
    expected: [
      ["allow", "WITHIN_AUTHORITY"],
      ["allow", "WITHIN_AUTHORITY"],
      ["escalate", "TIER_CAP_EXCEEDED"],
      ["deny", "HUMAN_DENIED"],
      ["deny", "DOMAIN_NOT_ALLOWLISTED"],
      ["deny", "CREDENTIAL_EXPIRED"],
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

// On Windows, killing the npx wrapper orphans the actual server — kill the tree.
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

async function runScenario(scenarioId, oracle) {
  console.log(`\n━━ ${scenarioId} (${oracle.resolution} path)`);
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

  // out-of-order: the LAST step with an empty chain must be refused
  const lastKey = oracle.steps[oracle.steps.length - 1];
  await post({ op: "step", key: lastKey }, 409);
  console.log(`✓ ${lastKey} refused out of order`);

  let ttlDeadline = 0;
  for (const token of oracle.steps) {
    if (token === "resolve") {
      // tamper-rejection probe, once per scenario, right before resolution
      const saved = chain;
      chain = JSON.parse(JSON.stringify(saved));
      chain.records[0].action.paramsHash = chain.records[0].action.paramsHash.replace(/.$/, (c) => (c === "0" ? "1" : "0"));
      await post({ op: "resolve", resolution: oracle.resolution }, 409);
      chain = saved;
      const r = await post({ op: "resolve", resolution: oracle.resolution });
      const esc = r.chain.records.find((rec) => rec.verdict.decision === "escalate");
      if (r.record.verdict.linksTo !== esc.id) die(`${scenarioId}: resolution does not link to escalation`);
      chain = r.chain;
      console.log("✓ tamper rejected · resolution links to escalation");
    } else {
      if (oracle.hasTtl && token === oracle.steps[oracle.steps.length - 1] && ttlDeadline) {
        await post({ op: "step", key: token }, 409); // pre-expiry refusal
        const wait = ttlDeadline - Date.now() + 500;
        console.log(`✓ pre-expiry ${token} refused · waiting ${(wait / 1000).toFixed(1)}s TTL…`);
        await new Promise((r) => setTimeout(r, Math.max(0, wait)));
      }
      const r = await post({ op: "step", key: token });
      if (r.credentialExpiresAtMs && !ttlDeadline) ttlDeadline = r.credentialExpiresAtMs;
      chain = r.chain;
    }
  }

  const actual = chain.records.map((r) => [r.verdict.decision, r.verdict.reason]);
  if (JSON.stringify(actual) !== JSON.stringify(oracle.expected)) {
    die(`${scenarioId} sequence mismatch:\nexpected ${JSON.stringify(oracle.expected)}\nactual   ${JSON.stringify(actual)}`);
  }
  await post({ op: "step", key: oracle.steps[0] }, 409); // completed scenario refuses more
  const maxLatency = Math.max(...chain.records.map((r) => r.verdict.latencyMs));
  if (maxLatency >= 50) die(`${scenarioId}: latency invariant violated (${maxLatency}ms)`);
  const result = verifyChain(chain, keys);
  if (!result.valid) die(`${scenarioId}: chain does not verify: ${JSON.stringify(result.firstFailure)}`);
  console.log(`✓ frozen sequence · completed-refusal · ${maxLatency}ms max latency · chain verifies`);
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

for (const [id, oracle] of Object.entries(ORACLE)) await runScenario(id, oracle);

stopServer();
console.log("\nE2E PASS — all scenarios");
process.exit(0);
