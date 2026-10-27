"use client";

import { ListPlus, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  MAX_LISTS,
  MAX_LIST_LOCATIONS,
  MAX_LIST_TITLES,
  SEARCHES_PER_MORNING,
  morningHours,
  planMornings,
  splitItems,
  uniqueListName,
  type JobspyList,
} from "@/lib/jobspy-lists";
import { MIN_LINKEDIN_PACE } from "@/lib/jobspy-helper";
import { newId, useHydrated, useSettings } from "@/lib/store";

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/**
 * Title lists for the morning JobSpy run, in Add a job > From JobSpy: named groups of job titles,
 * each with its own places, switched on or off. Saved with the settings, so they can be edited on
 * any device.
 */
export function TitleLists() {
  const [settings, setSettings] = useSettings();
  const hydrated = useHydrated();
  const lists = settings.jobspyLists;
  const setLists = (update: (previous: JobspyList[]) => JobspyList[]) =>
    setSettings((previous) => ({ ...previous, jobspyLists: update(previous.jobspyLists ?? []) }));

  const mornings = planMornings(lists);
  const sizes = mornings.map((morning) => new Set(morning.map((s) => `${s.term}\n${s.location}`.toLowerCase())).size);
  const searches = sizes.reduce((sum, size) => sum + size, 0);
  const on = lists.filter((list) => list.enabled && list.titles.length).length;
  const fromForm = settings.jobspy.search;
  // LinkedIn is searched one search at a time, at least MIN_LINKEDIN_PACE minutes apart, so it sets how long a morning takes.
  const longest = Math.max(0, ...sizes);
  const linkedInHours = settings.jobspy.sites.includes("linkedin")
    ? (longest * Math.max(MIN_LINKEDIN_PACE, settings.jobspy.linkedinPace)) / 60
    : 0;

  function add(list?: Partial<JobspyList>) {
    setLists((previous) => [
      ...previous,
      {
        id: newId(),
        titles: [],
        locations: [],
        enabled: true,
        ...list,
        name: uniqueListName(list?.name ?? `List ${previous.length + 1}`, previous),
      },
    ]);
  }

  if (!hydrated) return null;
  return (
    <details className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800" open={lists.length > 0 || undefined}>
      <summary className="cursor-pointer text-sm font-semibold">
        Title lists for the morning run{lists.length > 0 && <span className="muted font-normal"> ({lists.length})</span>}
      </summary>
      <div className="mt-3 space-y-3">
        <p className="muted text-sm">
          Group the job titles you’re after, each with its own places. The morning run searches every list that’s on, with
          the sites and other options from the search form below. Without lists, it repeats your last search instead.
        </p>

        {lists.map((list) => (
          <ListEditor
            key={list.id}
            list={list}
            onChange={(patch) =>
              setLists((previous) =>
                previous.map((l) =>
                  l.id !== list.id
                    ? l
                    : {
                        ...l,
                        ...patch,
                        ...(patch.name !== undefined && { name: uniqueListName(patch.name, previous.filter((o) => o.id !== l.id)) }),
                      },
                ),
              )
            }
            onRemove={() => {
              if (window.confirm(`Delete the list “${list.name}”?`)) setLists((previous) => previous.filter((l) => l.id !== list.id));
            }}
          />
        ))}

        <div className="flex flex-wrap items-center gap-2">
          {lists.length < MAX_LISTS && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => add()}>
              <ListPlus size={14} aria-hidden /> Add a list
            </button>
          )}
          {lists.length === 0 && fromForm.length > 0 && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() =>
                add({ name: "My search", titles: fromForm.slice(0, MAX_LIST_TITLES), locations: settings.jobspy.location.slice(0, MAX_LIST_LOCATIONS) })
              }
            >
              Start with my last search ({plural(fromForm.length, "title")})
            </button>
          )}
        </div>

        {on > 0 && (
          <p className="text-sm" role="status">
            {plural(on, "list")} on: {plural(searches, "search", "searches")}.{" "}
            {mornings.length > 1 ? (
              <>
                That’s more than {SEARCHES_PER_MORNING} a morning, so the run takes turns: it gets through all of them every{" "}
                {mornings.length} mornings, looking back {Math.round(morningHours(mornings.length, settings.jobspy.hours) / 24)} days each
                time so nothing is missed.
              </>
            ) : (
              "All of them run every morning."
            )}
            {linkedInHours >= 1 && (
              <>
                {" "}
                With LinkedIn searched {Math.max(MIN_LINKEDIN_PACE, settings.jobspy.linkedinPace)} minutes apart, a morning takes about{" "}
                {Math.round(linkedInHours)} {Math.round(linkedInHours) === 1 ? "hour" : "hours"}
                {linkedInHours > 8 && ": fewer titles would have it done sooner"}.
              </>
            )}
          </p>
        )}
      </div>
    </details>
  );
}

