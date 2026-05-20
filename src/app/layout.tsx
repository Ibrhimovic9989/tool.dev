import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "sonner";
import { Providers } from "@/components/providers";
import { inter, geistMono, instrumentSerif } from "@/lib/fonts";

export const metadata: Metadata = {
  title: "makemcp — agent-built MCP servers for public sector",
  description:
    "Tell an agent what data your team should expose to AI, and it builds, tests, and publishes a Model Context Protocol server for you.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${geistMono.variable} ${instrumentSerif.variable}`}
    >
      <body className="antialiased">
        <Providers>{children}</Providers>
        <Toaster richColors position="top-right" theme="dark" />
      </body>
    </html>
  );
}
