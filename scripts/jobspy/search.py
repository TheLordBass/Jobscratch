"""
Search LinkedIn, Indeed, Glassdoor, Google Jobs and ZipRecruiter with JobSpy
(https://github.com/speedyapply/JobSpy) and save the results as a file that
JobScratch can load (Find jobs > Add a job > From JobSpy).

Unofficial: these sites' terms forbid automated scraping, which is why the app
itself never does this. Run it yourself, on your own computer, for your own job
search. Sites may block it, especially LinkedIn after a few pages.

Give several job titles and several locations to search every combination; the
results are merged into one file without duplicates.

    pip install -r scripts/jobspy/requirements.txt
    python scripts/jobspy/search.py "data analyst" --location London
    python scripts/jobspy/search.py "junior data analyst" "data analyst" "senior data analyst" --location Manchester London "United Kingdom"
    python scripts/jobspy/search.py "product manager" --location Remote --sites linkedin indeed --hours 72
"""

import argparse
import json
import logging
import random
import sys
import time
from collections import Counter
from datetime import datetime, timedelta, timezone

SITES = ["indeed", "linkedin", "glassdoor", "google", "zip_recruiter"]

# The columns JobScratch reads; the rest of JobSpy's output is left out.
FIELDS = [
    "site",
    "job_url",
    "job_url_direct",
    "title",
    "company",
    "location",
    "date_posted",
    "job_type",
    "is_remote",
    "min_amount",
    "max_amount",
    "currency",
    "interval",
    "description",
    "company_logo",
]

# Above this many searches, say how many requests that means before starting.
MANY_SEARCHES = 6


def parse_args():
    parser = argparse.ArgumentParser(
        description="Search job sites with JobSpy and save the results for JobScratch.",
    )
    parser.add_argument(
        "search",
        nargs="+",
        help='one or more job titles or keywords, each in quotes, e.g. "data analyst" "BI analyst"',
    )
    parser.add_argument(
        "--location",
        nargs="+",
        default=[""],
        help='one or more locations, each in quotes if it has a space, e.g. Manchester London "United Kingdom"',
    )
    parser.add_argument(
        "--distance",
        type=int,
        default=50,
        help="how far from each location to look, in miles (default: 50; try 10 for the city itself)",
    )
    parser.add_argument(
        "--country",
        default="uk",
        help="country for Indeed and Glassdoor, e.g. uk, usa, canada, germany (default: uk)",
    )
    parser.add_argument(
        "--sites",
        nargs="+",
        choices=SITES,
        default=["indeed", "linkedin"],
        help="sites to search (default: indeed linkedin)",
    )
    parser.add_argument("--results", type=int, default=25, help="results wanted per site, per search (default: 25)")
    parser.add_argument("--hours", type=int, help="only jobs posted in the last N hours")
    parser.add_argument("--remote", action="store_true", help="remote jobs only")
    parser.add_argument(
        "--linkedin-descriptions",
        action="store_true",
        help="also fetch full LinkedIn descriptions (much slower, and more likely to be blocked)",
    )
    parser.add_argument(
        "--pause",
        type=float,
        default=3,
        help="seconds to wait between searches, to make blocking less likely (default: 3)",
    )
    parser.add_argument(
        "--linkedin-pace",
        type=float,
        default=0,
        help="search LinkedIn on its own after the other sites, this many minutes apart, so it's less likely "
        "to block (e.g. 2; default: 0, at the same pace as the others)",
    )
    parser.add_argument("--out", default="jobspy-results.json", help="file to write (default: jobspy-results.json)")
    return parser.parse_args()


def unique(values):
    """Trimmed, without blanks or repeats (case-insensitive), in the order given."""
    seen, result = set(), []
    for value in (v.strip() for v in values):
        if value.lower() not in seen:
            seen.add(value.lower())
            result.append(value)
    return result


class LinkedInWatch(logging.Handler):
    """Notices LinkedIn turning a search away, which JobSpy logs rather than raising."""

    def __init__(self):
        super().__init__(logging.ERROR)
        self.blocked = False

    def emit(self, record):
        message = record.getMessage()
        if "status code 429" in message or "status code 999" in message or "blocked" in message:
            self.blocked = True


