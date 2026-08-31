"""Minimal stdlib-only HTTP client for the Bouncer test harness."""

import json
import urllib.error
import urllib.request


class Client:
    def __init__(self, base_url):
        self.base_url = base_url.rstrip("/")

    def request(self, method, path, token=None, body=None):
        url = self.base_url + path
        data = json.dumps(body).encode("utf-8") if body is not None else None
        headers = {}
        if body is not None:
            headers["Content-Type"] = "application/json"
        if token:
            headers["x-session-token"] = token
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw = resp.read().decode("utf-8")
                return resp.status, (json.loads(raw) if raw else {})
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8")
            return exc.code, (json.loads(raw) if raw else {})
