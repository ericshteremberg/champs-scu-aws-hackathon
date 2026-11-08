import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Causality — The whole story", template: "%s · Causality" },
  description: "Investigate disputes, connect the evidence, and prepare a considered response. Your records. Your control.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
