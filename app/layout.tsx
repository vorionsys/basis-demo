import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BASIS demo — Quarter-Close Agent",
  description:
    "A BASIS-gated finance agent gets allowed, escalated, and denied in five actions. Deterministic decisions, fail-closed authority, offline-verifiable proof chain.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
