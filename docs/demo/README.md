# Demo evidence

Scripts that prove the middleware really executes in the backend, by making
real HTTP requests to a running control plane. Nothing here is stubbed, and
none of it involves the browser — that is the point. If a judge asks *"is the
animation deciding this, or is the server?"*, this directory is the answer.

## Run it

Start the backend, then run everything:

```bash
npm run dev
```

```bash
./docs/demo/run-evidence.sh
```

That writes a plain-text transcript to `docs/demo/evidence-transcript.txt` and
exits non-zero if any assertion fails. Pass a different origin as the first
argument (`./docs/demo/run-evidence.sh http://localhost:3000`) when the server
is elsewhere.

**No Ark API key is required.** Every authorization decision is made before the
model is ever called, so the middleware path runs fully without credentials.

On Windows, run these from Git Bash or WSL.

## What each script proves

### `person3-evidence.sh` — protected resources (12 assertions)

The capability half of the spine: an agent acts under its own scoped,
time-bound, revocable keycard rather than borrowing its owner's session.

| Case | Expected |
|---|---|
| A's agent reads A's resource | `permit` — `capability-in-scope` |
| **A's agent reads B's resource** | **`deny` — `out-of-scope`** ← the blessed proof |
| `res://user-a/../user-b/...` traversal | `deny` — `resource-unknown` |
| B tries to revoke A's keycard | `403` — revocation is itself authorized |
| Owner revokes, identical read repeated | `deny` — `capability-revoked` |
| Expired keycard | `deny` — `capability-expired` |
| Minting a keycard scoped to B's namespace | `400` — refused at issue time |
| A reads B's resource as a human | `deny` — `out-of-scope` |

### `agent-isolation-evidence.sh` — Agent objects and the audit trail (21 assertions)

The PEP half: ownership isolation on the Agent lifecycle, and an audit log that
records **denials**, not just successes.

| Case | Expected |
|---|---|
| No session / bogus token | `401` |
| A creates an Agent | stamped `ownerId: user-a` |
| B lists agents | A's agent is **absent**, not merely unclickable |
| B reads / renames / starts / stops / tasks / deletes A's Agent | `403 not-owner` on all seven verbs |
| B's audit log | contains the denial, `reason: not-owner`, `humanId: user-b`, naming `agent:user-a:<id>` |
| A's audit log | contains **none** of B's decisions |
| A acts on their own Agent | permitted, and the workspace is archived on delete |

The script creates its own Agent and deletes it on exit (via a `trap`), so it
leaves no state behind and is safe to run repeatedly.

## What these scripts do NOT prove

Being straight about the gap, because a judge will find it:

- **The world UI does not call any of this.** `apps/web/src/world/decision.ts`
  evaluates permit/deny in the browser against an in-memory `Map`. The Security
  Log panel renders local events, not `GET /api/audit`. Until that is swapped
  for a real `fetch`, the animation is a mock sitting beside a working backend —
  which TEAM_PLAN rule 3 explicitly forbids.
- **Resource decisions are not audited.** The only `audit.append()` call in the
  server is the Agent PEP, so the permits and denials in `person3-evidence.sh`
  appear nowhere in `/api/audit`.
- **No model run happens here.** Proving Codex actually executes a task needs
  `ARK_API_KEY` and `ARK_MODEL`; that is a separate demo.
