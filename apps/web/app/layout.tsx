import type { Metadata, Viewport } from "next";
import {
  Fraunces,
  Geist,
  Geist_Mono,
  IBM_Plex_Sans,
  Inter,
  Plus_Jakarta_Sans,
  Roboto,
} from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { QueryProvider } from "@/components/QueryProvider";
import { FONT_STORAGE_KEY, fontCssValueById } from "@/lib/fonts";

const sans = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta-sans",
  subsets: ["latin"],
  display: "swap",
  style: ["normal", "italic"],
});

const serif = Fraunces({
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

// Selectable sans options for the per-device font picker (see lib/fonts.ts).
// next/font is build-time only, so these are registered eagerly; the browser
// only downloads the family actually applied via --app-font-sans.
const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const roboto = Roboto({ variable: "--font-roboto", subsets: ["latin"], display: "swap" });
const geist = Geist({ variable: "--font-geist", subsets: ["latin"], display: "swap" });
const ibmPlexSans = IBM_Plex_Sans({
  variable: "--font-ibm-plex-sans",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

// Blocking script: apply the stored font to --app-font-sans before first paint
// (mirrors how next-themes applies the theme class). Default id has no map entry,
// so it falls through to the CSS var() fallback (Plus Jakarta) with no inline style.
const fontScript = `(function(){try{
  var raw=localStorage.getItem(${JSON.stringify(FONT_STORAGE_KEY)});
  var id=raw?JSON.parse(raw):null;
  var map=${JSON.stringify(fontCssValueById)};
  var v=id&&map[id];
  if(v){document.documentElement.style.setProperty("--app-font-sans",v);}
}catch(e){}})();`;

export const metadata: Metadata = {
  title: "overtchat",
  description: "Simple self-hosted chat UI for OpenAI-compatible endpoints",
  appleWebApp: {
    title: "overtchat",
    capable: true,
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "oklch(0.992 0.004 120)" },
    { media: "(prefers-color-scheme: dark)", color: "oklch(0.17 0.014 120)" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${serif.variable} ${mono.variable} ${inter.variable} ${roboto.variable} ${geist.variable} ${ibmPlexSans.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="h-full">
        <script dangerouslySetInnerHTML={{ __html: fontScript }} />
        <QueryProvider>
          <ThemeProvider>{children}</ThemeProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
