import type { Metadata } from "next";
import { SavedView } from "@/components/SavedView";

export const metadata: Metadata = { title: "My jobs" };

export default function SavedPage() {
  return <SavedView />;
}
