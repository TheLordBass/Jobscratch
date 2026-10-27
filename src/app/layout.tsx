import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { Nav } from "@/components/Nav";
import "./globals.css";

// Self-hosted by Next.js, so browsers don't contact Google.
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta" });

export const metadata: Metadata = {
  title: { default: "JobScratch", template: "%s · JobScratch" },
  description: "Search jobs across major portals, import from LinkedIn, and tailor your CV with AI.",
  // Added to an iPhone's home screen, it opens like an app (and can get notifications).
  appleWebApp: { capable: true, title: "JobScratch", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`h-full ${jakarta.variable}`}>
      <body className="flex min-h-full flex-col">
        <Nav />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">{children}</main>
        <footer className="mx-auto w-full max-w-6xl px-4 pb-8 sm:px-6">
          <p className="muted border-t border-zinc-200/70 pt-4 text-xs dark:border-zinc-800">
            Your CV, saved jobs and settings stay in this browser. Listings link back to the site they came from.
          </p>
        </footer>
      </body>
    </html>
  );
}
