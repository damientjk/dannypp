#!/usr/bin/env python3
"""Runs the Bouncer authorization test suite against a live server.

Usage:
    python qa/bouncer/run_suite.py

Environment:
    BOUNCER_BASE_URL  server base URL (default http://127.0.0.1:3000)

See qa/bouncer/README.md for how to start the server first.
"""

import json
import os
import sys
import time

from cases import CASES, Context, setup_fixtures
from http_client import Client

RESULTS_DIR = os.path.join(os.path.dirname(__file__), "results")


def main():
    base_url = os.environ.get("BOUNCER_BASE_URL", "http://127.0.0.1:3000")
    client = Client(base_url)

    print(f"Bouncer suite against {base_url}")
    try:
        status, sysinfo = client.request("GET", "/api/system")
    except OSError as exc:
        print(f"server not reachable at {base_url} ({exc}); is it running?")
        sys.exit(2)
    if status != 200:
        print(f"server not reachable at {base_url} ({status}); is it running?")
        sys.exit(2)
    real_ready = bool(sysinfo.get("arkConfigured")) and sysinfo.get("runtimeProvider") != "mock"
    print(f"runtimeProvider={sysinfo.get('runtimeProvider')} arkConfigured={sysinfo.get('arkConfigured')}")

    ctx = Context(client=client)
    results = []
    fixtures_ready = False
    fixtures_failed = False

    for test_case in sorted(CASES, key=lambda c: c.id):
        if test_case.group == "real" and not real_ready:
            results.append((test_case, "SKIPPED", "server not in a real-runtime, Ark-configured mode"))
            continue
        if test_case.group not in ("auth", "real") and not fixtures_ready and not fixtures_failed:
            try:
                setup_fixtures(ctx)
                fixtures_ready = True
            except Exception as exc:
                fixtures_failed = True
                results.append((test_case, "ERROR", f"fixture setup failed: {exc!r}"))
                continue
        if test_case.group not in ("auth", "real") and not fixtures_ready:
            results.append((test_case, "ERROR", "fixture setup failed earlier, skipping"))
            continue
        try:
            test_case.fn(ctx)
            results.append((test_case, "PASS", ctx.observed_output))
        except AssertionError as exc:
            results.append((test_case, "FAIL", str(exc)))
        except Exception as exc:  # report, don't crash the run
            results.append((test_case, "ERROR", repr(exc)))

    print_report(results)
    write_json_report(base_url, results)

    failing = [r for r in results if r[1] in ("FAIL", "ERROR")]
    sys.exit(1 if failing else 0)


def print_report(results):
    print()
    for test_case, status, detail in results:
        line = f"[{status:8}] #{test_case.id:2} {test_case.description}"
        print(line if status in ("PASS", "SKIPPED") else f"{line}\n           -> {detail}")
    counts = {}
    for _tc, status, _detail in results:
        counts[status] = counts.get(status, 0) + 1
    print()
    print(f"{len(results)} cases: " + ", ".join(f"{count} {status}" for status, count in sorted(counts.items())))


def write_json_report(base_url, results):
    os.makedirs(RESULTS_DIR, exist_ok=True)
    report = {
        "base_url": base_url,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "cases": [
            {"id": tc.id, "description": tc.description, "group": tc.group, "status": status, "detail": detail}
            for tc, status, detail in results
        ],
    }
    out_path = os.path.join(RESULTS_DIR, "report.json")
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)
    print(f"wrote {out_path}")


if __name__ == "__main__":
    main()
