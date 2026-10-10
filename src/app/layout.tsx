import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "JobScratch", template: "%s · JobScratch" },
  description: "Search jobs across major portals, import from LinkedIn, and tailor your CV with AI.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="flex min-h-full flex-col">
        <Nav />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">{children}</main>
        <footer className="muted mx-auto w-full max-w-6xl px-4 pb-6 text-xs sm:px-6">
          Your CV, saved jobs and settings stay in this browser. Listings link back to the portal they came from.
        </footer>
      </body>
    </html>
  );
}
