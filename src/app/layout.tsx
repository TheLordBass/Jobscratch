import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Nav } from "@/components/Nav";
import "./globals.css";

// Self-hosted by Next.js, so browsers don't contact Google.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: { default: "JobScratch", template: "%s · JobScratch" },
  description: "Search jobs across major portals, import from LinkedIn, and tailor your CV with AI.",
  // Added to an iPhone's home screen, it opens like an app (and can get notifications).
  appleWebApp: { capable: true, title: "JobScratch", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

// Full screen, the page reaches under a phone's camera cutout: the header and footer keep clear of it.
export const viewport: Viewport = { viewportFit: "cover" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`h-full ${inter.variable}`}>
      <body className="flex min-h-full flex-col">
        <Nav />
        {/* On a phone, the tab bar sits at the bottom: the page keeps clear of it. */}
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-5 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-8 sm:pb-10">
          {children}
        </main>
        <footer className="mx-auto hidden w-full max-w-5xl px-4 pb-8 sm:block sm:px-6">
          <p className="muted border-t border-zinc-200 pt-4 text-xs dark:border-zinc-800">
            Your CV, saved jobs and settings stay in this browser. Listings link back to the site they came from.
          </p>
        </footer>
      </body>
    </html>
  );
}
