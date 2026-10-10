import type { Metadata } from "next";
import { CvView } from "@/components/CvView";

export const metadata: Metadata = { title: "Your CV" };

export default function CvPage() {
  return <CvView />;
}
