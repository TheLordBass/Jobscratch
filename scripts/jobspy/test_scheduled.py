"""
Checks the morning run in scheduled.py with stand-ins for JobSpy and JobScratch, so nothing is contacted.

    cd scripts/jobspy
    .venv/Scripts/python -m unittest test_scheduled      (on a Mac or Linux: .venv/bin/python)
"""

import io
import json
import tempfile
import unittest
import urllib.error
from pathlib import Path

import scheduled
import search
from test_search import FakeJobSpy

CONFIG = {"url": "https://jobscratch.example", "token": "t" * 32}

SAVED_SEARCH = {
    "search": ["data analyst"],
    "location": ["Manchester"],
    "sites": ["indeed", "linkedin"],
    "results": 5,
    "hours": 48,
    "remote": False,
    "linkedinDescriptions": False,
    "linkedinPace": 0,
    "distance": 25,
    "country": "united kingdom",
}


class FakeJobScratch:
    """Answers the two helper routes and records what was sent."""

    def __init__(self, saved=SAVED_SEARCH):
        self.saved = saved
        self.parts = []

    def __call__(self, config, path, body=None):
        if path == "/api/helper/searches":
            return self.saved
        self.parts.append(body)
        return {"count": sum(len(part["jobs"]) for part in self.parts)}


class ReadConfig(unittest.TestCase):
    def test_reads_the_env_file(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / ".env"
            path.write_text("# comment\nJOBSCRATCH_URL=https://jobscratch.example/\nJOBSCRATCH_HELPER_TOKEN=\"" + "a" * 32 + '"\n')
            self.assertEqual(scheduled.read_config(path, environ={}), {"url": "https://jobscratch.example", "token": "a" * 32})

    def test_explains_whats_missing(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / ".env"
            path.write_text("JOBSCRATCH_URL=https://jobscratch.example\nJOBSCRATCH_HELPER_TOKEN=short\n")
            with self.assertRaisesRegex(scheduled.RunError, "JOBSCRATCH_HELPER_TOKEN"):
                scheduled.read_config(path, environ={})
            # A plain-http address other than this computer would send the token unencrypted.
            path.write_text("JOBSCRATCH_URL=http://jobscratch.example\nJOBSCRATCH_HELPER_TOKEN=" + "a" * 32)
            with self.assertRaisesRegex(scheduled.RunError, "JOBSCRATCH_URL"):
                scheduled.read_config(path, environ={})


class Parts(unittest.TestCase):
    def test_splits_by_count_and_size(self):
        jobs = [{"description": "x" * 100} for _ in range(1200)]
        groups = list(scheduled.parts(jobs))
        self.assertEqual([len(group) for group in groups], [500, 500, 200])
        big = [{"description": "x" * 900_000} for _ in range(5)]
        self.assertEqual([len(group) for group in scheduled.parts(big)], [2, 2, 1])

    def test_nothing_found_is_still_one_part(self):
        self.assertEqual(list(scheduled.parts([])), [[]])


class Run(unittest.TestCase):
    def setUp(self):
        search.log = lambda message: None

    def test_runs_the_saved_search_and_uploads_it(self):
        app = FakeJobScratch()
        awake = []
        total = scheduled.run(CONFIG, FakeJobSpy(), keep_awake=awake.append, upload_call=app)
        self.assertEqual(total, 2)
        self.assertEqual(awake, [True, False])
        [part] = app.parts
        self.assertTrue(part["done"])
        self.assertEqual(part["query"], {"search": ["data analyst"], "location": ["Manchester"]})
        self.assertEqual({job["site"] for job in part["jobs"]}, {"indeed", "linkedin"})
        self.assertRegex(part["id"], r"^[0-9a-f]{32}$")

    def test_runs_title_lists_each_in_its_own_places_and_labels_the_jobs(self):
        lists_search = {
            **{key: value for key, value in SAVED_SEARCH.items() if key not in ("search", "location")},
            "searches": [
                {"term": "data analyst", "location": "Manchester", "list": "Data roles"},
                {"term": "BI analyst", "location": "Manchester", "list": "Data roles"},
                {"term": "operations analyst", "location": "Leeds", "list": "Operations"},
                # The same search in two lists runs once, and its jobs carry both names.
                {"term": "Data Analyst", "location": "manchester", "list": "Operations"},
            ],
            "batch": {"index": 1, "count": 3},
        }
        app = FakeJobScratch(lists_search)
        jobspy = FakeJobSpy()
        scheduled.run(CONFIG, jobspy, upload_call=app)
        self.assertEqual([term for _, term in jobspy.calls], ["data analyst", "BI analyst", "operations analyst"])
        [part] = app.parts
        self.assertEqual(part["batch"], {"index": 1, "count": 3})
        self.assertEqual(part["query"]["lists"], ["Data roles", "Operations"])
        lists = {job["title"]: job["lists"] for job in part["jobs"]}
        self.assertEqual(lists["data analyst"], ["Data roles", "Operations"])
        self.assertEqual(lists["operations analyst"], ["Operations"])

    def test_a_bad_saved_search_stops_with_a_reason(self):
        app = FakeJobScratch({**SAVED_SEARCH, "sites": ["myspace"]})
        with self.assertRaisesRegex(scheduled.RunError, "can't run"):
            scheduled.run(CONFIG, FakeJobSpy(), upload_call=app)
        self.assertEqual(app.parts, [])

    def test_many_jobs_go_up_in_parts_with_one_run_id(self):
        app = FakeJobScratch()
        document = {"query": {"search": ["a"], "location": []}, "jobs": [{"title": str(i)} for i in range(1100)]}
        self.assertEqual(scheduled.upload(CONFIG, document, [], "2026-10-27T07:00:00+00:00", app), 1100)
        self.assertEqual([part["done"] for part in app.parts], [False, False, True])
        self.assertEqual(len({part["id"] for part in app.parts}), 1)


class Call(unittest.TestCase):
    def test_retries_server_errors_but_not_a_wrong_token(self):
        attempts = []

        def opener(status):
            def open_(request, timeout):
                attempts.append(request.get_header("Authorization"))
                raise urllib.error.HTTPError(request.full_url, status, "", {}, io.BytesIO(json.dumps({"error": f"no ({status})"}).encode()))

            return open_

        with self.assertRaisesRegex(scheduled.RunError, r"no \(502\)"):
            scheduled.call(CONFIG, "/api/helper/searches", opener=opener(502), sleep=lambda s: None)
        self.assertEqual(len(attempts), 3)
        self.assertEqual(attempts[0], "Bearer " + "t" * 32)
        attempts.clear()
        with self.assertRaisesRegex(scheduled.RunError, r"no \(401\)"):
            scheduled.call(CONFIG, "/api/helper/searches", opener=opener(401), sleep=lambda s: None)
        self.assertEqual(len(attempts), 1)


if __name__ == "__main__":
    unittest.main()
