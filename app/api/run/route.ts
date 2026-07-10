/**
 * POST /api/run — advance a demo scenario, statelessly. Ops:
 *   { op: "step", scenarioId, key, chain: ChainFile | null }
 *   { op: "resolve", scenarioId, resolution: "approve" | "deny", chain: ChainFile }
 * The submitted chain is cryptographically re-verified server-side before any
 * append — the chain IS the session; the server holds no state. Gate evaluation
 * and signing happen here; the client only renders (and re-verifies again).
 */
import { NextResponse } from "next/server";
import { gauntletResolve, gauntletRunStep, HttpError, resolveEscalation, runStep } from "@/lib/server-gate";
import { DEFAULT_SCENARIO_ID } from "@/lib/scenario";
import { GAUNTLET_ID } from "@/lib/gauntlet";

export const dynamic = "force-dynamic";

interface RunBody {
  op?: "step" | "resolve";
  scenarioId?: string;
  key?: string;
  seed?: string;
  resolution?: "approve" | "deny";
  chain?: unknown;
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: RunBody;
  try {
    body = (await req.json()) as RunBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const scenarioId = body.scenarioId ?? DEFAULT_SCENARIO_ID;

  try {
    if (scenarioId === GAUNTLET_ID) {
      // seed-derived randomized mode: the server generates the action; clients
      // cannot inject one. Same statelessness — the chain travels each request.
      if (body.op === "step") return NextResponse.json(gauntletRunStep(body.seed, body.chain ?? null));
      if (body.op === "resolve") {
        if (body.resolution !== "approve" && body.resolution !== "deny") {
          return NextResponse.json({ error: 'resolution must be "approve" or "deny"' }, { status: 400 });
        }
        return NextResponse.json(gauntletResolve(body.seed, body.chain ?? null, body.resolution));
      }
      return NextResponse.json({ error: `unknown op "${String(body.op)}"` }, { status: 400 });
    }
    if (body.op === "step") {
      if (!body.key) return NextResponse.json({ error: "key required for op:step" }, { status: 400 });
      return NextResponse.json(runStep(scenarioId, body.chain ?? null, body.key));
    }
    if (body.op === "resolve") {
      if (body.resolution !== "approve" && body.resolution !== "deny") {
        return NextResponse.json({ error: 'resolution must be "approve" or "deny"' }, { status: 400 });
      }
      return NextResponse.json(resolveEscalation(scenarioId, body.chain ?? null, body.resolution));
    }
    return NextResponse.json({ error: `unknown op "${String(body.op)}"` }, { status: 400 });
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
