/**
 * POST /api/anchor — anchor a verified chain's tip into the Sigstore Rekor
 * public transparency log (append-only, third-party operated). Returns the
 * Rekor entry UUID + log index; anyone can independently fetch the entry and
 * compare it against the downloaded chain — no trust in this server required.
 */
import { NextResponse } from "next/server";
import { anchorTip, HttpError } from "@/lib/server-gate";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  let body: { chain?: unknown };
  try {
    body = (await req.json()) as { chain?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  try {
    return NextResponse.json(await anchorTip(body.chain ?? null));
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "anchoring failed" }, { status: 502 });
  }
}
