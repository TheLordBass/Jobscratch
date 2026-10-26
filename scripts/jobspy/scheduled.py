"""
Runs your saved JobSpy search without a browser, then sends the jobs to JobScratch so they're
waiting in the app, on any device. Meant to run every morning from Windows Task Scheduler
(set it up with schedule-morning-run.ps1), but you can run it yourself too:

    scripts/jobspy/.venv/Scripts/python scripts/jobspy/scheduled.py

It searches what you last searched in the app (Find jobs > Add a job > From JobSpy), for jobs
posted in the last two days, and replaces the previous morning's results. It needs server storage
and two settings in scripts/jobspy/.env (schedule-morning-run.ps1 writes them):

    JOBSCRATCH_URL=https://jobscratch.vercel.app
    JOBSCRATCH_HELPER_TOKEN=a long random value, the same as JOBSCRATCH_HELPER_TOKEN in Vercel

What it does is written to scripts/jobspy/scheduled.log. The same caveat as search.py applies:
these sites' terms forbid scraping, so use it at your own risk.
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
LOG_FILE = HERE / "scheduled.log"
# Keeps the log from growing for ever: past this size, it starts again.
MAX_LOG_BYTES = 1_000_000
# Each upload stays well under the 4.5 MB a Vercel function accepts.
PART_BYTES = 2_000_000
PART_JOBS = 500
TRIES = 3
RETRY_SECONDS = 30


class RunError(Exception):
    """Something the log should explain in plain words."""


def read_config(path=HERE / ".env", environ=os.environ):
    """KEY=value lines from scripts/jobspy/.env; the same names in the environment win."""
    config = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8-sig").splitlines():
            key, sep, value = line.strip().partition("=")
            if sep and not key.startswith("#"):
                config[key.strip()] = value.strip().strip('"')
    for key in ("JOBSCRATCH_URL", "JOBSCRATCH_HELPER_TOKEN"):
        if environ.get(key):
            config[key] = environ[key]
    url = config.get("JOBSCRATCH_URL", "").rstrip("/")
    token = config.get("JOBSCRATCH_HELPER_TOKEN", "")
    if not url.startswith(("https://", "http://localhost", "http://127.0.0.1")):
        raise RunError("Set JOBSCRATCH_URL in scripts/jobspy/.env to your JobScratch address, e.g. https://jobscratch.vercel.app")
    if len(token) < 24:
        raise RunError("Set JOBSCRATCH_HELPER_TOKEN in scripts/jobspy/.env (schedule-morning-run.ps1 makes one).")
    return {"url": url, "token": token}


def call(config, path, body=None, opener=urllib.request.urlopen, sleep=time.sleep):
    """JSON to and from JobScratch, trying again a couple of times if the network or server stumbles."""
    data = None if body is None else json.dumps(body).encode("utf-8")
    for attempt in range(1, TRIES + 1):
        request = urllib.request.Request(
            config["url"] + path,
            data=data,
            method="GET" if data is None else "POST",
            headers={"Authorization": f"Bearer {config['token']}", "Content-Type": "application/json", "User-Agent": "JobScratch-JobSpy-helper"},
        )
        try:
            with opener(request, timeout=60) as response:
                return json.loads(response.read() or b"{}")
        except urllib.error.HTTPError as error:
            try:
                message = json.loads(error.read() or b"{}").get("error")
            except ValueError:
                message = None
            # Wrong token, nothing saved and the like won't fix themselves.
            if error.code < 500 or attempt == TRIES:
                raise RunError(message or f"JobScratch answered {error.code}") from None
        except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
            if attempt == TRIES:
                raise RunError(f"Couldn't reach JobScratch ({getattr(error, 'reason', error)}). Is the computer online?") from None
        sleep(RETRY_SECONDS)
    raise RunError("Couldn't reach JobScratch")


def parts(jobs):
    """The jobs in groups small enough to upload: at most PART_JOBS jobs and about PART_BYTES each."""
    group, size = [], 0
    for job in jobs:
        length = len(json.dumps(job))
        if group and (size + length > PART_BYTES or len(group) >= PART_JOBS):
            yield group
            group, size = [], 0
        group.append(job)
        size += length
    yield group  # Always at least one, so even "nothing found" is reported.


def upload(config, document, failed, started_at, upload_call=call):
    run_id = uuid.uuid4().hex
    groups = list(parts(document["jobs"]))
    total = 0
    for index, group in enumerate(groups):
        answer = upload_call(
            config,
            "/api/helper/results",
            {
                "id": run_id,
                "startedAt": started_at,
                "query": document["query"],
                "failed": failed[:200],
                "jobs": group,
                "done": index == len(groups) - 1,
            },
        )
        total = answer.get("count", total)
    return total


def run(config, scrape_jobs, keep_awake=lambda on: None, upload_call=call):
    import helper
    import search

    started_at = datetime.now(timezone.utc).isoformat()
    saved = upload_call(config, "/api/helper/searches")
    try:
        options = helper.search_options(saved)
    except helper.BadRequest as error:
        raise RunError(f"The saved search can't run: {error}") from None
    terms, locations, searches = search.plan(options.search, options.location)
    where = f" in {', '.join(place for place in locations if place)}" if any(locations) else ""
    search.log(f"Searching {', '.join(options.sites)} for {len(terms)} job titles{where} ({len(searches)} searches)…")
    keep_awake(True)
    try:
        document, failed = search.run_searches(scrape_jobs, options)
    finally:
        keep_awake(False)
    total = upload(config, document, failed, started_at, upload_call)
    search.log(f"Sent {total} jobs to JobScratch." + (f" Failed searches: {'; '.join(failed)}" if failed else ""))
    return total


def open_log():
    """Everything printed goes to scheduled.log: there's no window when Task Scheduler runs this."""
    if LOG_FILE.exists() and LOG_FILE.stat().st_size > MAX_LOG_BYTES:
        LOG_FILE.unlink()
    log = open(LOG_FILE, "a", encoding="utf-8", buffering=1)
    sys.stdout = sys.stderr = log
    print(f"\n--- {datetime.now().strftime('%Y-%m-%d %H:%M')} ---", file=log)
    return log


def main():
    # Before JobSpy is imported, so its own messages land in the log too.
    log = open_log()
    try:
        config = read_config()
        try:
            from jobspy import scrape_jobs
        except ImportError:
            raise RunError("JobSpy isn't installed. Run: pip install -r scripts/jobspy/requirements.txt") from None
        import helper

        run(config, scrape_jobs, keep_awake=helper.keep_awake)
    except RunError as error:
        print(f"Stopped: {error}", file=log)
        sys.exit(1)
    except Exception as error:  # Logged rather than lost, since nobody sees a window.
        print(f"Stopped by an unexpected error: {error!r}", file=log)
        sys.exit(1)


if __name__ == "__main__":
    main()
