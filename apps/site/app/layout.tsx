import type { Metadata, Viewport } from "next";
import { Fraunces, Geist_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { ThemeProvider } from "@/components/ThemeProvider";
import { absoluteSiteUrl } from "@/lib/site";
import "./globals.css";

const sans = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta-sans",
  subsets: ["latin"],
  display: "swap",
  style: ["normal", "italic"],
});

const brand = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
  style: ["normal", "italic"],
  axes: ["opsz"],
});

const mono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(absoluteSiteUrl("/")),
  title: {
    default: "overtchat — self-hosted chat, without the sprawl",
    template: "%s — overtchat",
  },
  description:
    "A lightweight self-hosted chat client for hosted and local language models. One Docker Compose command and you're in.",
  applicationName: "overtchat",
  alternates: {
    canonical: absoluteSiteUrl("/"),
  },
  openGraph: {
    type: "website",
    siteName: "overtchat",
    title: "overtchat — self-hosted chat, without the sprawl",
    description:
      "A lightweight self-hosted chat client for hosted and local language models.",
    url: absoluteSiteUrl("/"),
  },
  twitter: {
    card: "summary",
    title: "overtchat — self-hosted chat, without the sprawl",
    description:
      "A lightweight self-hosted chat client for hosted and local language models.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "oklch(0.992 0.004 120)" },
    { media: "(prefers-color-scheme: dark)", color: "oklch(0.17 0.014 120)" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${brand.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <ThemeProvider>
          <SiteHeader />
          {children}
          <SiteFooter />
        </ThemeProvider>
      </body>
    </html>
  );
}
