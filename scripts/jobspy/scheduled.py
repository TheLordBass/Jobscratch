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

While it searches, and once it's done, it asks JobScratch to match the jobs against your CV and get
the best ones ready to apply, if that's switched on (Add a job > From JobSpy > Before you're up).

What it does is written to scripts/jobspy/scheduled.log. The same caveat as search.py applies:
these sites' terms forbid scraping, so use it at your own risk.
"""

import json
import os
import sys
import threading
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

    def __init__(self, message, code=None):
        super().__init__(message)
        self.code = code


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


def call(config, path, body=None, opener=urllib.request.urlopen, sleep=time.sleep, timeout=60):
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
            with opener(request, timeout=timeout) as response:
                return json.loads(response.read() or b"{}")
        except urllib.error.HTTPError as error:
            try:
                message = json.loads(error.read() or b"{}").get("error")
            except ValueError:
                message = None
            # Wrong token, nothing saved and the like won't fix themselves.
            if error.code < 500 or attempt == TRIES:
                raise RunError(message or f"JobScratch answered {error.code}", error.code) from None
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


def job_key(row):
    """How a run tells its rows apart (search.py keeps one row per link)."""
    return row.get("job_url") or f"{row.get('site')}|{row.get('title')}|{row.get('company')}"


class Uploader:
    """
    Sends a run's jobs to JobScratch as they're found, not just at the end: so they're on your phone
    while LinkedIn is still being searched, and a run stopped early (Task Scheduler's time limit, the
    computer shutting down) has still sent what it found. Each row is sent once, or again if it has
    since been found by another title list.
    """

    # How often to send during a run, at most, and how many new jobs are worth sending sooner.
    EVERY_SECONDS = 120
    ENOUGH_NEW = 300

    def __init__(self, config, started_at, batch, upload_call=call, clock=time.monotonic):
        self.config, self.started_at, self.batch = config, started_at, batch
        self.upload_call, self.clock = upload_call, clock
        self.id = uuid.uuid4().hex
        self.sent = {}
        self.last = clock()
        self.total = 0

    def unsent(self, document):
        return [row for row in document["jobs"] if self.sent.get(job_key(row)) != tuple(row.get("lists", []))]

    def maybe_send(self, document):
        """During the run: send what's new, if it's been a while or there's plenty of it. Never stops the run."""
        new = self.unsent(document)
        if not new or (self.clock() - self.last < self.EVERY_SECONDS and len(new) < self.ENOUGH_NEW):
            return
        try:
            self.send(document["query"], new, [], done=False)
        except RunError as error:
            # Tried again with the next batch, and at the end.
            print(f"    Couldn't send the jobs so far ({error}); trying again later.", file=sys.stderr)

    def finish(self, document, failed):
        """At the end: everything not sent yet, marked as the last part."""
        return self.send(document["query"], self.unsent(document), failed, done=True)

    def send(self, query, rows, failed, done):
        groups = list(parts(rows))
        for index, group in enumerate(groups):
            answer = self.upload_call(
                self.config,
                "/api/helper/results",
                {
                    "id": self.id,
                    "startedAt": self.started_at,
                    "query": query,
                    # Which part of the title lists this was, when they take several mornings to get through.
                    "batch": self.batch,
                    "failed": failed[:200],
                    "jobs": group,
                    "done": done and index == len(groups) - 1,
                },
            )
            for row in group:
                self.sent[job_key(row)] = tuple(row.get("lists", []))
            self.total = answer.get("count", self.total)
        self.last = self.clock()
        return self.total


class Preparer:
    """
    Asks JobScratch to work on the run's jobs (/api/helper/prepare): matching them against your CV
    while the run searches, then getting the best ready to apply and sending the summary once it's
    done. Each request does a little; this keeps asking until JobScratch says it's done (or that it's
    switched off). Runs alongside the searches, in its own thread.
    """

    # While there's nothing to do, how long to wait before asking again.
    IDLE_SECONDS = 180
    # A step can take a few minutes (it writes a CV, a cover letter and answers at once).
    STEP_TIMEOUT = 330
    # Give up after this many failed requests in a row.
    MAX_ERRORS = 5
    # Once the run is over: the pause between asks when there's a wait (a rate limit), and how many
    # waits in a row before giving up (the run was replaced by a newer one, say).
    AFTER_SECONDS = 30
    MAX_WAITS_AFTER = 40

    def __init__(self, config, run_id, prepare_call=call, log=print, sleep=time.sleep):
        self.config, self.run_id, self.prepare_call, self.log, self.sleep = config, run_id, prepare_call, log, sleep
        self.searching_done = threading.Event()
        self.thread = None
        self.result = None

    def start(self):
        self.thread = threading.Thread(target=self.loop, name="prepare", daemon=True)
        self.thread.start()

    def finish(self, timeout=None):
        """After the run has sent its last jobs: carry on until it's all done."""
        self.searching_done.set()
        if self.thread:
            self.thread.join(timeout)
        return self.result

    def loop(self):
        errors = waits = 0
        while True:
            try:
                answer = self.prepare_call(
                    self.config, "/api/helper/prepare", {"id": self.run_id}, timeout=self.STEP_TIMEOUT
                )
                errors = 0
            except RunError as error:
                if error.code == 404:
                    self.log("    This JobScratch doesn't match or prepare jobs yet (update it); skipping that.")
                    return
                errors += 1
                if errors >= self.MAX_ERRORS:
                    self.log(f"    Stopped matching and preparing jobs: {error}")
                    return
                self.sleep(60)
                continue
            state = answer.get("state")
            if state in ("done", "off"):
                self.result = answer
                if answer.get("message"):
                    self.log(f"Prepared: {answer['message']}" if state == "done" else f"    {answer['message']}")
                return
            if state == "working":
                waits = 0
            elif not self.searching_done.is_set():
                # Wakes early once the searches are done, to get on with the rest.
                self.searching_done.wait(self.IDLE_SECONDS)
            else:
                waits += 1
                if waits > self.MAX_WAITS_AFTER:
                    self.log(f"    Stopped waiting to prepare jobs: {answer.get('message') or 'no answer'}")
                    return
                self.sleep(self.AFTER_SECONDS)


def run(config, scrape_jobs, keep_awake=lambda on: None, upload_call=call, prepare_call=None):
    import helper
    import search

    started_at = datetime.now(timezone.utc).isoformat()
    saved = upload_call(config, "/api/helper/searches")
    try:
        options = helper.search_options(saved)
    except helper.BadRequest as error:
        raise RunError(f"The saved search can't run: {error}") from None
    terms, locations, searches = search.plan(options.search, options.location, options.pairs)
    where = f" in {', '.join(place for place in locations if place)}" if any(locations) else ""
    batch = saved.get("batch") or {}
    part = f", part {batch['index'] + 1} of {batch['count']} of your title lists" if batch.get("count", 1) > 1 else ""
    search.log(f"Searching {', '.join(options.sites)} for {len(terms)} job titles{where} ({len(searches)} searches{part})…")
    uploader = Uploader(config, started_at, saved.get("batch"), upload_call)
    preparer = Preparer(config, uploader.id, prepare_call or upload_call, log=search.log)
    keep_awake(True)
    try:
        preparer.start()
        document, failed = search.run_searches(scrape_jobs, options, on_found=uploader.maybe_send)
        total = uploader.finish(document, failed)
        search.log(f"Sent {total} jobs to JobScratch." + (f" Failed searches: {'; '.join(failed)}" if failed else ""))
        # Matching what's left and getting the best ready: well within the task's time limit.
        preparer.finish(timeout=6 * 3600)
    finally:
        keep_awake(False)
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
