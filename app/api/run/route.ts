/**
 * POST /api/run — advance the demo scenario, statelessly. Ops:
 *   { op: "step", key: "s1" | "s2" | "s3" | "s4" | "s5", chain: ChainFile | null }
 *   { op: "resolve", resolution: "approve" | "deny", chain: ChainFile }
 * The submitted chain is cryptographically re-verified server-side before any
 * append — the chain IS the session; the server holds no state. Gate evaluation
 * and signing happen here; the client only renders (and re-verifies again).
 */
import { NextResponse } from "next/server";
import { HttpError, resolveEscalation, runStep } from "@/lib/server-gate";
import type { StepKey } from "@/lib/scenario";

export const dynamic = "force-dynamic";

interface RunBody {
  op?: "step" | "resolve";
  key?: StepKey;
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

  try {
    if (body.op === "step") {
      if (!body.key) return NextResponse.json({ error: "key required for op:step" }, { status: 400 });
      return NextResponse.json(runStep(body.chain ?? null, body.key));
    }
    if (body.op === "resolve") {
      if (body.resolution !== "approve" && body.resolution !== "deny") {
        return NextResponse.json({ error: 'resolution must be "approve" or "deny"' }, { status: 400 });
      }
      return NextResponse.json(resolveEscalation(body.chain ?? null, body.resolution));
    }
    return NextResponse.json({ error: `unknown op "${String(body.op)}"` }, { status: 400 });
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
