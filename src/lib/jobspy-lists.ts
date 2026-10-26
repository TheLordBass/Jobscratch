/*
 * Title lists for the morning JobSpy run (scripts/jobspy/scheduled.py): named groups of job titles,
 * each searched in its own places. Saved in the settings, so they're the same on every device.
 */

export interface JobspyList {
  id: string;
  name: string;
  titles: string[];
  /** Empty means anywhere. */
  locations: string[];
  /** Whether the morning run searches it. */
  enabled: boolean;
}

export const MAX_LISTS = 20;
export const MAX_LIST_TITLES = 100;
export const MAX_LIST_LOCATIONS = 10;
/** Searches in one morning: about what LinkedIn puts up with from one connection, spaced out. */
export const SEARCHES_PER_MORNING = 100;

/** One search for the helper: a job title in a place, and the title list it's from. */
export interface ListSearch {
  term: string;
  location: string;
  list: string;
}

const key = (term: string, location: string) => `${term.trim().toLowerCase()}\n${location.trim().toLowerCase()}`;

/**
 * Every search in the lists that are on, split into mornings of at most SEARCHES_PER_MORNING. A
 * search that's in several lists runs once, in the morning of its first list, labelled with all of
 * them (one entry per list).
 */
export function planMornings(lists: JobspyList[], perMorning = SEARCHES_PER_MORNING): ListSearch[][] {
  const searches = new Map<string, ListSearch[]>();
  for (const list of lists) {
    if (!list.enabled) continue;
    const places = list.locations.length ? list.locations : [""];
    for (const term of list.titles) {
      for (const location of places) {
        if (!term.trim()) continue;
        const entries = searches.get(key(term, location)) ?? [];
        if (!entries.some((entry) => entry.list === list.name)) entries.push({ term, location, list: list.name });
        searches.set(key(term, location), entries);
      }
    }
  }
  const mornings: ListSearch[][] = [];
  [...searches.values()].forEach((entries, index) => {
    if (index % perMorning === 0) mornings.push([]);
    mornings.at(-1)!.push(...entries);
  });
  return mornings;
}

/** Which morning's searches to run today: the lists are worked through in turn, a day at a time. */
export function morningIndex(mornings: number, now = Date.now()): number {
  return mornings > 0 ? Math.floor(now / 86_400_000) % mornings : 0;
}

/** How far back a morning run looks: far enough that nothing is missed between a list's turns. */
export function morningHours(mornings: number, chosen: number | null): number {
  const needed = 24 * (Math.max(1, mornings) + 1);
  return chosen && chosen < needed ? chosen : needed;
}

/** Text from a textarea or input: one item per line or comma, trimmed, without repeats. */
export function splitItems(text: string, limit: number): string[] {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const item of text.split(/[\n,;]/).map((part) => part.trim().slice(0, 100))) {
    if (item && !seen.has(item.toLowerCase())) {
      seen.add(item.toLowerCase());
      items.push(item);
    }
  }
  return items.slice(0, limit);
}
