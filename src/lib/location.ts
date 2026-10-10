import { normalizeForMatch } from "@/lib/text";

/**
 * Where a job is, and who a remote job is open to, decides whether it shows up
 * for someone searching from a given country. Feed-style sources (remote
 * boards, company career pages) return jobs from everywhere, so they're
 * filtered here; APIs that take a location filter themselves.
 */

interface Place {
  /** Names for the country itself, in normalised form. */
  country: string[];
  /** Major cities, in normalised form. */
  cities: string[];
  /** Regions a remote job might be advertised as open to (e.g. "europe"). */
  regions: string[];
  /** Extra matcher run on the original text (e.g. US state codes). */
  pattern?: RegExp;
}

const EUROPE = ["europe", "european", "emea"];
const EU = [...EUROPE, "eu", "eea", "european union"];
const APAC = ["apac", "asia pacific", "asia", "oceania"];
const AMERICAS = ["americas", "north america"];
const LATAM = ["latam", "latin america", "south america", "americas"];
const AFRICA = ["africa", "emea"];

/** "Austin, TX" style US locations. */
const US_STATES =
  /,\s*(AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/;

export const PLACES: Record<string, Place> = {
  gb: {
    country: ["united kingdom", "uk", "u k", "great britain", "britain", "gb", "england", "scotland", "wales", "northern ireland"],
    cities: [
      "london", "manchester", "birmingham", "leeds", "glasgow", "edinburgh", "bristol", "liverpool", "cambridge",
      "oxford", "belfast", "cardiff", "nottingham", "sheffield", "newcastle", "reading", "brighton",
      "milton keynes", "southampton", "leicester",
    ],
    // Since Brexit, "EU only" usually means EU work rights, so it isn't counted as open to the UK.
    regions: EUROPE,
  },
  ie: { country: ["ireland"], cities: ["dublin", "cork", "galway", "limerick"], regions: EU },
  us: {
    country: ["united states", "usa", "us", "u s", "america"],
    cities: [
      "new york", "san francisco", "los angeles", "chicago", "seattle", "boston", "austin", "denver", "atlanta",
      "washington", "miami", "dallas", "houston",
    ],
    regions: [...AMERICAS, "us canada"],
    pattern: US_STATES,
  },
  ca: {
    country: ["canada"],
    cities: ["toronto", "vancouver", "montreal", "ottawa", "calgary", "edmonton", "waterloo"],
    regions: [...AMERICAS, "us canada"],
  },
  au: { country: ["australia"], cities: ["sydney", "melbourne", "brisbane", "perth", "adelaide", "canberra"], regions: APAC },
  nz: { country: ["new zealand"], cities: ["auckland", "wellington", "christchurch"], regions: APAC },
  de: {
    country: ["germany", "deutschland"],
    cities: ["berlin", "munich", "munchen", "hamburg", "frankfurt", "cologne", "koln", "stuttgart", "dusseldorf", "leipzig"],
    regions: EU,
  },
  fr: { country: ["france"], cities: ["paris", "lyon", "marseille", "toulouse", "bordeaux", "lille", "nantes"], regions: EU },
  nl: { country: ["netherlands", "holland"], cities: ["amsterdam", "rotterdam", "utrecht", "the hague", "eindhoven"], regions: EU },
  be: { country: ["belgium"], cities: ["brussels", "antwerp", "ghent"], regions: EU },
  es: { country: ["spain"], cities: ["madrid", "barcelona", "valencia", "seville", "malaga"], regions: EU },
  it: { country: ["italy"], cities: ["rome", "milan", "turin", "naples", "bologna"], regions: EU },
  at: { country: ["austria"], cities: ["vienna", "graz", "linz", "salzburg"], regions: EU },
  ch: { country: ["switzerland"], cities: ["zurich", "geneva", "basel", "bern", "lausanne"], regions: EUROPE },
  pl: { country: ["poland"], cities: ["warsaw", "krakow", "wroclaw", "gdansk", "poznan"], regions: EU },
  in: {
    country: ["india"],
    cities: ["bangalore", "bengaluru", "mumbai", "delhi", "hyderabad", "pune", "chennai", "gurgaon", "gurugram", "noida", "kolkata"],
    regions: APAC,
  },
  sg: { country: ["singapore"], cities: [], regions: APAC },
  za: { country: ["south africa"], cities: ["cape town", "johannesburg", "durban", "pretoria"], regions: AFRICA },
  ng: { country: ["nigeria"], cities: ["lagos", "abuja", "port harcourt", "ibadan"], regions: AFRICA },
  ke: { country: ["kenya"], cities: ["nairobi", "mombasa"], regions: AFRICA },
  ae: { country: ["united arab emirates", "uae"], cities: ["dubai", "abu dhabi", "sharjah"], regions: ["middle east", "mena", "gcc", "emea"] },
  br: { country: ["brazil", "brasil"], cities: ["sao paulo", "rio de janeiro", "belo horizonte"], regions: LATAM },
  mx: { country: ["mexico"], cities: ["mexico city", "guadalajara", "monterrey"], regions: [...LATAM, "north america"] },
};

const ANYWHERE = /\b(worldwide|anywhere|global|globally|international|world)\b/;
const FILLER_WORDS = /\b(remote|fully|100|work from home|wfh|home based|only|first|friendly|based|in|the|or|and)\b/g;

function containsPhrase(haystack: string, phrase: string): boolean {
  return phrase.length > 0 && ` ${haystack} `.includes(` ${phrase} `);
}

/**
 * Names that contain another place's name: New South Wales isn't in Wales and
 * Latin America isn't the US. They're blanked out before matching, unless
 * they're one of the names being looked for.
 */
const CONTAINING_NAMES = [
  "new south wales",
  "new england",
  "new mexico",
  "northern ireland",
  "latin america",
  "south america",
  "central america",
  "north america",
].map((name) => ({ name, pattern: new RegExp(`(?<=^| )${name}(?= |$)`, "g") }));

function containsName(location: string, names: string[]): boolean {
  let text = location;
  for (const { name, pattern } of CONTAINING_NAMES) if (!names.includes(name)) text = text.replace(pattern, "|");
  return names.some((name) => containsPhrase(text, name));
}

function namesPlace(location: string, place: Place): boolean {
  return containsName(location, [...place.country, ...place.cities]);
}

/** Whether a job location (normalised + raw) is in the given country. */
function inPlace(location: string, raw: string, place: Place): boolean {
  if (containsName(location, place.country)) return true;
  // A named country wins over a city name shared with it: "London, Ontario, Canada" isn't in the UK.
  const others = Object.values(PLACES).filter((other) => other !== place);
  if (others.some((other) => containsName(location, other.country))) return false;
  if (containsName(location, place.cities)) return true;
  // State codes are ambiguous ("Berlin, DE" isn't Delaware), so only trust them
  // when the location doesn't name somewhere in another country.
  return Boolean(place.pattern?.test(raw) && !others.some((other) => namesPlace(location, other)));
}

/** The country a typed location refers to ("Manchester" → gb), else the selected country. */
export function placeFor(country: string, query: string | undefined): Place | undefined {
  const wanted = normalizeForMatch(query ?? "");
  if (wanted) {
    const named = Object.values(PLACES).find((place) => namesPlace(wanted, place));
    if (named) return named;
  }
  return PLACES[country];
}

/** Whether a remote job's stated region lets someone in `place` apply. */
export function remoteOpenTo(jobLocation: string, place: Place | undefined): boolean {
  const location = normalizeForMatch(jobLocation);
  if (!location.replace(FILLER_WORDS, "").trim()) return true; // just "Remote"
  if (ANYWHERE.test(location)) return true;
  if (!place) return false;
  return inPlace(location, jobLocation, place) || place.regions.some((region) => containsPhrase(location, region));
}

export interface LocationFilter {
  /** What the user typed in the location box, if anything. */
  query?: string;
  /** ISO 3166-1 alpha-2, lower case. */
  country: string;
  /** Keep remote jobs open to the user's country even if they don't mention the typed city. */
  includeRemoteAnywhere: boolean;
}

export function locationMatches(job: { location: string; remote: boolean }, filter: LocationFilter): boolean {
  const location = normalizeForMatch(job.location);
  const wanted = normalizeForMatch(filter.query ?? "");
  const place = placeFor(filter.country, filter.query);

  // Typing a country ("UK") matches anywhere in it; typing a city matches that city.
  const matchesTyped = () =>
    containsPhrase(location, wanted) ||
    Boolean(place?.country.includes(wanted) && inPlace(location, job.location, place));

  if (job.remote) {
    if (!remoteOpenTo(job.location, place)) return false;
    return !wanted || filter.includeRemoteAnywhere || matchesTyped();
  }
  if (wanted) return matchesTyped();
  // Nothing typed: keep on-site jobs in the selected country, or with no stated location.
  return !location || !place || inPlace(location, job.location, place);
}
