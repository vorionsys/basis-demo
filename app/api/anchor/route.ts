/**
 * POST /api/anchor — off unless BASIS_DEMO_ANCHOR=1.
 * When enabled, posts the full last decision record, its signature, and the
 * public key to the Sigstore Rekor log (append-only, public, permanent).
 * Returns the Rekor entry UUID + log index. This route does not call Rekor
 * while the flag is unset.
 */
import { NextResponse } from "next/server";
import { publicAnchorEnabled } from "@/lib/public-anchor";
import { anchorTip, HttpError } from "@/lib/server-gate";

export const dynamic = "force-dynamic";

const ANCHOR_OFF = {
  error:
    "public anchoring is off; set BASIS_DEMO_ANCHOR=1 to enable it. That posts the full last decision record, its signature, and the public key to the public Rekor log.",
};

export async function POST(req: Request): Promise<NextResponse> {
  if (!publicAnchorEnabled()) {
    return NextResponse.json(ANCHOR_OFF, { status: 403 });
  }
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
