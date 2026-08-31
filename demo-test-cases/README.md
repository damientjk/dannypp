# The gate, demonstrated

An Agent walks up to a door. **With permission it goes through; without
permission it is stopped.** These scripts show that, over and over, against a
running server.

Every scenario is a **pair**: the same Agent, the same door, the same request —
and the only thing that changes between the two attempts is the permission. A
pair that comes back `BLOCKED` then `GOES IN` is the permission doing the work.
If both attempts matched, nothing would have been proven.

These are real HTTP requests to the control plane — the same calls the pixel
world makes when a robot walks up to a room. Nothing is stubbed and the browser
is not involved, which is the point: the animation is a picture of these
answers, not a substitute for them.

## Run it

```bash
npm run dev
```

```bash
./demo-test-cases/run-all.sh
```

That runs both parts, prints them, and writes `transcript.txt` next to these
scripts. It exits non-zero if the gate ever behaves differently than predicted.

Either part alone:

```bash
./demo-test-cases/01-the-gate.sh
```

```bash
./demo-test-cases/02-the-same-rule-for-agents.sh
```

**No Ark API key is needed.** The gate is decided before the model is ever
reached. On Windows, run these from Git Bash or WSL. Point elsewhere with
`BASE=http://host:port`.

## Reading the output

| Marker | Meaning |
|---|---|
| `GOES IN` | The Agent had permission and the door opened |
| `BLOCKED` | The Agent lacked permission and the **backend** refused it |
| `UNSEEN` | Something stayed hidden that should have — proven by reading the body, since a status code cannot show a secret stayed put |
| `REFUSED` | Turned away before any gate decision — no identity, bad input |
| `UNEXPECTED` | The gate did something other than predicted. **This is the failure worth catching.** |

`BLOCKED` asserts HTTP 403 specifically, not merely "an error". Being refused
and crashing are different outcomes, and a demo that blurs them proves nothing.

## Part 1 — `01-the-gate.sh` (a robot at a door)

| Scenario | Without permission | With permission |
|---|---|---|
| **1. The owner grants** | `BLOCKED` — `capability-unknown` | `GOES IN` — `permit`, and the file's real contents come back |
| **2. The owner revokes** | `BLOCKED` — `capability-revoked` | `GOES IN` — the same request, moments earlier |
| **3. Permission expires** | `BLOCKED` — `capability-expired` | — nobody had to intervene |
| **4. One keycard, one room** | `BLOCKED` at Billing — `out-of-scope` | `GOES IN` at Auth Module |
| **5. Somebody else's house** | `BLOCKED` at User B's door — `out-of-scope` | `GOES IN` at its own owner's door |
| **6. Walking around the gate** | `BLOCKED` / `REFUSED` — traversal, forged scope, revoking as a stranger | — |

Scenario 5 is the one the brief asks for: **User A's Agent cannot reach User B's
resource.** A third check confirms B's secret does not appear in the refusal.

The part closes by showing all of it in the audit trail — openings, refusals,
and the reason for each, attributed to the human the Agent acted for. The
Security Log in the world is a view of exactly that.

## Part 2 — `02-the-same-rule-for-agents.sh` (the same rule, different door)

An Agent is also something somebody owns, so the same question applies to it.
Each pair is one request sent twice — once by the owner, once by a stranger.

| Scenario | Owner (User A) | Non-owner (User B) |
|---|---|---|
| **1. Identity first** | `GOES IN` signed in | `REFUSED` with no identity or a forged token |
| **2. Six verbs** — look, rename, start, read the conversation, task, delete | `GOES IN` | `BLOCKED` — `not-owner`, every one |
| **3. Visibility** | It is in A's list | `UNSEEN` — absent from B's list, not merely unclickable |
| **4. The audit trail** | A sees A's decisions | `UNSEEN` — B's refusals never appear in A's log |
| **5. Where this stops** | `REFUSED` 503 — no model configured | — |

Scenario 5 states a real limit rather than hiding it: with `ARK_API_KEY` unset
there is no model, so no Agent can do work. Notice **where** it stops — every
permission check above it still worked, because the gate runs before the model
is ever reached. The middleware is demonstrable on a machine that could not run
an Agent at all. If Ark *is* configured, the script says so and skips it.

## What these scripts do not show

- **No Agent actually runs.** Proving Codex executes a task needs Ark
  credentials; that is a separate demo.
- **Codex's own file access is not policed by this gate.** An Agent's workspace
  reads and writes go through the OS under `CODEX_SANDBOX_MODE`; the real
  containment there is the container's bind mounts.
- **The browser is not exercised here.** That the world only *relays* these
  decisions is proven by `apps/web/src/world/demonstration.test.ts`, which walks
  up to every gated room and asserts each one produced a backend request.

## Related

- `docs/demo/` — earlier evidence scripts, same spirit
- `apps/server/src/demonstration.test.ts` — the same scenarios as automated tests
- `apps/web/src/world/demonstration.test.ts` — proof the UI never decides
