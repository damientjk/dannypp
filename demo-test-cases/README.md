# Demo test cases

Two scripts that drive a **running** Volc Agent Launchpad over real HTTP and
print, case by case, what the app does and what it refuses to do. Nothing is
stubbed and the browser is not involved — these are the same calls the pixel
world makes, so whatever passes here is what the animation is rendering.

The second script is the one that matters. Anyone can show a green path; what a
judge actually asks is what happens when something is *not* allowed, and whether
the refusal is real or decorative.

## Run it

Start the app, then run everything:

```bash
npm run dev
```

```bash
./demo-test-cases/run-all.sh
```

That prints both parts and writes `transcript.txt` next to these scripts. It
exits non-zero if any case behaved differently than predicted.

Either half can be run on its own:

```bash
./demo-test-cases/01-what-works.sh
```

```bash
./demo-test-cases/02-what-does-not-work.sh
```

**No Ark API key is needed.** Every authorization decision is made before the
model is ever called, so the whole middleware story runs on a machine with no
credentials at all. On Windows, run these from Git Bash or WSL.

Point them somewhere else with `BASE`, or as the first argument to `run-all.sh`:

```bash
BASE=http://localhost:3000 ./demo-test-cases/02-what-does-not-work.sh
```

## Reading the output

- `OK` — the app behaved exactly as the case predicted. For part 2 that usually
  means **it refused**, which is the desired outcome.
- `BAD` — the app did something else. In part 2 this is the serious one: it
  means access was not refused when it should have been.

Expected HTTP status is part of every assertion on purpose. "Refused" and
"crashed" are different outcomes, and a demo that blurs them proves nothing.

## Part 1 — what works (13 cases)

| # | Case | Shows |
|---|---|---|
| 1 | Control plane answers | The platform is up |
| 2 | Sign in, session identifies the human | Real identity, not a UI flag |
| 3 | Create an Agent, owner stamped server-side | Ownership set by the backend, not the caller |
| 4 | Issue a scoped, time-bound keycard | Capabilities are real objects |
| 5 | Agent reads its owner's file → `permit` | **And returns the actual file contents**, so it demonstrably touched disk |
| 6 | Human reads their own file | Still goes through the PDP |
| 7 | Both namespaces listed | The rooms on screen are a real directory |
| 8 | Permit recorded, attributed, names the file | The audit trail is populated by real decisions |

## Part 2 — what does not work (28 cases)

| # | Case | Expected |
|---|---|---|
| 1 | No session / invented token / wrong password | `401` |
| 2 | **A's Agent reaching for B's file** | `403 out-of-scope`, and B's secret absent from the response |
| 2 | A human reaching into B's namespace | `403 out-of-scope` |
| 3 | Agent with no keycard | `403 capability-unknown` |
| 3 | Minting a keycard for another owner | `400` — refused at issue time, not just at read time |
| 3 | `res://user-a/../user-b/...` traversal | `403 resource-unknown` |
| 4 | Permitted → owner revokes → **identical request** | `200` then `403 capability-revoked` |
| 4 | A different user tries to revoke | `403` — revocation is itself authorized |
| 5 | Expired keycard | `403 capability-expired` |
| 6 | B reads / renames / starts / tasks / deletes A's Agent | `403 not-owner` on all six verbs |
| 6 | A's Agent in B's list | Absent entirely, not merely unclickable |
| 7 | B's refusals in A's audit trail | Absent — the log is isolated too |
| 8 | Nameless Agent, empty message, unknown id | `400`, `400`, `404` — clean rejections, not crashes |
| 9 | Asking an Agent to do real work | `503 Ark is not configured` |
| 10 | Listing reports refused filenames | `skipped` array present |

### Case 9 is a real limitation, stated plainly

With `ARK_API_KEY` and `ARK_MODEL` unset there is no model behind the Agent, so
no Codex run can happen and the app says so with a `503`. That is the honest
boundary of what this demo proves.

Worth noticing *where* it fails: authorization in cases 1–8 still worked. The
guard runs before the model is ever reached, so the middleware is demonstrable
on a machine that could never run an Agent at all. If Ark *is* configured on
your machine, the script says so and skips the case rather than pretending.

### Case 10, in your own hands

Filenames outside `[A-Za-z0-9][A-Za-z0-9._-]*` — spaces, leading dots — cannot
become resource URIs. They are reported in the listing's `skipped` array rather
than dropped in silence. To see it, drop a file called `my notes.txt` into
`apps/server/.data/resources/user-a/` and re-run.

## What these scripts do not cover

Being straight about the edges:

- **No Agent actually runs.** Proving Codex executes a task needs Ark
  credentials; that is a separate demo.
- **Codex's own file access is not policed by the PDP.** An Agent's workspace
  reads and writes go through the OS under `CODEX_SANDBOX_MODE`, and the real
  containment there is the container's bind mounts, not this middleware.
- **The browser is not exercised.** That the world only ever *relays* these
  decisions is proven by the automated suites instead:
  `apps/web/src/world/demonstration.test.ts` walks up to every gated room and
  asserts each one produced a backend request.

## Related

- `docs/demo/` — the earlier evidence scripts, same spirit, backend-only.
- `apps/server/src/demonstration.test.ts` — the same claims as automated tests.
- `apps/web/src/world/demonstration.test.ts` — proof the UI never decides.
