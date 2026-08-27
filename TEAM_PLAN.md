# Volc Agent Launchpad — Team Plan
### Middleware Track: Identity & Authorization

> **Read this first, then keep it open.** This is our single source of truth for what we're
> building, who owns what, and what "done" looks like each day. If something here is unclear,
> raise it *before* you start coding — a fuzzy contract is what causes merge hell on Day 3.

---

## 1. What this project actually is

We are given a **working AI Agent platform** (the "Starter Kit" / *Volc Agent Launchpad*). It already
provides everything that would normally eat a whole hackathon:

- A React web UI (Agent list, Create/Edit forms, lifecycle controls, Playground, Run status)
- A Fastify control-plane API (validation, async Runs, `AgentService`, JSON persistence)
- An Agent Runtime (Codex CLI, persistent per-Agent workspaces, disposable containers)
- Model connection to the Volcengine **Ark** Responses API
- Local (Docker/Colima/Podman) and optional cloud (ECS) execution

**We are not rebuilding any of that.** The Starter Kit deliberately ships with **no middleware** —
no user identity, no authorization, no audit. Our job is to build **one coherent piece of
middleware** that makes the platform more secure and manageable, in a way that **really executes in
the backend** (not just a pretty screen), with **tests** and a **convincing demo**.

**Our chosen direction: Identity & Authorization.**
We picked this because its failure case is *binary* — an access was either blocked or it wasn't —
which is exactly what judges can verify, and because the brief explicitly blesses a demo for it:
*prove that an Agent owned by User A cannot read User B's resource.*

**Our presentation angle: an interactive "house break-in" visualization** (robots, houses, keycards,
a guard) that makes the security story vivid on stage — built strictly as a *skin over real backend
decisions* (see §2 and the frontend role in §3).

### The hard rules (from the brief — non-negotiable)

1. **Don't break the baseline.** Agent CRUD, lifecycle, Playground chat, persistence, and model
   execution must keep working.
2. **The middleware must really run** in a backend / Runtime / data path. A static screen or a
   hard-coded "Success!" does **not** count.
3. **Enforce at the backend, never the UI.** A login screen or a hidden button with no server-side
   check does *not* demonstrate the middleware. **This applies doubly to our animated UI — the
   cartoon must never be the thing that decides `permit`/`deny`.**
4. **Show evidence** of both the normal case *and* a failure / denial / revocation case.
5. **Automated tests** for the core behavior — especially the negative (denial) tests.
6. **No secrets** committed anywhere: source, git history, logs, traces, screenshots, demo output.
7. `npm run check` must pass.

---

## 2. The architecture "spine" — agree on this Day 1, then FREEZE it

Everything we build hangs off one story:

> A **human principal** logs in and **owns** an Agent. When that Agent runs, it acts under its **own
> agent principal** plus a **scoped, time-bound, revocable capability** — *not* the human's session.
> Every access to a protected resource flows through a single backend **Policy Decision Point (PDP)**,
> called from **Policy Enforcement Points (PEPs)** at the service / runtime boundary. Every decision
> is **attributed** in an audit log. A human can **revoke** a capability and the next run gets denied.

### The one object that flows through everything: `AuthContext`

```
AuthContext {
  humanPrincipal   // who owns / initiated this
  agentPrincipal   // the agent's own identity (NOT the human's session)
  capability {
    scope          // what this agent may touch (e.g. owner's resource namespace)
    expiresAt      // time-bound
  }
  requestId        // correlate the decision in the audit log
}
```

### The one decision call every protected operation makes

```
PDP.decide({ principal, action, resource })  ->  { permit | deny, reason }
```

**Ownership isolation is just one policy rule:** an agent's capability scope is bound to its owner's
resource namespace, so User A's agent asking for User B's resource returns `deny`.

### The theme, mapped onto the real architecture

The "house break-in" visuals are a *direct metaphor* for the spine — not decoration bolted on:

