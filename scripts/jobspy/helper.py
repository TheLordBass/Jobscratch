"""
Runs JobSpy for JobScratch on your own computer, so you can search from the web
app (Find jobs > Add a job > From JobSpy) instead of saving and loading files.

Start it by double-clicking start-helper.bat (Windows), or run:

    python scripts/jobspy/helper.py

Leave the window open while you search. It stops by itself after 30 minutes
without a search; press Stop in the app, close the window or press Ctrl+C to
stop it sooner.

It only listens on this computer (127.0.0.1) and only answers the JobScratch
site, so other websites you visit can't use it. The same caveat as search.py
applies: these sites' terms forbid scraping, so use it at your own risk.
"""

import argparse
import json
import sys
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace

import search

APP = "jobscratch-jobspy-helper"
VERSION = 1
PORT = 8765
DEFAULT_ORIGINS = ["https://jobscratch.vercel.app", "http://localhost:3000", "http://127.0.0.1:3000"]

# Limits on one request from the app, so a mistake can't start hundreds of searches.
MAX_TERMS = 50
MAX_LOCATIONS = 10
# 50 job titles in two places. At about 8 seconds a search, that's under 15 minutes.
MAX_SEARCHES = 100
MAX_BODY = 64 * 1024


def parse_args():
    parser = argparse.ArgumentParser(description="Let JobScratch run JobSpy searches on this computer.")
    parser.add_argument("--port", type=int, default=PORT, help=f"port to listen on (default: {PORT})")
    parser.add_argument(
        "--origin",
        nargs="*",
        default=[],
        help="other JobScratch addresses to answer, e.g. a Vercel preview URL (always: " + ", ".join(DEFAULT_ORIGINS) + ")",
    )
    parser.add_argument(
        "--idle-minutes",
        type=float,
        default=30,
        help="stop after this many minutes without a search (default: 30; 0 to keep running)",
    )
    return parser.parse_args()


class BadRequest(Exception):
    pass


def text_list(value, name, limit, allow_empty):
    if value is None:
        value = []
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise BadRequest(f"{name} must be a list of text")
    items = [item.strip()[:100] for item in value if item.strip()]
    if not items and not allow_empty:
        raise BadRequest(f"Give at least one {name[:-1] if name.endswith('s') else name}")
    if len(items) > limit:
        raise BadRequest(f"At most {limit} {name}")
    return items


def whole_number(value, name, low, high, default):
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not low <= value <= high:
        raise BadRequest(f"{name} must be a number from {low} to {high}")
    return int(value)


def search_pairs(value):
    """The morning run's searches: (job title, place, title list) each, at most MAX_SEARCHES."""
    if not isinstance(value, list) or not value:
        raise BadRequest("searches must be a list of searches")
    # The same search can be in several lists, so the limit (below) is on searches once repeats are merged.
    if len(value) > MAX_SEARCHES * 20:
        raise BadRequest(f"That's {len(value)} searches; at most {MAX_SEARCHES} at once")
    pairs = []
    for item in value:
        item = item if isinstance(item, dict) else {}
        term, place, name = item.get("term"), item.get("location") or "", item.get("list") or ""
        if not isinstance(term, str) or not term.strip() or not isinstance(place, str) or not isinstance(name, str):
            raise BadRequest("Each search needs a job title, and a place and title list as text")
        pairs.append((term.strip()[:100], place.strip()[:100], name.strip()[:60]))
    return pairs


def search_options(body):
    """The app's request as search.py's options, checked."""
    if not isinstance(body, dict):
        raise BadRequest("Send the search as a JSON object")
    sites = body.get("sites") or ["indeed", "linkedin"]
    if not isinstance(sites, list) or not sites or any(site not in search.SITES for site in sites):
        raise BadRequest("sites must be some of: " + ", ".join(search.SITES))
    country = body.get("country") or "uk"
    if not isinstance(country, str) or len(country) > 40:
        raise BadRequest("country must be a country name, e.g. uk")
    try:
        from jobspy.model import Country

        Country.from_string(country.strip().lower())
    except ValueError:
        raise BadRequest(f"JobSpy can't search Indeed or Glassdoor in “{country}”") from None

    # Either every combination of `search` and `location` (the app's search form), or exactly the
    # searches listed in `searches` (the morning run's title lists, each with its own places).
    pairs = search_pairs(body["searches"]) if "searches" in body else None
    terms, places, _ = search.plan([], [], pairs) if pairs else (None, None, None)
    options = SimpleNamespace(
        search=terms or text_list(body.get("search"), "keywords", MAX_TERMS, allow_empty=False),
        location=places or text_list(body.get("location"), "locations", MAX_LOCATIONS, allow_empty=True) or [""],
        pairs=pairs,
        sites=list(dict.fromkeys(sites)),
        distance=whole_number(body.get("distance"), "distance", 1, 200, 50),
        results=whole_number(body.get("results"), "results", 1, 100, 25),
        hours=whole_number(body.get("hours"), "hours", 1, 24 * 60, None),
        remote=bool(body.get("remote")),
        linkedin_descriptions=bool(body.get("linkedinDescriptions")),
        # Minutes between LinkedIn searches, run after the other sites (see search.run_searches).
        linkedin_pace=whole_number(body.get("linkedinPace"), "linkedinPace", 0, 30, 0),
        country=country.strip().lower(),
        pause=3,
    )
    _, _, searches = search.plan(options.search, options.location, pairs)
    if len(searches) > MAX_SEARCHES:
        raise BadRequest(f"That's {len(searches)} searches; at most {MAX_SEARCHES} at once (keywords × locations)")
    return options


