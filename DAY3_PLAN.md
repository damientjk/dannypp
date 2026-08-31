# Day 3 — Final Day Run Sheet
### Volc Agent Launchpad · Middleware Track: Identity & Authorization

> **Read this before you start today.** This supersedes §5 "Day 3" of [TEAM_PLAN.md](TEAM_PLAN.md)
> for scheduling only — the architecture spine (§2), the role split (§3) and the hard rules (§1)
> are unchanged and still frozen. Async work until **17:00**, then everyone in one room.

**Monday 31 August** · in person **17:00** · main @ `44c1789` · `npm run check` green, 237 tests

---

## 1. The one thing that decides today

The backend does everything the brief asks for. One PDP, real capabilities, standing revocation,
attributed audit, real file reads behind the guard, and **237 passing tests** including named
negative cases for revoked, expired, over-scope, traversal and PDP-failure.

**The World view doesn't call any of it.**

| Seam | Where the decision is actually made |
|------|-------------------------------------|
| Room entry | `apps/web/src/world/decision.ts` — in-memory `Map`, no `fetch` |
| Approval queue | `apps/web/src/world/requests.ts` — module-level array; **no server endpoint exists** |
| Revoke | client-side, even though a tested real endpoint exists |
| Security log + blocked counter | derived from those browser decisions |

The only server calls the World makes are `login`, `listAgents` and `runs`.

> Step 7 of our own run of show is *"show the network tab: every animation was a real backend call,
> not a script."* Today that step disproves us. Closing it is the day's work — and it is a **wiring
> job, not a build**. Nothing below requires new backend capability.

This is hard rule 3 from §1: *"the cartoon must never be the thing that decides `permit`/`deny`."*
It guards the 40% of the score sitting in enforcement.

---

## 2. Before 17:00 — async, in parallel

Everything here is independent, so nobody blocks anybody. Push to a branch and open a PR.
**Don't merge your own** — that rule already caught one bad merge this week, where a self-merged PR
left `main` unusable end to end because nobody ran the app before merging.

### Person 1 — Identity core & contract · ~30 min

Two one-line server fixes, then the diagram.

- **Move `setErrorHandler` above the production static block** in `apps/server/src/app.ts`. It
  currently sits at line 224, *after* `await app.register(fastifyStatic, …)` at line 212 — awaiting
  that register freezes the route contexts with Fastify's default handler, so in production every
  API error returns a generic body and validation errors return **500 instead of 400**. Dev is
  unaffected, which is why nobody has seen it.
- **Fix the auth exemption** to `request.url.startsWith("/api/auth")`. It matches `/api/auth` by
  exact equality today, so `/api/auth/login` is gated behind the very token it exists to issue.
- **Finish the one-page architecture diagram** — it is a scored deliverable and still open.

**Done when:** a denied call in production shows the PDP's real reason, and the diagram is committed.

### Person 2 — PDP, PEP, audit · ~1 hr

Publish the endpoint the World will call.

Person 4 needs **one decision endpoint with a fixed request/response shape** to wire against. Define
it, write it down, and post it in the channel before 17:00 so wiring starts the moment we sit down.

It must carry the reason string through — the security log is only convincing if the denial explains
itself.

**Done when:** the shape is posted and a `curl` against a running server returns a real decision.

### Person 3 — Capabilities & resources · ~1 hr

Map the six rooms onto real resources.

The rooms are labels with no contents — a `FileRoom` is only
`{id, displayName, ownerId, requiresPermission, deskIds}`. Meanwhile the backend protects four real
files. They are disjoint sets:

```
on screen   Auth Module/  Billing/  Database/  Analytics/  Deploy Config/
on disk     user-a/secret-recipe.txt   user-a/notes.md
            user-b/tax-return.txt      user-b/notes.md
```

Decide the mapping from each room to a real `res://<ownerId>/<name>` URI. Owner IDs already match —
the rooms use `user-a`/`user-b`, the same principals the backend knows — so this is naming, not new
code. Either point the rooms at the existing files or seed resources matching the room names.

**Done when:** every room on screen names a URI the backend will actually accept.

### Person 4 — Frontend & visualization · ~2 hr

Land the branches, then stage the swap.

- **Merge `frontend-v1` and `amongst-us-package`** — ahead 51/behind 61 and ahead 4/behind 3
  respectively. This only gets more expensive.
- **Isolate the three seams** — room entry, approval, revoke — behind one async module, so at 17:00
  the swap is three call sites rather than a hunt.

**Done when:** branches are merged, `npm run check` is green, and the three seams live in one file.

### Person 5 — Verification, secrets & demo · ~1.5 hr

Make startup survive a cold machine.

Nothing loads `.env`, so the Ark credentials in it never reach the process — runs fail against Ark
unless the vars are passed inline. The obvious workaround is worse: `.env` sets `HOST=0.0.0.0` and a
`replace-` prefixed `APP_AUTH_TOKEN`, which with `NODE_ENV=production` trip the guard in
`config.ts:56-62` and the server refuses to start.

```bash
ARK_API_KEY=… ARK_MODEL=… npm run poc     # works
set -a; source .env; npm run poc          # throws on startup
```

Fix the script or document the single supported command — either way, write it down, because the
trap is silent. Then run the whole thing from a clean clone and **time it**; the first-run image
build takes minutes and we should know that number before a judge is watching.

