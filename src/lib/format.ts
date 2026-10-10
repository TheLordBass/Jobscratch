import type { Salary } from "@/lib/types";

const PERIOD_LABEL: Record<NonNullable<Salary["period"]>, string> = {
  year: "a year",
  month: "a month",
  week: "a week",
  day: "a day",
  hour: "an hour",
};

function compact(value: number, currency?: string): string {
  try {
    return new Intl.NumberFormat("en", {
      style: currency ? "currency" : "decimal",
      currency: currency || undefined,
      notation: value >= 10_000 ? "compact" : "standard",
      maximumFractionDigits: value >= 10_000 ? 1 : 2,
    }).format(value);
  } catch {
    return `${currency ? `${currency} ` : ""}${value.toLocaleString("en")}`;
  }
}

export function formatSalary(salary: Salary | undefined): string | undefined {
  if (!salary) return undefined;
  if (salary.text) return salary.text;
  const { min, max, currency, period } = salary;
  if (!min && !max) return undefined;
  const range =
    min && max && min !== max
      ? `${compact(min, currency)}–${compact(max, currency)}`
      : compact((min || max)!, currency);
  return period ? `${range} ${PERIOD_LABEL[period]}` : range;
}

export function formatPosted(iso: string | undefined, now = Date.now()): string | undefined {
  if (!iso) return undefined;
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return undefined;
  const days = Math.floor((now - time) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const COUNTRIES: Array<{ code: string; name: string }> = [
  { code: "gb", name: "United Kingdom" },
  { code: "us", name: "United States" },
  { code: "ca", name: "Canada" },
  { code: "au", name: "Australia" },
  { code: "nz", name: "New Zealand" },
  { code: "ie", name: "Ireland" },
  { code: "de", name: "Germany" },
  { code: "fr", name: "France" },
  { code: "nl", name: "Netherlands" },
  { code: "be", name: "Belgium" },
  { code: "es", name: "Spain" },
  { code: "it", name: "Italy" },
  { code: "at", name: "Austria" },
  { code: "ch", name: "Switzerland" },
  { code: "pl", name: "Poland" },
  { code: "in", name: "India" },
  { code: "sg", name: "Singapore" },
  { code: "za", name: "South Africa" },
  { code: "ng", name: "Nigeria" },
  { code: "ke", name: "Kenya" },
  { code: "ae", name: "United Arab Emirates" },
  { code: "br", name: "Brazil" },
  { code: "mx", name: "Mexico" },
];
