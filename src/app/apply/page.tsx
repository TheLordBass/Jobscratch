import type { Metadata } from "next";
import { ApplyView } from "@/components/ApplyView";

export const metadata: Metadata = { title: "Apply" };

export default function ApplyPage() {
  return <ApplyView />;
}
