import { markdownToPlainText } from "@/lib/markdown";

/*
 * A check on the figures in a document Claude wrote: every number in it (£60K, 64.5%, 14 times,
 * 2021) should come from the candidate's own materials. One that doesn't may be a slip worth
 * catching before the document is sent, since a wrong number is the most damaging kind of mistake.
 */

const MULTIPLIER: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, bn: 1e9, b: 1e9, billion: 1e9 };

// A number (with thousands separators or a decimal point), then an optional K/M/bn or the word
// for one. Not part of a longer word or code ("H2", "1st", "x86"), and not inside another number.
const FIGURE =
  /(?<![\w.,])([£$€]?)(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?:\s?(k|m|bn|b)(?![a-z])|\s(thousand|million|billion)\b)?(\s?%|(?:st|nd|rd|th)\b)?(?![\w])/gi;

interface Figure {
  /** As written, e.g. "£60K". */
  text: string;
  /** Its value first ("60K" is 60,000), then, in a source, as written ("60"), which may be how a document puts it. */
  values: string[];
  /** A small whole number on its own ("3 roles"), too common to be worth checking. */
  trivial: boolean;
}

const key = (value: number) => String(Number(value.toPrecision(6)));

function figuresIn(text: string): Figure[] {
  const figures: Figure[] = [];
  for (const match of text.matchAll(FIGURE)) {
    const [whole, currency, digits, decimals = "", short, word, suffix = ""] = match;
    if (/^(st|nd|rd|th)$/i.test(suffix)) continue; // "1st", "3rd": ordinals, not figures
    const base = Number(digits.replace(/,/g, "") + decimals);
    const multiplier = MULTIPLIER[(short ?? word ?? "").toLowerCase()] ?? 1;
    const values = [key(base * multiplier)];
    if (multiplier !== 1) values.push(key(base));
    figures.push({
      text: whole.trim(),
      values,
      trivial: base < 10 && multiplier === 1 && !currency && !suffix.trim() && !decimals,
    });
  }
  return figures;
}

/**
 * The figures in a document that appear nowhere in its sources (the candidate's CVs, notes, and so
 * on), each once, as written. Compared by value, so "£60,000" in the CV covers "£60K" in the document.
 */
export function unsupportedFigures(markdown: string, sources: string[]): string[] {
  const known = new Set(sources.flatMap((source) => figuresIn(source).flatMap((figure) => figure.values)));
  const seen = new Set<string>();
  const out: string[] = [];
  // As printed: link addresses aren't part of it.
  for (const figure of figuresIn(markdownToPlainText(markdown))) {
    // By its full value: "£20K" isn't backed by a "20" somewhere in the CV.
    if (figure.trivial || known.has(figure.values[0])) continue;
    if (seen.has(figure.text)) continue;
    seen.add(figure.text);
    out.push(figure.text);
  }
  return out;
}
