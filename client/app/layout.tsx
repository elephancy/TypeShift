import type { ReactNode } from "react";
import type { Metadata } from "next";
import "../src/styles.css";
import { fontAccessible, fontBody, fontDisplay, fontUi } from "../src/lib/fonts";

export const metadata: Metadata = {
  metadataBase: new URL("https://typeshift.elfeel.me"),
  title: "TypeShift | Typing Games and Practice",
  description:
    "Practice typing with timed drills, creative game modes, replays and leaderboards. Explore TypeShift's typing arcade and training tools.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/logo.png", type: "image/png" },
    ],
    apple: [{ url: "/logo.png", type: "image/png" }],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${fontBody.variable} ${fontDisplay.variable} ${fontUi.variable} ${fontAccessible.variable}`}
    >
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="theme-color" content="#0b1220" />
        <meta name="color-scheme" content="dark light" />
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="apple-touch-icon" href="/logo.png" />
        <link rel="prefetch" href="/data/english-2-12.txt" />
      </head>
      <body suppressHydrationWarning>
        <script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js"
          async
          defer
        />
        {children}
      </body>
    </html>
  );
}
