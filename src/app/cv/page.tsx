import type { Metadata } from "next";
import { CvView } from "@/components/CvView";

export const metadata: Metadata = { title: "My CV" };

export default function CvPage() {
  return <CvView />;
}
