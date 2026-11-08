import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Causality — The whole story", template: "%s · Causality" },
  description: "Investigate disputes, connect the evidence, and prepare a considered response. Your records. Your control.",
  icons: {
    icon: [
      { url: "/favicon.svg?v=2", type: "image/svg+xml" },
      { url: "/favicon-32.png?v=2", type: "image/png", sizes: "32x32" },
    ],
    shortcut: "/favicon.ico?v=2",
    apple: "/apple-touch-icon.png?v=2",
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
