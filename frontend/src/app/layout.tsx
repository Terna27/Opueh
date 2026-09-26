import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { Starfield } from "@/components/layout/starfield";
import { SessionProvider } from "@/lib/auth/session-context";
import { site } from "@/lib/site";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Pages set their own title; `default` applies to the home route and
  // `template` suffixes everything else, so only the page name is declared
  // per route.
  title: {
    default: `${site.name} — ${site.tagline}`,
    template: `%s · ${site.name}`,
  },
  description: site.description,
  applicationName: site.name,
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbf8f3" },
    { media: "(prefers-color-scheme: dark)", color: "#12100e" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/*
        `isolate` is load-bearing, not decoration.

        The starfield is a negative z-index child, and without a stacking
        context here it would belong to the ROOT context — where negative
        z-index boxes paint BEFORE body's background. The opaque background
        would then cover it and the stars would simply never appear, with no
        error and nothing obviously wrong to look at.

        Making body a stacking context repaints it in the order that is
        wanted: body's background first, then this layer, then the content.
      */}
      <body className="isolate flex min-h-full flex-col bg-background font-sans text-foreground">
        <Starfield />
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
        >
          Skip to content
        </a>

        <SessionProvider>
          <SiteHeader />

          <main id="main" className="flex flex-1 flex-col">
            {children}
          </main>

          <SiteFooter />
        </SessionProvider>
      </body>
    </html>
  );
}
