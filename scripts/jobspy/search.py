"""
Search LinkedIn, Indeed, Glassdoor, Google Jobs and ZipRecruiter with JobSpy
(https://github.com/speedyapply/JobSpy) and save the results as a file that
JobScratch can load (Find jobs > Add a job > From JobSpy).

Unofficial: these sites' terms forbid automated scraping, which is why the app
itself never does this. Run it yourself, on your own computer, for your own job
search. Sites may block it, especially LinkedIn after a few pages.

    pip install -r scripts/jobspy/requirements.txt
    python scripts/jobspy/search.py "data analyst" --location London
    python scripts/jobspy/search.py "product manager" --location Remote --sites linkedin indeed --hours 72
"""

import argparse
import json
import sys
from collections import Counter
from datetime import datetime, timezone

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


def parse_args():
    parser = argparse.ArgumentParser(
        description="Search job sites with JobSpy and save the results for JobScratch.",
    )
    parser.add_argument("search", help='what to search for, e.g. "data analyst"')
    parser.add_argument("--location", default="", help='e.g. "London", "Manchester, UK" or "Remote"')
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
    parser.add_argument("--results", type=int, default=25, help="results wanted per site (default: 25)")
    parser.add_argument("--hours", type=int, help="only jobs posted in the last N hours")
    parser.add_argument("--remote", action="store_true", help="remote jobs only")
    parser.add_argument(
        "--linkedin-descriptions",
        action="store_true",
        help="also fetch full LinkedIn descriptions (much slower, and more likely to be blocked)",
    )
    parser.add_argument("--out", default="jobspy-results.json", help="file to write (default: jobspy-results.json)")
    return parser.parse_args()


def main():
    args = parse_args()
    try:
        from jobspy import scrape_jobs
    except ImportError:
        sys.exit("JobSpy isn't installed. Run: pip install -r scripts/jobspy/requirements.txt")

    where = f" near {args.location}" if args.location else ""
    print(f"Searching {', '.join(args.sites)} for “{args.search}”{where}…", file=sys.stderr)
    jobs = scrape_jobs(
        site_name=args.sites,
        search_term=args.search,
        google_search_term=f"{args.search} jobs{where}",
        location=args.location or None,
        results_wanted=args.results,
        hours_old=args.hours,
        country_indeed=args.country,
        is_remote=args.remote,
        linkedin_fetch_description=args.linkedin_descriptions,
        description_format="html",
        verbose=1,
    )

    # pandas turns missing values into null and dates into ISO strings here.
    rows = json.loads(jobs.to_json(orient="records", date_format="iso")) if len(jobs) else []
    records = [{field: row.get(field) for field in FIELDS} for row in rows]

    with open(args.out, "w", encoding="utf-8") as file:
        json.dump(
            {
                "format": "jobscratch-jobspy",
                "version": 1,
                "createdAt": datetime.now(timezone.utc).isoformat(),
                "query": {"search": args.search, "location": args.location},
                "jobs": records,
            },
            file,
            ensure_ascii=False,
        )

    counts = Counter(record["site"] for record in records)
    summary = ", ".join(f"{site} {count}" for site, count in counts.most_common()) or "none"
    print(f"Saved {len(records)} jobs ({summary}) to {args.out}", file=sys.stderr)
    print("Load it in JobScratch: Find jobs > Add a job > From JobSpy.", file=sys.stderr)


if __name__ == "__main__":
    main()
