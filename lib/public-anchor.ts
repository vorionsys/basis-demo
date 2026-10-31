/**
 * Public anchoring posts the canonical last decision record, its signature,
 * and the signing public key to the Sigstore Rekor log. That write is
 * permanent. It stays off unless BASIS_DEMO_ANCHOR is exactly "1".
 */
export function publicAnchorEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.BASIS_DEMO_ANCHOR === "1";
}
