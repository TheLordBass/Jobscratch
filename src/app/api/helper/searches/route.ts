import { COUNTRIES } from "@/lib/format";
import { openForHelper } from "@/lib/helper-request";
import { DEFAULT_JOBSPY_SEARCH, type HelperSearch } from "@/lib/jobspy-helper";
import { morningHours, morningIndex, planMornings, type JobspyList, type ListSearch } from "@/lib/jobspy-lists";
import { readValue } from "@/lib/server-data";

/** The parts of the app's settings (lib/store.ts) a run needs. */
interface SavedSettings {
  country?: string;
  jobspy?: Partial<Omit<HelperSearch, "country">>;
  jobspyLists?: JobspyList[];
}

/** What a morning run searches: the helper's options, plus the title lists' searches when there are any. */
type MorningSearch = HelperSearch & { searches?: ListSearch[]; batch?: { index: number; count: number } };

/**
 * GET /api/helper/searches, for the scheduled JobSpy run on the user's computer: today's searches,
 * ready to run. With title lists (lib/jobspy-lists.ts) switched on, those, a morning's worth at a
 * time; otherwise the last search made in the app. The sites and other options are the app's.
 */
export async function GET(request: Request) {
  const backend = openForHelper(request);
  if (backend instanceof Response) return backend;
  const settings = (await readValue(backend, "settings")) as SavedSettings | null;
  const saved = { ...DEFAULT_JOBSPY_SEARCH, ...settings?.jobspy };
  const country = (COUNTRIES.find((c) => c.code === (settings?.country ?? "gb"))?.name ?? "United Kingdom").toLowerCase();

  const mornings = planMornings(settings?.jobspyLists ?? []);
  if (mornings.length) {
    const index = morningIndex(mornings.length);
    const search: MorningSearch = {
      ...saved,
      country,
      hours: morningHours(mornings.length, saved.hours),
      searches: mornings[index],
      batch: { index, count: mornings.length },
    };
    return Response.json(search);
  }

  if (!saved.search.length) {
    return Response.json(
      { error: "Nothing to search yet. Add a title list, or search once from the app (Find jobs > Add a job > From JobSpy)." },
      { status: 404 },
    );
  }
  const search: MorningSearch = { ...saved, country, hours: morningHours(1, saved.hours) };
  return Response.json(search);
}