def keep_awake(on):
    """While a search runs, ask Windows not to go to sleep, which would pause it. Ends with the search."""
    if sys.platform != "win32":
        return
    import ctypes

    ES_CONTINUOUS, ES_SYSTEM_REQUIRED = 0x80000000, 0x00000001
    ctypes.windll.kernel32.SetThreadExecutionState(ES_CONTINUOUS | (ES_SYSTEM_REQUIRED if on else 0))


class Helper:
    """What the helper is doing: at most one search at a time."""

    def __init__(self, idle_minutes):
        self.lock = threading.Lock()
        self.job = None
        self.idle = timedelta(minutes=idle_minutes) if idle_minutes > 0 else None
        self.last_search = datetime.now(timezone.utc)
        self.stopping = threading.Event()

    def busy(self):
        return self.job is not None and self.job["status"] == "running"

    def stops_at(self):
        if not self.idle or self.busy():
            return None
        return (self.last_search + self.idle).isoformat()

    def status(self):
        with self.lock:
            return {"app": APP, "version": VERSION, "busy": self.busy(), "sites": search.SITES, "stopsAt": self.stops_at()}

    def start(self, options):
        from jobspy import scrape_jobs

        with self.lock:
            if self.busy():
                return None
            job = {
                "id": uuid.uuid4().hex,
                "status": "running",
                "startedAt": datetime.now(timezone.utc).isoformat(),
                "finishedAt": None,
                # Roughly when it'll finish, and any long wait (e.g. between LinkedIn searches).
                "endsAround": None,
                "waitingUntil": None,
                "waitingFor": None,
                "done": 0,
                "total": len(search.plan(options.search, options.location, options.pairs)[2]),
                "current": None,
                "found": 0,
                "failed": [],
                "error": None,
                "result": None,
                # The jobs found so far, sent only when the app asks (GET /search/partial).
                "partial": None,
                "cancel": False,
            }
            self.job = job
            self.last_search = datetime.now(timezone.utc)

        def progress(done, total, label, found):
            with self.lock:
                job.update(done=done, total=total, current=label, found=found)

        def report(**fields):
            with self.lock:
                job.update(**fields)

        def found_so_far(document):
            with self.lock:
                job.update(partial=document, found=len(document["jobs"]))

        def run():
            keep_awake(True)
            try:
                document, failed = search.run_searches(
                    scrape_jobs,
                    options,
                    on_progress=progress,
                    should_stop=lambda: job["cancel"],
                    on_found=found_so_far,
                    on_status=report,
                )
                with self.lock:
                    job.update(result=document, failed=failed, status="cancelled" if job["cancel"] else "done")
            except Exception as error:  # Shown in the app rather than lost in this window.
                with self.lock:
                    job.update(status="failed", error=str(error))
            finally:
                keep_awake(False)
                with self.lock:
                    self.last_search = datetime.now(timezone.utc)
                    job.update(finishedAt=self.last_search.isoformat(), partial=None, waitingUntil=None, waitingFor=None)
                search.log(f"Search {job['status']}: {job['found']} jobs. Back in JobScratch, they're ready to look through.")

        threading.Thread(target=run, daemon=True).start()
        return job

    def view(self, job_id):
        with self.lock:
            job = self.job
            if not job or (job_id and job["id"] != job_id):
                return None
            return {key: value for key, value in job.items() if key not in ("cancel", "partial")}

    def partial(self, job_id):
        with self.lock:
            job = self.job
            if not job or job["id"] != job_id:
                return None
            return job["partial"] or job["result"]

    def cancel(self):
        with self.lock:
            if self.busy():
                self.job["cancel"] = True

    def watch_idle(self, server):
        """Stop the server after `idle` without a search."""
        while not self.stopping.wait(15):
            with self.lock:
                idle = self.idle and not self.busy() and datetime.now(timezone.utc) - self.last_search > self.idle
            if idle:
                search.log("No searches for a while, so the helper has stopped. Start it again when you need it.")
                self.stop(server)

    def stop(self, server):
        self.stopping.set()
        # shutdown() waits for serve_forever() to return, so it can't run on a request's own thread.
        threading.Thread(target=server.shutdown, daemon=True).start()


