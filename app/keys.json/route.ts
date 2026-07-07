/**
 * GET /keys.json — the demo signer's public key, in the keys-file format
 * consumed by `npx @vorionsys/verify` and the in-browser verifier.
 */
import { NextResponse } from "next/server";
import { publicKeys } from "@/lib/server-gate";

export const dynamic = "force-dynamic";

export function GET(): NextResponse {
  return NextResponse.json(publicKeys());
}
