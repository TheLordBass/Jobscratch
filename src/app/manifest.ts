import type { MetadataRoute } from "next";

/** So JobScratch can be added to a phone's home screen: on an iPhone, that's how it gets notifications. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "JobScratch",
    short_name: "JobScratch",
    description: "Search jobs, tailor your CV and get ready to apply.",
    start_url: "/",
    display: "standalone",
    background_color: "#09090b",
    theme_color: "#4f46e5",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
