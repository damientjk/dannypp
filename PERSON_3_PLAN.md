# Person 3 — Capabilities, Revocation & Protected Resources

> My slice of the Middleware Track (Identity & Authorization). This is my working plan;
> §2 is the part the rest of the team depends on and must be published on Day 1.

---

## 0. Ground truth as of start (verified, not assumed)

| Fact | Status |
|---|---|
| `npm install && npm run typecheck` on `main` | **passes** (Node 26, npm 11) |
| Docker daemon | **up** — container runtime path is available to me |
| Person 1's contract | **already pushed** to `origin/auth-contract`, *not* on `main` |
| `policy/pdp.ts` | a **stub that permits everything** — Person 2 has not started |
| `Capability` type | **frozen**: `{ id, scope, expiresAt, revokedAt }` |
| `Agent.ownerId` | added on `auth-contract`; `createAgent` requires it |
| Session auth | `POST /api/auth/login` → `x-session-token` header; users `user-a`/`demo-a`, `user-b`/`demo-b` |

**Two things to raise with Person 1 immediately:**
1. `origin/auth-contract` **deletes `TEAM_PLAN.md`** (296 lines removed). Almost certainly an
   accidental drop during the upload commit. Ask before it merges.
2. `AuthContext.capability` is missing a semicolon in `types.ts` — cosmetic, but it means the file
   was hand-edited without a formatter run. Worth a nudge since it's the shared file.

**Branching:** everything I do starts from `origin/auth-contract`, never `main`.
```bash
git fetch origin
git checkout -b person3/capabilities origin/auth-contract
```

---

## 1. What I own, stated as one sentence

> I own the **keycard**: who gets one, what it opens, when it stops working, and the **houses** it
> opens — plus the guarantee that the Ark API key never leaves the backend.

I do **not** own the decision. Person 2's PDP makes the `permit`/`deny` call. I supply the two
inputs it needs (is this keycard still valid? who owns this house?) and the one place the answer
becomes visible to a human (revoke).

**Design rule I hold myself to:** `ResourceStore` performs **zero** authorization. It is the thing
*behind* the guard. If it ever checks a principal, the trust boundary has blurred and we lose
points on "Technical design & integration" (25%).

---

## 2. THE CONTRACT I PUBLISH ON DAY 1 (Person 2 is blocked on this)

Post this to the team chat within the first 3 hours. Nothing below requires a change to
`types.ts` — **I can build my entire slice without another shared-type PR.** That is deliberate.

### 2a. Scope grammar

```
scope   := "<actions>:<pattern>"
actions := comma-separated, subset of { read, write }
pattern := "res://<ownerId>/<glob>"      // glob = literal name, or trailing *
```

Examples:
- `read:res://user-a/*` — read anything of User A's (the normal run capability)
- `read,write:res://user-a/notes.md` — a single writable file (drives the approval-gate demo)

### 2b. The single canonical matcher — Person 2 imports this, never re-implements it

```ts
// apps/server/src/capability/scope.ts
export function scopeAllows(scope: string, action: string, resource: string): boolean;
```

If enforcement logic exists in two places it will disagree by Day 3. One function, one owner.

### 2c. Capability store API

```ts
// apps/server/src/capability/store.ts
export interface CapabilityRecord extends Capability {  // Capability is Person 1's frozen type
  agentId: string;
  ownerId: string;
  runId: string | null;
  issuedAt: string;
  revokedBy: string | null;
}

export type CapabilityValidation =
  | { valid: true;  capability: CapabilityRecord }
  | { valid: false; reason: "unknown" | "revoked" | "expired" };

issue(input: { agentPrincipal, scope, runId, ttlMs? }): CapabilityRecord   // default ttl 5 min
issueForRun(agent: Agent, runId: string): CapabilityRecord                 // Person 2 calls this
get(id: string): CapabilityRecord | null
list(filter?: { ownerId?: string; agentId?: string }): CapabilityRecord[]
revoke(id: string, revokedBy: string): CapabilityRecord | null
validate(id: string, at?: Date): CapabilityValidation
```

### 2d. Frozen denial reason strings

These land verbatim in the audit log and on Person 4's screen. Changing them later breaks
Person 5's assertions and Person 4's copy.

