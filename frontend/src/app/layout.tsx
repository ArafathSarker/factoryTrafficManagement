import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Factory Traffic Management",
  description: "Live dashboard for internal factory traffic signal control",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">{children}</body>
    </html>
  );
}