def search_once(scrape_jobs, args, term, location, sites=None):
    """One JobSpy search, as JobScratch records, and whether LinkedIn turned it away."""
    where = f" near {location}" if location else ""
    watch = LinkedInWatch()
    linkedin_log = logging.getLogger("JobSpy:LinkedIn")
    linkedin_log.addHandler(watch)
    try:
        jobs = scrape_jobs(
            site_name=sites or args.sites,
            search_term=term,
            google_search_term=f"{term} jobs{where}",
            location=location or None,
            distance=args.distance,
            results_wanted=args.results,
            hours_old=args.hours,
            country_indeed=args.country,
            is_remote=args.remote,
            linkedin_fetch_description=args.linkedin_descriptions,
            description_format="html",
            verbose=1,
        )
    finally:
        linkedin_log.removeHandler(watch)
    # pandas turns missing values into null and dates into ISO strings here.
    rows = json.loads(jobs.to_json(orient="records", date_format="iso")) if len(jobs) else []
    return [{field: row.get(field) for field in FIELDS} for row in rows], watch.blocked


def plan(search, location, pairs=None):
    """
    The keywords, locations and every (keyword, location) search to run: every combination of
    `search` and `location`, or exactly the (keyword, location, list name) searches in `pairs`
    (the morning run's title lists, each with its own places), once each.
    """
    if pairs:
        seen, searches = set(), []
        for term, place, _ in pairs:
            key = (term.strip().lower(), place.strip().lower())
            if key[0] and key not in seen:
                seen.add(key)
                searches.append((term.strip(), place.strip()))
        terms = unique(term for term, _ in searches)
        locations = [place for place in unique(place for _, place in searches) if place] or [""]
        return terms, locations, searches
    terms = [term for term in unique(search) if term]
    # An empty location means "anywhere"; keep it only if it's the only one.
    locations = [place for place in unique(location) if place] or [""]
    return terms, locations, [(term, place) for term in terms for place in locations]


def list_names(pairs):
    """For each (keyword, location) search in `pairs`, the names of the title lists it came from."""
    names = {}
    for term, place, name in pairs or []:
        key = (term.strip().lower(), place.strip().lower())
        if name and name not in names.setdefault(key, []):
            names[key].append(name)
    return names


def log(message):
    print(message, file=sys.stderr, flush=True)


def results_file(terms, locations, records, lists=None):
    """What JobScratch loads: the jobs found, and what was searched for (and from which title lists)."""
    query = {"search": terms, "location": [location for location in locations if location]}
    if lists:
        query["lists"] = lists
    return {
        "format": "jobscratch-jobspy",
        "version": 1,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "query": query,
        "jobs": records,
    }


# When LinkedIn turns a paced search away: minutes to wait before trying it again, longer each time
# in a row. After this many blocks in a row, the rest of the LinkedIn searches are skipped.
LINKEDIN_COOLDOWNS = [10, 20, 30]
LINKEDIN_MAX_BLOCKS = 4


