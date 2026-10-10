import type { Metadata } from "next";
import { Suspense } from "react";
import { TailorView } from "@/components/TailorView";

export const metadata: Metadata = { title: "Tailor your CV" };

export default function TailorPage() {
  return (
    <Suspense fallback={<div className="card muted p-8 text-center text-sm">Loading…</div>}>
      <TailorView />
    </Suspense>
  );
}