/** One list. Text is saved when you leave the box, so typing a new line isn't tidied away mid-word. */
function ListEditor({
  list,
  onChange,
  onRemove,
}: {
  list: JobspyList;
  onChange: (patch: Partial<JobspyList>) => void;
  onRemove: () => void;
}) {
  const [name, setName] = useState(list.name);
  const [titles, setTitles] = useState(list.titles.join("\n"));
  const [places, setPlaces] = useState(list.locations.join(", "));
  // The box being typed in, if any.
  const [typing, setTyping] = useState<"name" | "titles" | "places" | null>(null);
  // The list changed under the boxes (saved here, or synced from another device): show it, except in
  // the box being typed in, so a change made elsewhere is never written back over with old text.
  const [shown, setShown] = useState(list);
  if (shown !== list) {
    setShown(list);
    if (typing !== "name") setName(list.name);
    if (typing !== "titles") setTitles(list.titles.join("\n"));
    if (typing !== "places") setPlaces(list.locations.join(", "));
  }
  const count = list.titles.length * Math.max(1, list.locations.length);
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((item, i) => item === b[i]);

  return (
    <fieldset className={`space-y-2 rounded-lg border border-zinc-100 p-3 dark:border-zinc-800 ${list.enabled ? "" : "opacity-70"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input min-w-0 flex-1 py-1.5 font-semibold"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          onFocus={() => setTyping("name")}
          onBlur={() => {
            setTyping(null);
            if (name.trim() && name.trim() !== list.name) onChange({ name: name.trim() });
            else setName(list.name);
          }}
          aria-label="List name"
        />
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={list.enabled} onChange={(e) => onChange({ enabled: e.target.checked })} />
          In the morning run
        </label>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={onRemove} aria-label={`Delete ${list.name}`}>
          <Trash2 size={15} aria-hidden />
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-[2fr_1fr]">
        <div>
          <label className="label" htmlFor={`titles-${list.id}`}>
            Job titles <span className="font-normal">(one per line, up to {MAX_LIST_TITLES})</span>
          </label>
          <textarea
            id={`titles-${list.id}`}
            className="input min-h-24 resize-y text-sm"
            value={titles}
            onChange={(e) => setTitles(e.target.value)}
            onFocus={() => setTyping("titles")}
            onBlur={() => {
              setTyping(null);
              const items = splitItems(titles, MAX_LIST_TITLES);
              setTitles(items.join("\n"));
              if (!same(items, list.titles)) onChange({ titles: items });
            }}
            placeholder={"operations analyst\nbusiness analyst\nreporting analyst"}
          />
        </div>
        <div>
          <label className="label" htmlFor={`places-${list.id}`}>
            Places <span className="font-normal">(up to {MAX_LIST_LOCATIONS})</span>
          </label>
          <input
            id={`places-${list.id}`}
            className="input text-sm"
            value={places}
            onChange={(e) => setPlaces(e.target.value)}
            onFocus={() => setTyping("places")}
            onBlur={() => {
              setTyping(null);
              const items = splitItems(places, MAX_LIST_LOCATIONS);
              setPlaces(items.join(", "));
              if (!same(items, list.locations)) onChange({ locations: items });
            }}
            placeholder="Manchester, Remote (blank for anywhere)"
          />
          <p className="muted mt-1 text-xs">
            {count ? `${plural(list.titles.length, "title")} × ${plural(Math.max(1, list.locations.length), "place")} = ${plural(count, "search", "searches")}` : "No titles yet"}
          </p>
        </div>
      </div>
    </fieldset>
  );
}