| Reason string | Cause |
|---|---|
| `capability-unknown` | no such capability id |
| `capability-revoked` | owner shredded the keycard |
| `capability-expired` | past `expiresAt` |
| `out-of-scope` | resource outside the capability's pattern (**the A-can't-read-B proof**) |
| `action-not-in-scope` | write attempted with a read-only capability |
| `resource-unknown` | malformed or non-existent resource URI |
| `policy-error` | PDP itself threw → **default-deny** |

### 2e. Resource store API

```ts
// apps/server/src/resources/store.ts
export interface ResourceRef { uri: string; ownerId: string; name: string }

class ResourceStore {
  initialize(): Promise<void>            // creates + seeds the two users' namespaces
  parse(uri: string): ResourceRef | null // null on malformed / traversal / unknown owner
  ownerOf(uri: string): string | null
  list(ownerId?: string): ResourceRef[]
  read(uri: string): Promise<string>
  write(uri: string, content: string): Promise<void>
}
```

Backed by **real files** under `${APP_DATA_DIR}/resources/<ownerId>/`, seeded on first boot:

```
user-a/  secret-recipe.txt   "SECRET-RECIPE-42: three parts cocoa, one part nonsense"
         notes.md
user-b/  tax-return.txt      "SECRET-TAX-99: refund $1,337"
         notes.md
```

Seeds are **obviously fake** so screenshots and demo output are safe to publish (deliverable §9:
"no secret in ... screenshots or demo output").

---

## 3. Build order — file by file

```
apps/server/src/
  capability/
    scope.ts         # scopeAllows + parseScope           (pure, no deps — build FIRST)
    scope.test.ts
    store.ts         # issue / validate / revoke / list    (in-memory Map, mirrors auth/session.ts)
    store.test.ts
    routes.ts        # Fastify plugin: GET /api/capabilities, POST /api/capabilities/:id/revoke
  resources/
    store.ts         # ResourceStore + seeding
    store.test.ts
    staging.ts       # stageResource / clearStaging at the runner boundary
    routes.ts        # Fastify plugin: GET /api/resources, GET /api/resources/content
  secrets/
    redact.ts        # redact(text, secrets) -> string
    redact.test.ts
```

**Why Fastify plugins and not edits to `app.ts`:** `app.ts` is Person 1's file and the single
worst merge-conflict surface in the repo. Two plugin registrations is a **2-line diff** for them
to accept instead of a 60-line one.

### 3.1 Persistence decision — in-memory, not the JSON store

Capabilities live in a `Map`, exactly like Person 1's `auth/session.ts`. Rationale:
- The `Database` type is frozen at `version: 1` with `agents | messages | runs`. Adding
  `capabilities` means a shared-type PR, a version bump, and a migration path — three days is not
  the time for that.
- Sessions are already in-memory, so after a restart nobody is logged in anyway; a surviving
  capability with no session is meaningless.

**I document this as a stated limitation in the README** rather than letting a judge find it.
If Day 3 has slack, a `${APP_DATA_DIR}/capabilities.json` sidecar written at `mode: 0o600` (same
pattern as `JsonStore.persist`) is a 30-minute add — but it is the *last* thing on the list.

### 3.2 The data path — how an agent *actually* touches a resource

This is the part that makes the middleware "really run" (the 40%). The sandboxed Codex container
only has its own workspace bind-mounted, so it cannot reach another user's files by construction —
which means an unguarded demo would prove nothing. So:

**Primary (build this): capability-gated materialization at the runner boundary.**

1. A run carries an explicit `resourceUri` field — **parsed from a request field, never from the
   prompt prose.** (Prose-parsing is an injection hole and a judge will ask.)
2. Before `runner.run(...)`, the PEP calls `pdp.decide({ principal: agentPrincipal, action: "read",
   resource: uri, capability, requestId })`.
3. On `permit` → `stageResource()` copies the file into `<workspace>/inbox/<name>`. The model
   genuinely reads it and its answer depends on the contents.
4. On `deny` → nothing is staged, the run fails with the reason string, the audit entry is written.
5. `clearStaging()` wipes `<workspace>/inbox/` after every run so a permit never leaves residue
   that fakes a later permit.

Step 5 matters more than it looks: **without it, "execution changes after revocation" is a lie** —
the agent would still see yesterday's staged copy and answer correctly after the keycard is shredded.
That failure would be caught on stage, not in a test. This is my single highest-risk detail.