**Done when:** someone who has never run this can start it from the README alone.

---

## 3. 17:00 — together, in this order

Ordered by dependency, not importance. The first block makes everything after it easier to debug,
because until Person 1's fix lands every production error reads as a generic "Unauthorized".

| Time | Duration | Block | Who |
|------|----------|-------|-----|
| **17:00** | 30 min | **Land everything, agree the shape.** Merge outstanding PRs, confirm `check` is green on main, walk through Person 2's endpoint and Person 3's mapping out loud. | Everyone — reviewer is never the author |
| **17:30** | 90 min | **Wire the visualization to the real PDP.** Swap all three seams to real calls. Verify the way a judge would: network tab open, a request firing for each door. | Person 4 driving, 2 and 3 beside them |
| **19:00** | 45 min | **Make the security log real.** Read the attributed audit trail instead of browser state. This is where the demo stops being a cartoon and becomes evidence. | Person 4 with Person 2 |
| **19:45** | 45 min | **Fix the first impression.** The app opens on a red "Unauthorized" banner (Dashboard has no login), and a refresh logs you out (session token isn't persisted). Both small, both the first thing anyone sees. | Person 4 with Person 1 |
| **20:30** | 60 min | **Two full dry runs, timed.** Whole run of show, under 3 minutes, on the projector. The second run is the one that counts. Rotate the narrator so nobody is a single point of failure. | Person 1 narrating |
| **21:30** | 30 min | **Freeze.** Final `check`, secret scan, README pass, deliverables ticked. After this, no commits except a demo-breaking fix — and that takes two people to call. | Person 5 calls it |

---

## 4. The run of show, honestly scored

Same seven steps from [TEAM_PLAN.md §6](TEAM_PLAN.md), marked with what actually happens today.
The backend can already serve every "browser" row — none need new capability, only connection.

| # | Step | Today | What it needs |
|---|------|-------|---------------|
| 1 | Log in as User A, show the Agent | **Real** | Nothing — genuine session, genuine agent list |
| 2 | Task runs, robot enters A's house, door opens | **Mixed** | Run is real; the door is decided in the browser |
| 3 | Robot tries B's house → blocked | **Browser** | The blessed proof, and our weakest step. **Highest priority** |
| 4 | Risky write hits an approval gate | **Browser** | No approval endpoint exists server-side at all — build or cut |
| 5 | Owner revokes, robot blocked again | **Browser** | A real revoke endpoint exists and is tested. Point the button at it |
| 6 | Open the security log, decisions attributed | **Browser** | Read the real audit trail instead of local state |
| 7 | Network tab — every animation was a real call | **Browser** | Falls out for free once 2, 3, 5, 6 are wired. **Don't offer it before then** |

---

## 5. Freeze checklist

- [ ] **3-minute live demo** — one real Agent run, normal case *and* denial/revocation case, rehearsed twice
- [ ] **One-page architecture diagram** — middleware, data flow, trust boundary, enforcement point
- [ ] **Repository** — setup instructions, problem & rationale, design summary, demo steps, limitations
- [ ] **Every animated decision traceable to a backend call** — the new one, and the one that decides the enforcement score
- [x] **`npm run check` passes** — 237 tests across both workspaces, typecheck and build clean
- [x] **No secrets anywhere** — `.env` untracked, nothing real in history, seed data deliberately fake, redaction module tested

---

## 6. Not doing today

- **New visual features.** Sprites, characters and map polish are done. Anything further is risk without score.
- **Refactors off the wiring path**, however tempting the code looks at 21:00.
- **The Jest-on-Node-26 issue** in the agent workspace demo — a host quirk, not our platform.
- **Rewriting the room model.** Map it to real URIs and move on.

---

## 7. Contingencies

**If we run out of time, cut step 4.** The approval gate is the only step needing a server capability
that doesn't exist yet, and the brief is satisfied by a normal case plus a denial and a revocation —
which steps 2, 3 and 5 already give us.

**If the deadline is tonight rather than tomorrow,** drop steps 4 and 6 and protect the 20:30 dry
runs. A rehearsed three-minute demo beats one more wired seam.

**If the wiring goes badly and we have to demo as-is,** do not offer the network tab, and describe
the visualization honestly as a view over the backend rather than claiming it decides anything.
`docs/demo/person3-evidence.sh` proves the real enforcement over HTTP in about twenty seconds and
needs no Ark key — that is our fallback proof, and it is a strong one.

---

## 8. What's already solid — don't touch it

- **237 tests pass** (167 server, 70 web) with typecheck and build clean; both workspaces run under `npm run check`.
- **Negative coverage is genuinely strong** — revocation changing execution, expired capabilities, over-scope, path traversal, unknown capability without leaking existence, PDP throwing, and PDP never returning.
- **Secrets hygiene is clean** — `.env` gitignored and untracked, no real credentials in history, seed resource content deliberately fake-looking, redaction module with its own tests.
- **Capabilities are real and revocable** — the day-one placeholder is gone from the tree entirely; every path goes through the registered store that makes revocation possible.
- **Resource reads hit the disk** — a permitted read genuinely reads a file and a denied one genuinely does not, and the store performs zero authorization of its own, so there is exactly one guard to point at.