| On screen (frontend) | Real thing (backend) |
|----------------------|----------------------|
| The house | A user's protected resource namespace (A's house, B's house) |
| The robot | The agent principal |
| The keycard | The scoped, time-bound capability |
| The guard at the door | The **PDP** (`decide()`) |
| Door opens, green | A real `permit` response |
| Alarm, bounced off, red | A real `deny` response (the A-can't-read-B proof) |
| Owner shreds the keycard | **Revocation** |
| The security log panel | The **audit log** |

**Freezing this contract at the end of Day 1 is the single most important thing in this plan.**
If `AuthContext` or the `decide()` signature changes on Day 2 or 3, it breaks all five of us at once.
All changes to shared types go through **one owner** (Person 1) via PR review.

### Where the code lives (keeps us out of each other's files)

Most work goes into **new, separate modules** so the only shared files are `types.ts` and `app.ts`:

```
apps/server/src/
  types.ts            <- shared (Person 1 owns changes)
  app.ts              <- shared (Person 1 owns changes)
  agent-service.ts    <- PEP hooks (Person 2)
  auth/               <- identity, login/session, principals       (Person 1)
  policy/             <- PDP decision service + PEP helpers          (Person 2)
  audit/              <- decision log (Person 2 writes, shared read) (Person 2)
  capability/         <- issue / scope / expire / revoke             (Person 3)
  resources/          <- mock protected resources for A and B        (Person 3)
apps/web/src/
  App.tsx             <- app shell + wiring         (Person 4)
  viz/                <- the interactive house/keycard/guard scene   (Person 4)
```

---

## 3. Who does what — the 5-person split

We have five members. **One member cannot use macOS** — they take the **frontend** role, which
depends least on the containerized runtime, and they set up **WSL2** so they're never blocked (see §4).

| # | Role | Machine | Owns (files/modules) | Core responsibility |
|---|------|---------|----------------------|---------------------|
| **1** | **Lead / Identity core & contract** | Mac/Linux | `types.ts`, `auth/`, session middleware in `app.ts`, architecture diagram | Human vs Agent `Principal` model, mock user store, login/session, **owns the `AuthContext` contract and all shared-type PRs**, draws the one-page diagram, drives the demo. |
| **2** | **Policy engine (PDP) + enforcement (PEP) + audit** | Mac/Linux | `policy/`, PEP hooks in `agent-service.ts` and the `AgentRunner` boundary, `audit/` | Builds `decide({principal,action,resource})`, wires enforcement into the backend boundary, implements ownership-isolation, writes attributed audit entries. **Heart of the 40% score.** |
| **3** | **Capabilities, revocation + protected resources** | Mac/Linux | `capability/`, `resources/` | Issues scoped, time-bound capabilities on run start; builds **revocation**; keeps the Ark credential backend-side + redacted; builds the two-user mock resource store that isolation is proven against. Owns the "execution changes after revocation" evidence. |
| **4** | **Frontend / interactive visualization** *(the non-Mac member)* | **Windows + WSL2** | `apps/web/src/viz/`, `App.tsx` | Builds the house/keycard/guard scene: user switcher, a run that animates door-opens (permit), break-in-blocked (deny), keycard-shred (revoke), and a live security-log panel. **Every animation is triggered by a real backend response — the UI never decides `permit`/`deny`.** |
| **5** | **Verification, secrets hygiene & demo** | Mac/Linux or WSL2 | test suite, fixtures, README, startup, demo script | The **negative tests** (A-can't-read-B, revoked-denied, expired-denied, over-scope-denied), mock fixtures, "no secret anywhere" scan, README, one-command startup, keeps `npm run check` green, rehearses the 3-min demo. **Tests + reproducibility = 35% combined.** |

> **Assign Person 1 and Person 2 to your strongest engineers** — everyone depends on Person 1's
> contract, and Person 2's PDP is where most of the score lives.
>
> **Frontend-heavy warning:** the animated scene is *more* work than a plain evidence UI. If it starts
> eating into the backend, the fallback is to have **Person 5 pair with Person 4** on the visualization
> once the core tests are written, since Person 5's work is lightest early. Do **not** pull anyone off
> Person 2's enforcement path — that is the 40%.

---

## 4. Setup note for the non-Mac member (Person 4)

The baseline runtime needs macOS or Linux + a container engine, so a Windows machine can't run it
natively. Fix it with **WSL2**, which makes the machine behave like Linux for this project:

1. In an elevated PowerShell: `wsl --install` (installs WSL2 + Ubuntu), then reboot.
2. Install **VS Code** + the **Remote - WSL** extension; open the repo *inside* WSL (`code .` from the
   Ubuntu shell).
3. Inside Ubuntu: install Node 22+ (via `nvm`) and a container engine (Docker Desktop with the WSL2
   backend, or rootless Podman).
4. Run everything from the Ubuntu shell — the inline `KEY=value npm run poc` syntax needs bash/zsh,
   which WSL provides (it does **not** work in PowerShell).

Frontend dev also runs fine here: `npm run dev` serves the Vite web UI on **:5173** and can point at a
teammate's running backend on **:3000**, so Person 4 can build the visualization even before the full
stack is green locally.

---

## 5. Full 3-day timeline

### Day 1 — Design serially, then diverge
**Goal:** the baseline passes and we can trigger **one real authorization decision** from an API or test.

- **Whole team (morning):** at a whiteboard, lock the exact scope, the `AuthContext` shape, and the
  `decide()` signature. Confirm the two headline bullets (recommended: **ownership isolation + revocation**).
- **Person 1:** ship the identity core — `Principal` model, mock user store, login/session — plus a
  **stub PDP** so everyone has something to import by end of day.
- **Person 2:** get **one real `deny`** working end-to-end, even with a hardcoded scope.
- **Person 3:** scaffold `capability/` and the two-user `resources/` store against the frozen contract.
- **Person 4:** WSL2 set up; build the static scene (houses, robot, guard, log panel) with **fake
  data** wired to a `permit`/`deny` prop, so swapping in the real API later is trivial.
- **Person 5:** start writing tests **against the contract, not the finished code** — never blocked.

**Exit evidence:** baseline still passes (`npm run poc` acceptance test), and one authorization decision
fires from an API call or test.  **FREEZE the contract tonight.**

### Day 2 — Parallel backend + wire up the visualization
**Goal:** the complete scenario works end-to-end, browser → backend, with the scene animating real decisions.

- **Person 2:** finish the PDP + real PEP hooks at the service/runtime boundary; write audit entries.
- **Person 3:** finish capability issuance + **revocation**; confirm the Ark key stays backend-side and redacted.
- **Person 4:** replace the fake data with **real API calls**; each door-open / break-in-blocked /
  keycard-shred animation now fires off an actual backend response; the log panel reads the real audit log.
- **Person 5:** fill in tests as each path lands; draft the README.

**Exit evidence:** log in as A → agent reads A's resource (door opens) → agent tries B's resource
(break-in blocked) → revoke (keycard shredded) → denied again — all from the browser, all backed by
real backend decisions.

### Day 3 — Harden, test, rehearse
**Goal:** `npm run check` is green and the demo fits in 3 minutes.

- **Person 5:** finalize the negative tests + secret scan; get `npm run check` green.
- **Person 1:** finish the one-page architecture diagram; rehearse the demo to **under 3 minutes**.
- **Persons 2–3:** fix bugs, handle failure paths cleanly (**if the PDP itself errors → default-deny**), clean up.
- **Person 4:** polish timing/readability of the animation so the deny + revoke moments are unmistakable
  on a projector; make sure the network tab (real calls) is easy to show if a judge asks.
- **Whole team (evening):** dry-run the demo twice, then **freeze the code**.

**Exit evidence:** `npm run check` passes; full demo rehearsed and timed.

---

## 6. The live demo — run of show (this is what wins)

One continuous scenario, under 3 minutes, told through the visualization:

1. **Log in as User A**; show the Agent and its current lifecycle state.
2. Run a task; the robot walks to **A's house**, guard checks the keycard, **door opens** — a real
   `permit` (and a real file/tool action underneath).
3. The robot tries **User B's house** → **guard blocks it, alarm** → **denied at the backend**. *(the blessed proof)*
4. A risky write triggers an **approval gate**; the human approves it.
5. The owner **shreds the keycard (revoke)**; the robot tries again → **still blocked**. *(revocation case)*
6. Open the **security log** — each decision attributed to human + agent + scope + result.
7. *(If asked)* show the network tab: every animation was a real backend call, not a script.

This single flow hits every scored requirement: a real action, the middleware behavior **plus** the
evidence it produces, and a denial/revocation case.

---

## 7. Risks to actively guard against

- **The animation becomes the middleware.** A cartoon that decides in JavaScript scores **zero** on
  the 40%. → Person 4: the scene only *renders* backend responses; keep it obvious (be ready to show
  the real network call behind each door).
- **Frontend eats the backend's time.** The scene is the flashy part, but enforcement is the scored
  part. → If the viz slips, Person 5 pairs in; never pull from Person 2.
- **Contract drift.** If `AuthContext` / `decide()` changes late, it breaks everyone.
  → Freeze end of Day 1; route all shared-type changes through Person 1.
- **Negative tests that only check the UI.** Asserting on the animation ≠ proving isolation.
  → Person 5: tests hit the backend and assert on the *decision*, not the screen.
- **Secrets leaking.** Any key in source/history/logs/traces fails the checklist.
  → Person 5 owns a scan; pass credentials via env/`.env` (gitignored), never inline in committed code.
- **PDP failure mode undefined.** If the decision service errors, what happens? → **Default-deny.** Test it.

---

## 8. How this maps to the evaluation criteria

| Category | Weight | How we cover it |
|----------|--------|-----------------|
| End-to-end middleware behavior | **40%** | Real PDP/PEP decisions at the backend boundary; browser-to-backend denial + revocation, each animation backed by a real call. |
| Technical design & integration | **25%** | One coherent `AuthContext` spine, clean PDP/PEP separation, focused modules, extensible `decide()` contract. |
| Verification & robustness | **20%** | Negative tests (isolation, revocation, expiry, over-scope), default-deny on PDP error, secret scan. |
| Demo & reproducibility | **15%** | 3-min rehearsed visual demo, README, one-command startup (`npm run poc`), documented limitations. |

---

## 9. Deliverables checklist (from the brief)

- [ ] **3-minute live demo** — one real Agent Run + our middleware in a normal case *and* a
      denial/revocation case.
- [ ] **One-page architecture diagram** — middleware, data flow, trust boundary, enforcement point.
- [ ] **Code repository** — setup instructions, the middleware problem & rationale, design summary,
      automated tests, demo steps, limitations, **and no secrets**.
- [ ] `npm run check` passes.
- [ ] No secret in source, git history, logs, traces, screenshots, or demo output.

---

## 10. Reference: baseline commands & entry points

```bash
# Recommended judging path (containerized). First run is slow (builds the runtime image).
ARK_API_KEY=your-ark-api-key ARK_MODEL=ep-your-endpoint-id npm run poc
# open http://localhost:3000

# Faster dev loop (hot reload; needs Codex CLI on host). Web UI :5173, API :3000
npm install
cp .env.example .env         # fill in ARK_API_KEY and ARK_MODEL
npm install --global @openai/codex@0.111.0
npm run dev

# Validation (must pass before submitting)
npm run check
```

- `ARK_API_KEY` must be an **Ark model API key**, not a BytePlus account AK/SK. `ARK_MODEL` is an
  endpoint ID starting with `ep-`. A wrong credential returns **401 Unauthorized**.
- Local state persists between runs — macOS: `~/.volc-agent-launchpad/`, Linux (incl. WSL2): `.local/`.
- **Start reading the code here:** `apps/server/src/types.ts`, `app.ts`, `agent-service.ts`, the two
  `AgentRunner` implementations, then `apps/web/src/App.tsx`.

---

*Do not start middleware work until the baseline acceptance test passes. Freeze the `AuthContext`
contract at the end of Day 1. Enforce at the backend, prove it with a negative test, keep the
animation a skin over real decisions, and keep secrets out of everything.*
