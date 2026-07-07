import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship plain ESM in dist/ — no transpilation needed.
  // No analytics, no telemetry beyond Vercel defaults (SPEC-basis-demo §4).
};

export default nextConfig;
