"use client";

import { useEffect, useState } from "react";
import type { SourcesResponse } from "@/lib/types";

let request: Promise<SourcesResponse> | null = null;

/** Which sources have API keys configured on the server, and whether AI is set up. */
export function useSources(): SourcesResponse | null {
  const [data, setData] = useState<SourcesResponse | null>(null);
  useEffect(() => {
    let active = true;
    request ??= fetch("/api/sources").then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json() as Promise<SourcesResponse>;
    });
    request
      .then((result) => {
        if (active) setData(result);
      })
      .catch(() => {
        request = null;
      });
    return () => {
      active = false;
    };
  }, []);
  return data;
}
