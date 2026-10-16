"""
Checks the search loop in search.py with a stand-in for JobSpy, so no site is contacted.

    cd scripts/jobspy
    .venv/Scripts/python -m unittest test_search      (on a Mac or Linux: .venv/bin/python)
"""

import json
import logging
import unittest
from types import SimpleNamespace

import search


class FakeFrame:
    """Just enough of a pandas DataFrame for search_once."""

    def __init__(self, rows):
        self.rows = rows

    def __len__(self):
        return len(self.rows)

    def to_json(self, **_):
        return json.dumps(self.rows)


class FakeJobSpy:
    """Records each search, and has LinkedIn turn away the first `linkedin_blocks` of its searches."""

    def __init__(self, linkedin_blocks=0):
        self.calls = []
        self.linkedin_blocks = linkedin_blocks

    def __call__(self, site_name, search_term, **_):
        self.calls.append((tuple(site_name), search_term))
        rows = []
        for site in site_name:
            if site == "linkedin" and self.linkedin_blocks > 0:
                self.linkedin_blocks -= 1
                logging.getLogger("JobSpy:LinkedIn").error("LinkedIn response status code 429")
                continue
            rows.append({"site": site, "job_url": f"https://{site}.example/{search_term}", "title": search_term})
        return FakeFrame(rows)


def options(**overrides):
    base = dict(
        search=["data analyst", "bi analyst"],
        location=["Manchester"],
        sites=["indeed", "linkedin"],
        distance=50,
        results=5,
        hours=None,
        remote=False,
        linkedin_descriptions=False,
        country="uk",
        pause=0,
        linkedin_pace=0,
        # Seconds rather than minutes, so the test is quick.
        linkedin_cooldowns=[0.001],
    )
    base.update(overrides)
    return SimpleNamespace(**base)


class RunSearches(unittest.TestCase):
    def setUp(self):
        search.log = lambda message: None  # Keep the test output quiet.

    def test_unpaced_searches_every_site_together(self):
        jobspy = FakeJobSpy()
        document, failed = search.run_searches(jobspy, options())
        self.assertEqual(
            jobspy.calls,
            [(("indeed", "linkedin"), "data analyst"), (("indeed", "linkedin"), "bi analyst")],
        )
        self.assertEqual(len(document["jobs"]), 4)
        self.assertEqual(failed, [])

    def test_paced_linkedin_runs_alone_after_the_other_sites(self):
        jobspy = FakeJobSpy()
        waits = []
        document, failed = search.run_searches(
            jobspy,
            options(linkedin_pace=0.001),
            on_status=lambda **fields: waits.append(fields),
        )
        self.assertEqual(
            jobspy.calls,
            [
                (("indeed",), "data analyst"),
                (("indeed",), "bi analyst"),
                (("linkedin",), "data analyst"),
                (("linkedin",), "bi analyst"),
            ],
        )
        self.assertEqual(len(document["jobs"]), 4)
        self.assertEqual(failed, [])
        self.assertTrue(any(fields.get("endsAround") for fields in waits))

    def test_a_blocked_linkedin_search_is_tried_again_after_a_rest(self):
        jobspy = FakeJobSpy(linkedin_blocks=1)
        document, failed = search.run_searches(jobspy, options(linkedin_pace=0.001))
        linkedin_calls = [call for call in jobspy.calls if call[0] == ("linkedin",)]
        self.assertEqual(linkedin_calls, [(("linkedin",), "data analyst")] * 2 + [(("linkedin",), "bi analyst")])
        self.assertEqual(len(document["jobs"]), 4)
        self.assertEqual(failed, [])

    def test_linkedin_is_given_up_on_after_blocking_again_and_again(self):
        jobspy = FakeJobSpy(linkedin_blocks=99)
        terms = [f"title {n}" for n in range(6)]
        document, failed = search.run_searches(jobspy, options(search=terms, linkedin_pace=0.001))
        linkedin_calls = [call for call in jobspy.calls if call[0] == ("linkedin",)]
        # Tried twice, then twice more for the next search, then the rest are skipped.
        self.assertEqual(len(linkedin_calls), search.LINKEDIN_MAX_BLOCKS)
        self.assertEqual(len([label for label in failed if label.startswith("LinkedIn")]), 6)
        # The other site's jobs are all kept.
        self.assertEqual(len(document["jobs"]), 6)

    def test_stopping_during_the_linkedin_wait(self):
        jobspy = FakeJobSpy()
        calls = {"n": 0}

        def should_stop():
            calls["n"] += 1
            return len(jobspy.calls) >= 3

        search.run_searches(jobspy, options(linkedin_pace=1), should_stop=should_stop)
        # Stopped while waiting a minute for the second LinkedIn search.
        self.assertEqual(len(jobspy.calls), 3)


if __name__ == "__main__":
    unittest.main()
