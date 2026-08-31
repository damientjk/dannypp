# Bouncer authorization test harness

Black-box verification that the real ownership/capability authorization in
`apps/server/src/policy/*` and `apps/server/src/audit/log.ts` actually
enforces isolation over HTTP. See
`docs/superpowers/specs/2026-08-30-bouncer-test-harness-design.md` for the
full design and the list of known gaps this suite deliberately can't cover
(capability revocation has no API surface yet, for instance).

## Requirements

Python 3.9+, nothing else. No `pip install` needed.

## Running the mocked suite (cases 1-41, 47-50 -- default, fast, no credentials needed)

Start the server with the in-process mock runner:

```bash
cd apps/server
RUNTIME_PROVIDER=mock ARK_API_KEY=test-key ARK_MODEL=ep-test npm run dev
```

In another terminal:

```bash
python qa/bouncer/run_suite.py
```

The 5 real-Codex cases (group `real`, ids 42-46) auto-skip when the server
reports `runtimeProvider: "mock"` or Ark isn't configured -- this is the
expected result without a `.env`.

## Running the real-Codex smoke cases too (cases 42-46)

Requires `ARK_API_KEY` / `ARK_MODEL` for a real Volcengine Ark endpoint, and
the Codex CLI installed (`npm install --global @openai/codex@0.111.0`) or the
container Runtime set up. Start the server normally (`cp .env.example .env`,
fill in credentials, `npm run dev` from `apps/server`), then run the suite
the same way. These 5 cases each spin up a real Codex Run and can take a few
minutes total.

Group E's cases copy the demo-repo fixture directly onto the server's local
filesystem via the Agent's `workspacePath` from the API response, so the
suite must run on the same host as the server for cases 42-46 to work.
Pointing `BOUNCER_BASE_URL` at a remote server would make those 5 cases fail
confusingly, since they'd be writing to a local path that doesn't correspond
to the remote server's actual workspace.

Because cases 42-46 skip by default in this repo's current state (no `.env`
configured), their assertions have never actually been executed against a
real Codex run as of this plan's completion. A "SKIPPED" result for them is
not the same as "PASSED" -- treat it as untested until someone runs the
suite with real credentials.

## Output

A pass/fail line per case on stdout, plus a JSON report at
`qa/bouncer/results/report.json`. Exit code is non-zero if any case FAILed
or ERRORed (SKIPPED cases don't fail the run).
