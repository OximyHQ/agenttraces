import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AgentTraces — System Atlas",
  description:
    "Explore every AgentTraces surface, system component, cloud flow, and repository module.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
