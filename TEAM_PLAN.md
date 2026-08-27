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

### The hard rules (from the brief — non-negotiable)

1. **Don't break the baseline.** Agent CRUD, lifecycle, Playground chat, persistence, and model
   execution must keep working.
2. **The middleware must really run** in a backend / Runtime / data path. A static screen or a
   hard-coded "Success!" does **not** count.
3. **Enforce at the backend, never the UI.** A login screen or a hidden button with no server-side
   check does *not* demonstrate the middleware.
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
  auth/               <- identity, login/session, principals   (Person 1)
  policy/             <- PDP decision service + PEP helpers     (Person 2)
  capability/         <- issue / scope / expire / revoke        (Person 3)
  resources/          <- mock protected resources for A and B   (Person 4)
  audit/              <- decision log (Person 2 writes, shared read)
apps/web/src/
  App.tsx             <- thin evidence UI (Person 4)
```

---

## 3. Who does what — the 5-person split

| # | Role | Owns (files/modules) | Core responsibility |
|---|------|----------------------|---------------------|
| **1** | **Lead / Identity core & contract** | `types.ts`, `auth/`, session middleware in `app.ts`, the architecture diagram | Human vs Agent `Principal` model, mock user store, login/session, **owns the `AuthContext` contract and all shared-type PRs**, draws the one-page diagram, drives the demo. |
| **2** | **Policy engine (PDP) + enforcement (PEP)** | `policy/`, PEP hooks in `agent-service.ts` and the `AgentRunner` boundary, `audit/` writes | Builds `decide({principal,action,resource})`, wires enforcement into the backend boundary, implements the ownership-isolation rule. **Heart of the 40% score.** |
| **3** | **Delegation, capabilities & revocation** | `capability/` | Issues scoped, time-bound capabilities on run start; builds **revocation**; keeps the Ark credential on the backend + redacted so the agent principal never holds it. Owns the "execution changes after revocation" evidence. |
| **4** | **Protected resources + evidence UI** | `resources/`, `App.tsx` | Mock resource store where **User A and User B each own things**; the **deliberately thin** UI: user switcher, denial banner, approval prompt, small audit view. Every gate must call the real backend — no client-side `if`. |
| **5** | **Verification, secrets hygiene & demo** | test suite, fixtures, README, startup, demo script | The **negative tests** (A-can't-read-B, revoked-denied, expired-denied, over-scope-denied), mock fixtures, "no secret anywhere" check, README, one-command startup, keeps `npm run check` green, rehearses the 3-min demo. **Tests + reproducibility = 35% combined.** |

> **Assign Person 1 and Person 2 to your strongest engineers** — everyone depends on Person 1's
> contract, and Person 2's PDP is where most of the score lives.

---

## 4. Full 3-day timeline

### Day 1 — Design serially, then diverge
**Goal:** the baseline passes and we can trigger **one real authorization decision** from an API or test.

- **Whole team (morning):** at a whiteboard, lock the exact scope, the `AuthContext` shape, and the
  `decide()` signature. Pick the two headline bullets (recommended: **ownership isolation + revocation**).
- **Person 1:** ship the identity core — `Principal` model, mock user store, login/session — plus a
  **stub PDP** so everyone has something to import by end of day.
- **Person 2:** get **one real `deny`** working end-to-end, even with a hardcoded scope.
- **Person 3, 4:** scaffold `capability/` and `resources/` against the frozen contract.
- **Person 5:** start writing tests **against the contract, not the finished code** — so you're never blocked.

**Exit evidence:** baseline still passes (`npm run poc` acceptance test), and one authorization decision
fires from an API call or test.  **FREEZE the contract tonight.**

### Day 2 — Parallel backend + thin UI
**Goal:** the complete scenario works end-to-end, browser → backend.

- **Person 2:** finish the PDP + real PEP hooks at the service/runtime boundary; write audit entries.
- **Person 3:** finish capability issuance + **revocation**; confirm the Ark key stays backend-side and redacted.
- **Person 4:** build the two-user mock resource store; wire the UI (user switcher, denial banner,
  approval prompt, audit view) to the **real endpoints**.
- **Person 5:** fill in tests as each path lands; draft the README.

**Exit evidence:** log in as A → agent reads A's resource (permitted) → agent tries B's resource (denied)
→ revoke → denied again, all from the browser.

### Day 3 — Harden, test, rehearse
**Goal:** `npm run check` is green and the demo fits in 3 minutes.

- **Person 5:** finalize the negative tests + secret scan; get `npm run check` green.
- **Person 1:** finish the one-page architecture diagram; rehearse the demo to **under 3 minutes**.
- **Persons 2–4:** fix bugs, handle failure paths cleanly (**if the PDP itself errors → default-deny**),
  clean up.
- **Whole team (evening):** dry-run the demo twice, then **freeze the code**.

**Exit evidence:** `npm run check` passes; full demo rehearsed and timed.

---

## 5. The live demo — run of show (this is what wins)

Aim for one continuous scenario, under 3 minutes:

1. **Log in as User A**; show the Agent and its current lifecycle state.
2. Run a task in the Playground; the agent reads **A's own resource** — *permitted* (a real file/tool action).
3. Same agent tries to read **User B's resource** → **denied at the backend**. *(the blessed proof)*
4. A risky write triggers an **approval gate**; the human approves it.
5. **Revoke** the capability; the agent tries again → **now denied**. *(recovery / revocation case)*
6. Open the **audit log** — each decision attributed to human + agent + scope + result.
7. Show the platform is still fully understandable and controllable.

This single flow hits every scored requirement: a real action, the middleware behavior **plus** the
evidence it produces, and a denial/revocation case.

---

## 6. Risks to actively guard against

- **Contract drift.** If `AuthContext` / `decide()` changes late, it breaks everyone.
  → Freeze end of Day 1; route all shared-type changes through Person 1.
- **Enforcement leaking into the UI.** A hidden button is not middleware and *disqualifies* the work.
  → Person 4: every gate is a backend call, never a client-side `if`.
- **Negative tests that only check the UI.** Asserting on rendered UI ≠ proving isolation.
  → Person 5: tests must hit the backend and assert on the *decision*, not the screen.
- **Secrets leaking.** Any key in source/history/logs/traces fails the checklist.
  → Person 5 owns a scan; pass credentials via env/`.env` (gitignored), never inline in committed code.
- **PDP failure mode undefined.** If the decision service errors, what happens?
  → Default-deny. Decide this explicitly and test it.

---

## 7. How this maps to the evaluation criteria

| Category | Weight | How we cover it |
|----------|--------|-----------------|
| End-to-end middleware behavior | **40%** | Real PDP/PEP decisions at the backend boundary; browser-to-backend denial + revocation. |
| Technical design & integration | **25%** | One coherent `AuthContext` spine, clean PDP/PEP separation, focused modules, extensible `decide()` contract. |
| Verification & robustness | **20%** | Negative tests (isolation, revocation, expiry, over-scope), default-deny on PDP error, secret scan. |
| Demo & reproducibility | **15%** | 3-min rehearsed demo, README, one-command startup (`npm run poc`), documented limitations. |

---

## 8. Deliverables checklist (from the brief)

- [ ] **3-minute live demo** — one real Agent Run + our middleware in a normal case *and* a
      denial/revocation case.
- [ ] **One-page architecture diagram** — middleware, data flow, trust boundary, enforcement point.
- [ ] **Code repository** — setup instructions, the middleware problem & rationale, design summary,
      automated tests, demo steps, limitations, **and no secrets**.
- [ ] `npm run check` passes.
- [ ] No secret in source, git history, logs, traces, screenshots, or demo output.

---

## 9. Reference: baseline commands & entry points

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
- Local state persists between runs — macOS: `~/.volc-agent-launchpad/`, Linux: `.local/`.
- **Start reading the code here:** `apps/server/src/types.ts`, `app.ts`, `agent-service.ts`, the two
  `AgentRunner` implementations, then `apps/web/src/App.tsx`.

---

*Do not start middleware work until the baseline acceptance test passes. Freeze the `AuthContext`
contract at the end of Day 1. Enforce at the backend, prove it with a negative test, and keep secrets
out of everything.*