**Stretch (only if Day 2 finishes early): a live tool endpoint.** `POST /api/resources/read` that
the agent curls from inside the container mid-run, carrying its capability id. More impressive
(enforcement fires *during* the run, not before it), but it needs container→host networking to
work reliably under `--network bridge`. Not worth risking the demo for.

### 3.3 Path traversal — the bug that would silently kill our whole demo

```
res://user-a/../user-b/tax-return.txt
```

A naive `uri.split("/")` treats the owner as `user-a`, passes the scope check, and then reads
**User B's file**. Our headline claim collapses and the judges' one blessed test fails live.

`parse()` must reject, before any filesystem call: `..` in any segment, absolute paths, leading
`/`, backslashes, null bytes, URL-encoded `%2e%2e`, and any owner not in the known user set. Then
resolve the final path and assert it is still inside that owner's directory. **Test this on Day 1**,
not Day 3.

---

## 4. Ark credential hygiene (my responsibility, item 6 of the non-negotiables)

Current state, traced through the code:

- `codex-runner.ts:259` and `container-codex-runner.ts:240` put the key in the **child env**, not argv.
- `container-codex-runner.ts:72` passes `--env ARK_API_KEY` — **name only**, value inherited. Correct:
  the key never appears in the docker command line or in `ps` output.
- `container-codex-runner.test.ts` already asserts `"secret-that-must-not-appear-in-argv"` is absent.
- `.env`, `.env.production`, `.data/`, `.local/`, `*.log` are all gitignored.
- `/api/system` returns `arkConfigured: boolean` + `arkModel` — no key. Clean.

**So the inbound path is already safe. The gap is outbound:** nothing stops the *model* from echoing
the key into `run.output`, which we then persist to disk and render in the browser. `workspace.ts`
writes "Never print environment variables or credentials" into `AGENTS.md` — that is a *polite request
to an LLM*, not a control.

My additions:
1. `secrets/redact.ts` — `redact(text, [config.arkApiKey, config.authToken].filter(s => s.length > 8))`
   → `***REDACTED***`. Guard the length so an empty key doesn't redact every character.
2. Apply at the persistence boundary in `agent-service.ts`: `run.output`, `run.error`,
   `agent.lastError`, and every audit payload. One choke point, not scattered.
3. Test: a fake runner that returns the configured key in its output → assert the persisted run and
   the API response both contain `***REDACTED***` and not the key.
4. A `git log -p -S` sweep over history plus a grep of seeded resources and workspaces before submit.

**Note on your run command:** you're using
`ARK_BASE_URL=https://ark.ap-southeast.bytepluses.com/api/v3` — that overrides the
`config.ts` default of `ark.cn-beijing.volces.com`. It flows through correctly (`writeCodexConfig`
bakes `arkBaseUrl` into `codex-home/config.toml`), and `start-local-poc.sh` runs the server in your
shell so the export is inherited. **But the script only validates `ARK_API_KEY` and `ARK_MODEL`** —
forget `ARK_BASE_URL` on one invocation and it silently falls back to Beijing and 401s. Worth
putting all three in `.env` instead of the command line, which also keeps the key out of your shell
history — a real consideration given rule 6.

---

## 5. Tests I own

Person 5 owns the suite; these are mine because they need my internals.

| Test | Asserts |
|---|---|
| `issue()` | `expiresAt` in the future, `revokedAt` null, id is a uuid |
| `validate()` happy | `{ valid: true }` |
| `validate()` after revoke | `reason: "capability-revoked"` |
| `validate()` after expiry | `reason: "capability-expired"` (use `ttlMs: -1`, no fake timers needed) |
| `validate()` unknown id | `reason: "capability-unknown"` |
| `scopeAllows` same-owner read | `true` |
| `scopeAllows` cross-owner | `false` ← **the blessed proof, at unit level** |
| `scopeAllows` write on read-only scope | `false` |
| `parse()` traversal set | all `null` (see §3.3 for the list) |
| revoke route, non-owner | `403` ← revoke is itself an authorization decision |
| staging cleared after run | `<workspace>/inbox/` empty |
| redaction | key absent from persisted output and API response |

I also hand Person 5 two fixtures they can't easily build themselves:
- a **throwing capability store**, so they can prove `policy-error → deny` (default-deny);
- `ttlMs` on `issue()`, so the expiry test needs no clock mocking.

---

## 6. Schedule

