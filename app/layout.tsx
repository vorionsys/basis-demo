import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BASIS demo — unpredictable agents, deterministic governance",
  description:
    "Nine scripted scenarios and a seed-derived gauntlet: deterministic decisions, degrading authority, bounded approval, proven completion — every verdict signed into a proof chain you can verify offline.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