def make_handler(helper, origins, port):
    hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}

    class Handler(BaseHTTPRequestHandler):
        server_version = "JobScratchJobSpyHelper"

        def log_message(self, format, *args):  # Searches are logged; individual requests aren't.
            pass

        def allowed(self):
            """Only the JobScratch site may use the helper: not other sites, not other machines."""
            if self.headers.get("Host") not in hosts:  # Stops DNS rebinding.
                return False
            origin = self.headers.get("Origin")
            return origin is None or origin in origins

        def send(self, status, body=None):
            data = json.dumps(body if body is not None else {}).encode("utf-8")
            self.send_response(status)
            origin = self.headers.get("Origin")
            if origin in origins:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def do_OPTIONS(self):
            if not self.allowed() or self.headers.get("Origin") not in origins:
                return self.send(403, {"error": "Not allowed"})
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
            self.send_header("Access-Control-Allow-Methods", "GET, POST")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            # Lets a site on the internet reach this computer, once the browser allows it.
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Access-Control-Max-Age", "600")
            self.send_header("Vary", "Origin")
            self.end_headers()

        def do_GET(self):
            if not self.allowed():
                return self.send(403, {"error": "Not allowed"})
            if self.path == "/status":
                return self.send(200, helper.status())
            if self.path.startswith("/search/partial"):
                found = helper.partial(self.path.partition("?id=")[2])
                return self.send(200, found) if found else self.send(404, {"error": "Nothing found yet"})
            if self.path.startswith("/search"):
                job_id = self.path.partition("?id=")[2]
                job = helper.view(job_id)
                return self.send(200, job) if job else self.send(404, {"error": "No such search"})
            self.send(404, {"error": "Not found"})

        def do_POST(self):
            # JSON only: a plain web form from another site can't send it without asking first.
            if not self.allowed() or self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
                return self.send(403, {"error": "Not allowed"})
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_BODY:
                return self.send(413, {"error": "Too big"})
            try:
                body = json.loads(self.rfile.read(length) or b"{}")
            except ValueError:
                return self.send(400, {"error": "Send JSON"})

            if self.path == "/search":
                try:
                    options = search_options(body)
                except BadRequest as error:
                    return self.send(400, {"error": str(error)})
                job = helper.start(options)
                if not job:
                    return self.send(409, {"error": "A search is already running"})
                return self.send(202, helper.view(job["id"]))
            if self.path == "/search/cancel":
                helper.cancel()
                return self.send(200, {"ok": True})
            if self.path == "/stop":
                self.send(200, {"ok": True})
                search.log("Stopped from JobScratch. Start it again when you need it.")
                return helper.stop(self.server)
            self.send(404, {"error": "Not found"})

    return Handler


def main():
    args = parse_args()
    try:
        import jobspy  # noqa: F401  Checked now, so a missing install shows up before the app tries.
    except ImportError:
        raise SystemExit("JobSpy isn't installed. Run: pip install -r scripts/jobspy/requirements.txt") from None

    origins = set(DEFAULT_ORIGINS) | {origin.rstrip("/") for origin in args.origin}
    helper = Helper(args.idle_minutes)
    try:
        server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(helper, origins, args.port))
    except OSError:
        raise SystemExit(f"Port {args.port} is in use. Is the helper already running in another window?") from None
    server.daemon_threads = True
    threading.Thread(target=helper.watch_idle, args=(server,), daemon=True).start()

    search.log("JobScratch's JobSpy helper is running. Leave this window open, and search from")
    search.log("JobScratch: Find jobs > Add a job > From JobSpy.")
    if helper.idle:
        search.log(f"It stops by itself after {args.idle_minutes:g} minutes without a search. Close this window to stop it now.")
    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        search.log("Stopped.")
    finally:
        helper.stopping.set()
        server.server_close()
        time.sleep(0.2)


if __name__ == "__main__":
    main()
