"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

/** Copies `text` to the clipboard, saying so for a moment. */
export function CopyButton({ text, label = "Copy", className = "" }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`btn btn-secondary btn-sm ${className}`}
      disabled={!text.trim()}
      aria-label={label ? undefined : copied ? "Copied" : "Copy"}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          window.prompt("Copy this:", text);
        }
      }}
    >
      {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
      {label && (copied ? "Copied" : label)}
    </button>
  );
}
