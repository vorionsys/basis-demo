/**
 * End-to-end drive of the demo API — the same path the UI takes.
 * The server is STATELESS: the chain travels with every request and is
 * cryptographically re-verified before each append. This script asserts the
 * frozen (decision, reason) sequence, the s3b→s3 link, out-of-order and
 * pre-expiry refusals, rejection of a tampered submitted chain, and finally
 * verifies the result with @vorionsys/verify.
 *
 * Run after `npm run build`:  node scripts/e2e.mjs
 * NOTE: waits the honest 15s credential TTL — total runtime ~25s.
 */
import { spawn, spawnSync } from "node:child_process";
import { verifyChain } from "@vorionsys/verify";

const PORT = 3123;
const BASE = `http://localhost:${PORT}`;

// Independent restatement of the frozen spec table (deny path).
const EXPECTED = [
  ["allow", "WITHIN_AUTHORITY"],
  ["allow", "WITHIN_AUTHORITY"],
  ["escalate", "TIER_CAP_EXCEEDED"],
  ["deny", "HUMAN_DENIED"],
  ["deny", "DOMAIN_NOT_ALLOWLISTED"],
  ["deny", "CREDENTIAL_EXPIRED"],
];

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

// wait for readiness
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

let chain = null; // the client-held session
const post = async (body, expectStatus = 200) => {
  const res = await fetch(`${BASE}/api/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chain, ...body }),
  });
  const data = await res.json();
  if (res.status !== expectStatus) die(`expected HTTP ${expectStatus}, got ${res.status}: ${JSON.stringify(data)}`);
  return data;
};
const advance = (resp) => { chain = resp.chain; return resp; };

// out-of-order: s5 with an empty chain must be refused
await post({ op: "step", key: "s5" }, 409);
console.log("✓ s5 refused out of order (409)");

advance(await post({ op: "step", key: "s1" }));
advance(await post({ op: "step", key: "s2" }));
const s3 = advance(await post({ op: "step", key: "s3" }));
if (s3.record.verdict.decision !== "escalate") die("s3 did not escalate");

// tampered submitted chain must be rejected by server-side re-verification
const saved = chain;
chain = JSON.parse(JSON.stringify(saved));
chain.records[1].action.paramsHash = chain.records[1].action.paramsHash.replace(/.$/, (c) => (c === "0" ? "1" : "0"));
await post({ op: "resolve", resolution: "deny" }, 409);
chain = saved;
console.log("✓ tampered submitted chain rejected (409, server re-verifies)");

const s3b = advance(await post({ op: "resolve", resolution: "deny" }));
if (s3b.record.verdict.linksTo !== s3.record.id) die("s3b does not link to s3");
console.log("✓ s3 escalated, s3b links to it");

const s4 = advance(await post({ op: "step", key: "s4" }));
if (!s4.credentialExpiresAtMs) die("s4 did not report the credential TTL");

// s5 before expiry must be refused
await post({ op: "step", key: "s5" }, 409);
console.log("✓ s5 refused before credential expiry (409)");

const waitMs = s4.credentialExpiresAtMs - Date.now() + 500;
console.log(`  waiting ${(waitMs / 1000).toFixed(1)}s for the honest credential TTL…`);
await new Promise((r) => setTimeout(r, waitMs));

advance(await post({ op: "step", key: "s5" }));

// frozen sequence
const actual = chain.records.map((r) => [r.verdict.decision, r.verdict.reason]);
if (JSON.stringify(actual) !== JSON.stringify(EXPECTED)) {
  die(`chain sequence mismatch:\nexpected ${JSON.stringify(EXPECTED)}\nactual   ${JSON.stringify(actual)}`);
}
console.log("✓ chain matches the frozen 6-record sequence (deny path)");

// scenario complete — a 7th step must be refused
await post({ op: "step", key: "s1" }, 409);
console.log("✓ completed scenario refuses further steps (409)");

// s5 credential state + latency invariant
const last = chain.records[5];
if (last.agent.credential.status !== "expired") die("s5 record credential status is not 'expired'");
const maxLatency = Math.max(...chain.records.map((r) => r.verdict.latencyMs));
if (maxLatency >= 50) die(`latency invariant violated: ${maxLatency}ms`);
console.log(`✓ fail-closed s5 (credential expired) · max gate latency ${maxLatency}ms < 50ms`);

// offline verification — same core as the CLI
const result = verifyChain(chain, keys);
if (!result.valid) die(`chain does not verify: ${JSON.stringify(result.firstFailure)}`);
console.log(`✓ chain verifies (${result.records.length} records, signer ${result.signers.join(",")})`);

stopServer();
console.log("\nE2E PASS");
process.exit(0);
