/**
 * POST /api/run — advance a demo session. Ops:
 *   { sessionId, op: "start" }
 *   { sessionId, op: "step", key: "s1" | "s2" | "s3" | "s4" | "s5" }
 *   { sessionId, op: "resolve", resolution: "approve" | "deny" }
 * Gate evaluation and signing happen here, server-side; the client only renders.
 */
import { NextResponse } from "next/server";
import { HttpError, resolveEscalation, runStep, startSession } from "@/lib/server-gate";
import type { StepKey } from "@/lib/scenario";

export const dynamic = "force-dynamic";

interface RunBody {
  sessionId?: string;
  op?: "start" | "step" | "resolve";
  key?: StepKey;
  resolution?: "approve" | "deny";
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: RunBody;
  try {
    body = (await req.json()) as RunBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const { sessionId, op } = body;
  if (!sessionId || typeof sessionId !== "string" || sessionId.length > 128) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  try {
    if (op === "start") {
      startSession(sessionId);
      return NextResponse.json({ ok: true });
    }
    if (op === "step") {
      if (!body.key) return NextResponse.json({ error: "key required for op:step" }, { status: 400 });
      return NextResponse.json(runStep(sessionId, body.key));
    }
    if (op === "resolve") {
      if (body.resolution !== "approve" && body.resolution !== "deny") {
        return NextResponse.json({ error: 'resolution must be "approve" or "deny"' }, { status: 400 });
      }
      return NextResponse.json(resolveEscalation(sessionId, body.resolution));
    }
    return NextResponse.json({ error: `unknown op "${op}"` }, { status: 400 });
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