### Day 1 — publish the contract, build the pure modules
Ordered so I am **never blocked on Person 2** and Person 2 is **unblocked by me within 3 hours**.

- **H0** — `npm ci`; `npm run check`; one `npm run poc` with a real Ark key. Confirm the baseline
  works *before* touching it, so any later breakage is provably mine.
- **H1** — branch off `origin/auth-contract`. Raise the two `auth-contract` issues from §0.
- **H2–H3** — **publish §2 to the team.** Highest-leverage 90 minutes of my three days.
- **H4–H6** — `capability/scope.ts` + `store.ts` + tests. Pure functions, zero dependencies.
- **H7** — `resources/store.ts` + seeding + the traversal test set.
- **Exit evidence:** `npx vitest run capability resources` green; contract message posted; baseline
  still passes.

### Day 2 — wire into the real backend
- **AM** — the two Fastify plugins; small PR to Person 1.
- **Midday** — pair with Person 2 on the `stageResource` call site. **Book this explicitly** — it is
  our one hard dependency and it will slip if left to chance.
- **PM** — revocation end-to-end; `secrets/redact.ts` + tests.
- **Exit evidence:** `docs/demo/person3-evidence.sh` — a curl script doing
  login → run against A (permit) → run against B (deny) → revoke → run against A (deny),
  with the run outputs saved. **This is my "execution changes after revocation" artifact**, and it
  exists independently of whether the frontend is ready.

### Day 3 — harden and document
- Default-deny path: capability store throws → PDP denies. Test it.
- **Decide and document in-flight revocation:** a keycard shredded *during* a long run. My call —
  deny at the *next* access, do not retro-kill a run in progress. Cheap to defend ("revocation is
  enforced at the decision point, and every access is a decision point"), and killing mid-run risks
  a corrupted workspace. Written into the limitations section so it reads as a design choice, not
  an oversight.
- Limitations: in-memory store, mock users, capabilities are opaque ids not signed tokens.
- Support Person 4 (keycard panel shape) and Person 5 (negative tests).

---

## 7. Handshakes — what I need, and from whom

| With | Ask |
|---|---|
| **Person 1** | Merge two Fastify plugins into `app.ts` (2-line diff). Confirm the `TEAM_PLAN.md` deletion is accidental. **I need no change to `types.ts`** — say so up front so they don't hold a slot for me. |
| **Person 2** | Import `scopeAllows` and `capabilityStore.validate`; do **not** re-implement scope matching. Call `issueForRun(agent, runId)` in `sendMessage`. Deny reason strings come from §2d. Book the Day-2 midday pairing slot. |
| **Person 4** | Keycard panel ← `GET /api/capabilities?agentId=`. Shred button → `POST /api/capabilities/:id/revoke`, which **returns the updated record** so the UI re-renders without a re-fetch (one less race on stage). |
| **Person 5** | Throwing-store fixture and `ttlMs` are ready for you on Day 1; the four negative tests can be written against §2 before my code exists. |

---

## 8. My risks, ranked

1. **Staging not cleared between runs** (§3.2 step 5) → the post-revocation run still succeeds and
   our headline moment dies on stage. *Mitigation: assert on an empty `inbox/` in a test, Day 2.*
2. **Path traversal in `parse()`** (§3.3) → cross-user isolation is bypassable and the blessed proof
   is false. *Mitigation: the traversal test set on Day 1.*
3. **Person 2 re-implements scope matching** because my contract landed late → two enforcement paths
   that disagree by Day 3. *Mitigation: §2 published by H3, not H8.*
4. **The key leaks through model output** (§4) → fails a non-negotiable regardless of everything
   else. *Mitigation: redact at the persistence choke point, plus a history sweep before submit.*
5. **Ark base URL forgotten on a run** → confusing 401s eat an hour. *Mitigation: put all three Ark
   vars in `.env`.*

---

## 9. Next 60 minutes

```bash
cd ~/dannypp
git fetch origin
git checkout -b person3/capabilities origin/auth-contract
npm ci && npm run check                      # confirm green BEFORE touching anything
cp .env.example .env                         # add ARK_API_KEY, ARK_MODEL, ARK_BASE_URL
```
Then: read `types.ts`, `agent-service.ts:150-210` (`sendMessage`), and `auth/session.ts` — that last
one is the exact shape my capability store should mirror. Then post §2 to the team.
