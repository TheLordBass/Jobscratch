import type { Metadata } from "next";
import { SavedView } from "@/components/SavedView";

export const metadata: Metadata = { title: "Saved jobs" };

export default function SavedPage() {
  return <SavedView />;
}
