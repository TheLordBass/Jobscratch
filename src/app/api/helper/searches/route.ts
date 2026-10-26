import { COUNTRIES } from "@/lib/format";
import { openForHelper } from "@/lib/helper-request";
import { DEFAULT_JOBSPY_SEARCH, type HelperSearch } from "@/lib/jobspy-helper";
import { readValue } from "@/lib/server-data";

/** A morning run looks for jobs posted since about the day before: at most this many hours back. */
const SCHEDULED_HOURS = 48;

/** The parts of the app's settings (lib/store.ts) a run needs. */
interface SavedSettings {
  country?: string;
  jobspy?: Partial<Omit<HelperSearch, "country">>;
}

/**
 * GET /api/helper/searches, for the scheduled JobSpy run on the user's computer: the JobSpy search
 * saved in the app, ready to run.
 */
export async function GET(request: Request) {
  const backend = openForHelper(request);
  if (backend instanceof Response) return backend;
  const settings = (await readValue(backend, "settings")) as SavedSettings | null;
  const saved = { ...DEFAULT_JOBSPY_SEARCH, ...settings?.jobspy };
  if (!saved.search.length) {
    return Response.json(
      { error: "No JobSpy search saved yet. Search once from the app (Find jobs > Add a job > From JobSpy)." },
      { status: 404 },
    );
  }
  const country = COUNTRIES.find((c) => c.code === (settings?.country ?? "gb"))?.name ?? "United Kingdom";
  const search: HelperSearch = {
    ...saved,
    hours: saved.hours && saved.hours <= SCHEDULED_HOURS ? saved.hours : SCHEDULED_HOURS,
    country: country.toLowerCase(),
  };
  return Response.json(search);
}