def run_searches(scrape_jobs, args, on_progress=None, should_stop=None, on_found=None, on_status=None):
    """
    Run every search in `args` and merge the results into one JobScratch file.

    With args.linkedin_pace (minutes), LinkedIn is searched on its own after the other sites, one
    search at a time that far apart (give or take a little), and a search LinkedIn turns away is
    tried again after a rest (LINKEDIN_COOLDOWNS).

    on_progress(done, total, label, found) is called before each search and at the end;
    on_found(file) after each search with the jobs found so far; on_status(**fields) with
    waitingUntil/waitingFor during a long wait and endsAround (roughly when it'll finish);
    should_stop() is checked between searches and during waits. Returns (file contents, failed
    searches). Used by this script and by helper.py.
    """
    pairs = getattr(args, "pairs", None)
    terms, locations, searches = plan(args.search, args.location, pairs)
    # Each job is labelled with the title lists whose searches found it (the morning run's lists).
    names_for = list_names(pairs)
    lists = unique(name for _, _, name in pairs or [] if name)
    pace = max(0.0, float(getattr(args, "linkedin_pace", 0) or 0)) * 60
    cooldowns = getattr(args, "linkedin_cooldowns", LINKEDIN_COOLDOWNS)
    paced = pace > 0 and "linkedin" in args.sites
    others = [site for site in args.sites if not (paced and site == "linkedin")]
    steps = [(term, place, others) for term, place in searches] if others else []
    if paced:
        steps += [(term, place, ["linkedin"]) for term, place in searches]
    is_slow = lambda step: paced and step[2] == ["linkedin"]  # noqa: E731
    status = on_status or (lambda **fields: None)
    stopped = lambda: bool(should_stop and should_stop())  # noqa: E731
    took = {"fast": [], "slow": []}

    def wait(seconds, waiting_for):
        """Waits in short steps, so a stop request isn't held up. False if stopped meanwhile."""
        if seconds >= 20:
            until = datetime.now(timezone.utc) + timedelta(seconds=seconds)
            status(waitingUntil=until.isoformat(), waitingFor=waiting_for)
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline and not stopped():
            time.sleep(0.2)
        status(waitingUntil=None, waitingFor=None)
        return not stopped()

    def ends_around(next_step, extra=0):
        """Roughly when the run will finish, from how long its searches have taken so far (plus `extra` seconds)."""
        average = lambda times, guess: sum(times) / len(times) if times else guess  # noqa: E731
        fast = average(took["fast"], 5) + args.pause
        slow = average(took["slow"], 10) + pace
        seconds = extra + sum(slow if is_slow(step) else fast for step in steps[next_step:])
        return (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat()

    by_url, failed = {}, []
    blocks_in_a_row = 0
    for index, step in enumerate(steps):
        term, location, sites = step
        slow = is_slow(step)
        searched = f"“{term}”" + (f" in {location}" if location else "")
        label = f"LinkedIn: {searched}" if slow else searched
        if slow and blocks_in_a_row >= LINKEDIN_MAX_BLOCKS:
            failed.append(label)
            continue
        if index:
            between_linkedin = slow and is_slow(steps[index - 1])
            gap = pace * random.uniform(0.8, 1.2) if between_linkedin else args.pause
            if gap > 0 and not wait(gap, "the next LinkedIn search" if between_linkedin else "the next search"):
                break
        if stopped():
            break
        status(endsAround=ends_around(index))
        if on_progress:
            on_progress(index, len(steps), label, len(by_url))
        log(f"[{index + 1}/{len(steps)}] Searching {', '.join(sites)} for {searched}…")

        records, attempt = [], 0
        while True:
            attempt += 1
            started = time.monotonic()
            try:
                found, blocked = search_once(scrape_jobs, args, term, location, sites)
            except Exception as error:  # One failed search shouldn't lose the others.
                log(f"    Failed: {error}")
                failed.append(label)
                break
            took["slow" if slow else "fast"].append(time.monotonic() - started)
            records += found
            if not (slow and blocked):
                blocks_in_a_row = 0 if slow else blocks_in_a_row
                break
            blocks_in_a_row += 1
            if attempt >= 2 or blocks_in_a_row >= LINKEDIN_MAX_BLOCKS:
                log("    LinkedIn turned it away again, so it's skipped.")
                failed.append(label)
                break
            minutes = cooldowns[min(blocks_in_a_row - 1, len(cooldowns) - 1)]
            log(f"    LinkedIn turned this search away. Waiting {minutes:g} minutes, then trying it again.")
            status(endsAround=ends_around(index, minutes * 60))
            if not wait(minutes * 60, "LinkedIn to stop blocking"):
                break

        new = 0
        names = names_for.get((term.lower(), location.lower()), [])
        for record in records:
            key = record.get("job_url") or f"{record.get('site')}|{record.get('title')}|{record.get('company')}"
            if key not in by_url:
                by_url[key] = record
                new += 1
            kept = by_url[key]
            for name in names:
                if name not in kept.setdefault("lists", []):
                    kept["lists"].append(name)
        log(f"    {len(records)} found, {new} new")
        if on_found:
            on_found(results_file(terms, locations, list(by_url.values()), lists))
        if slow and blocks_in_a_row >= LINKEDIN_MAX_BLOCKS:
            log("LinkedIn keeps turning searches away, so the rest of the LinkedIn searches are skipped.")

    if on_progress:
        on_progress(len(steps), len(steps), None, len(by_url))
    status(waitingUntil=None, waitingFor=None, endsAround=None)
    return results_file(terms, locations, list(by_url.values()), lists), failed


def main():
    args = parse_args()
    try:
        from jobspy import scrape_jobs
    except ImportError:
        sys.exit("JobSpy isn't installed. Run: pip install -r scripts/jobspy/requirements.txt")

    terms, locations, searches = plan(args.search, args.location)
    if not terms:
        sys.exit("Give at least one job title or keyword to search for.")
    if len(searches) > MANY_SEARCHES:
        log(
            f"{len(searches)} searches ({len(terms)} keywords × {len(locations)} locations) on "
            f"{len(args.sites)} sites. This may take a while, and sites are more likely to block it."
        )

    document, failed = run_searches(scrape_jobs, args)
    records = document["jobs"]
    with open(args.out, "w", encoding="utf-8") as file:
        json.dump(document, file, ensure_ascii=False)

    counts = Counter(record["site"] for record in records)
    summary = ", ".join(f"{site} {count}" for site, count in counts.most_common()) or "none"
    print(f"Saved {len(records)} jobs ({summary}) to {args.out}", file=sys.stderr)
    if failed:
        print(f"These searches failed and were skipped: {'; '.join(failed)}", file=sys.stderr)
    print("Load it in JobScratch: Find jobs > Add a job > From JobSpy.", file=sys.stderr)


if __name__ == "__main__":
    main()
