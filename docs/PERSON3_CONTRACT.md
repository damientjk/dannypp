# Person 3 — Capabilities & Protected Resources: the contract

Status: **implemented, fused with Person 2's PDP/PEP/audit, and green.**
`npm run check` passes (167 tests); `docs/demo/person3-evidence.sh` passes 12/12 against a live
backend.

> **Merged 2026-08-29.** Person 2's `policy-pep-audit` and Person 3's `capability`/`resources`
> are now one system with a single PDP. See §9 for what changed in the fusion and the one
> decision still open for the team.

This is the interface the rest of the team codes against. Nothing here requires a change to
`types.ts` — Person 1's frozen contract was sufficient as shipped.

---

## 1. Scope grammar

```
scope   := "<actions>:<pattern>"
actions := comma-separated, non-empty subset of { read, write }
pattern := "res://<ownerId>/<glob>"
glob    := a resource name in which "*" matches any run of characters
```

| Example | Means |
|---|---|
| `read:res://user-a/*` | read anything of User A's — **the default run capability** |
| `read,write:res://user-a/notes.md` | one file, readable and writable |
| `read:res://user-a/report*` | prefix match |

`..`, `%`, backslashes, spaces, empty segments and unknown owners are rejected in scopes and in
resource URIs alike.

## 2. Resource URIs

```
res://<ownerId>/<name>
```

Seeded on first boot under `${APP_DATA_DIR}/resources/`:

| URI | Contains |
|---|---|
| `res://user-a/secret-recipe.txt` | `SECRET-RECIPE-42 (fake demo data)` |
| `res://user-a/notes.md` | — |
| `res://user-b/tax-return.txt` | `SECRET-TAX-99 (fake demo data)` |
| `res://user-b/notes.md` | — |

Both "secrets" are labelled fake on purpose: they appear in run output, screenshots and the
recorded demo, and deliverable 9 forbids a real secret in any of those.

## 3. Deny reasons (frozen)

These strings go verbatim into the audit log, the security-log panel and the negative tests.

| Reason | Cause |
|---|---|
| `capability-unknown` | no capability presented, or an id we never issued |
| `capability-revoked` | the owner shredded the keycard |
| `capability-expired` | past `expiresAt` |
| `capability-principal-mismatch` | a keycard presented by an agent it was not minted for |
| `out-of-scope` | resource outside the capability's pattern — **the A-can't-read-B proof** |
| `action-not-in-scope` | write attempted under a read-only capability |
| `resource-unknown` | malformed, traversing, or non-existent resource URI |
| `policy-error` | the PDP itself failed → **default-deny** |

Permits carry `capability-in-scope` (agent) or `owner-principal` (human).

---

## 4. The PDP (Person 2's `policy/pdp.ts`) — now unified

There is **one** `decide()` for the platform, and it dispatches on resource family:

| Resource | Shape | Rules applied |
|---|---|---|
| an Agent object | `agent:<ownerId>:<agentId>` | caller owns it, plus a live keycard bound to that owner |
| a data resource | `res://<ownerId>/<name>` | delegates to `authorizeCapability` — action + scope pattern |

Anything else is `malformed-resource`. The PDP throws nothing: on an internal error it
default-denies with `pdp-error`.

`capability/reference-pdp.ts` has been **deleted** — it was a stand-in and the real PDP now
covers both families. `policy/placeholder-capability.ts` has been **deleted** and replaced by
`issueCapabilityForRun()` in `capability/store.ts`, which keeps the exact
`{ principal, capability }` shape Person 2's PEP already consumed.

The two scope grammars coexist deliberately, reconciled by one helper:

```ts
capabilityOwner("read:res://user-a/*")  // -> "user-a"   (Person 3)
capabilityOwner("owner:user-a")         // -> "user-a"   (Person 2)
```

The PDP binds a keycard to an owner through that helper rather than comparing scope strings, so
a capability minted by either half satisfies both. A run capability is
`read:res://<ownerId>/*`, which `capabilityOwner()` reads as the owner (Agent access passes) and
`scopeAllows()` reads as read-only over that owner's data. One keycard, both doors.

## 5. For Person 4 — the UI

| Need | Call |
|---|---|
| draw both houses | `GET /api/resources` → `{ resources: [{uri, ownerId, name}] }` (metadata only) |
| the keycard drawer | `GET /api/capabilities?agentId=` (session header; only your own) |
| mint a keycard | `POST /api/capabilities` `{agentId, scope?, ttlMs?}` → 201 |
| **shred the keycard** | `POST /api/capabilities/:id/revoke` → returns the updated record, so you can re-render without a re-fetch |
| door opens / alarm | `POST /api/resources/read` `{uri, capabilityId}` |

Every response — permit or deny — carries the full `PolicyDecision` (`effect`, `reason`,
`requestId`, `decidedAt`). **Render `decision.reason`; never infer the outcome from the HTTP
status, and never decide it in JavaScript.** A permit is `200`, a denial is `403`.

Session header is `x-session-token`. Note that `POST /api/resources/read` deliberately takes **no
session** — the capability *is* the agent's credential. That is the point of the design, and it is
the thing to show a judge: a revoked keycard fails there even while its human owner is still
perfectly well signed in.

## 6. For Person 5 — testing

Already covered by 167 passing tests, including every negative case on your list:

| Case | Where |
|---|---|
| A-can't-read-B | `capability/scope.test.ts`, `capability/authorize.test.ts`, `resources/access.test.ts`, `middleware-routes.test.ts` |
| revoked-denied | `capability/store.test.ts`, `resources/access.test.ts`, `middleware-routes.test.ts` |
| expired-denied | same three — use `ttlMs: -1`, no clock mocking needed |
| over-scope-denied | `action-not-in-scope` vs `out-of-scope`, in `authorize.test.ts` |
| default-deny on PDP error | `resources/access.test.ts` — PDP that throws, returns junk, returns undefined |
| path traversal | `resources/uri.test.ts` — 20 attack strings |
| non-owner revoke | `middleware-routes.test.ts` |
| secret redaction | `secrets/redact-integration.test.ts` — asserts the key is absent from the DB **on disk** |
| revocation survives to the next run | `capability/store.test.ts` |
| a real Run sees only what its keycard opens | `run-staging.test.ts` |

Fixtures you asked for: `ttlMs` on `issue()`, and the throwing-PDP pattern at the bottom of
`resources/access.test.ts`.

**The one that matters most and is easiest to miss:** `clearStaging` must run after every run.
Without it a resource staged by a permitted run is still sitting in the workspace on the next one,
so the post-revocation attempt still "works" — the revocation story becomes false while every
other test carries on passing. Covered in `resources/staging.test.ts`.

---

## 7. Secret hygiene

- Inbound was already safe: `container-codex-runner.ts` passes `--env ARK_API_KEY` by **name**, so
  the value never reaches argv or `ps`.
- Outbound was the gap. `secrets/redact.ts` is now applied in `agent-service.ts` to run output,
  the assistant message and run/agent errors, so a model that ignores AGENTS.md and prints its
  environment cannot get the key into `launchpad.json` or the browser.
- Secrets shorter than 8 characters are ignored, so an unset key cannot redact every message.

## 8. Known limitations (state these before a judge finds them)

1. **Capabilities are in-memory.** They do not survive a restart. `Database` is frozen at
   version 1, and sessions are already in-memory, so a surviving capability would belong to a
   human who is no longer signed in. A `capabilities.json` sidecar is ~30 minutes if wanted.
2. **Capabilities are opaque ids, not signed tokens.** Holding the id is holding the keycard.
   Fine within one trusted control plane; a real deployment wants a signed, audience-bound token.
3. **Revocation takes effect at the next access, not mid-run.** Every access is a decision point,
   so a revoked keycard fails the next time it is used; a run already in flight is not killed.
   Deliberate — tearing down a run mid-write risks a corrupted workspace.
4. **Two hard-coded users.** Person 1's mock user store; no registration, no password hashing.
5. **`POST /api/capabilities` exists for the demo.** Normally the PEP issues at run start. It is
   safe — the owner comes from the session, never the body, so a caller can only ever mint a
   keycard to their own namespace — but it is a convenience route, not part of the design.

---

## 9. The fusion (2026-08-29) — what changed and what is still open

Merging Person 2's `policy-pep-audit` with Person 3's work surfaced three defects that each
would have survived to the stage. All three are fixed and pinned by tests.

**1. Two PDPs would have denied everything.** Person 2's `decide()` rejected any resource not
matching `agent:<owner>:<id>`, so every `res://` request would have returned `malformed-resource`.
Person 2's capability check also compared scope strings exactly against `owner:<id>`, so every
Person 3 capability would have failed as `capability-scope-mismatch`. Fixed by dispatching on
resource family and binding via `capabilityOwner()` (§4).

**2. Revocation did not survive to the next run.** Each Run mints a fresh capability, so
revoking one had no effect on the following Run — the demo's headline moment
("shred the keycard, the robot is still blocked") was false. Revocation is now a **standing
decision**: `revoke()` suspends the agent, and no new keycard is minted until the owner
explicitly issues one via `POST /api/capabilities`. Pinned by
`capability/store.test.ts > revocation is a standing decision`.

**3. A denied run left the previous run's files in the workspace.** Staging was cleared at run
*start*, but a run denied before staging never reached that point — so the Agent could still read
a resource its current keycard no longer opened. Clearing now happens in a `finally`, covering the
denied and cancelled paths. Pinned by `run-staging.test.ts`.

### Still open — one decision for the team

**The two halves use different deny-reason vocabularies.** They overlap where it matters
(`capability-revoked` and `capability-expired` are identical in both), but they diverge elsewhere:

| Agent resources (Person 2) | Data resources (Person 3) |
|---|---|
| `not-owner` | `out-of-scope` |
| `missing-capability` | `capability-unknown` |
| `malformed-resource` | `resource-unknown` |
| `pdp-error` | `policy-error` |
| `capability-scope-mismatch` | `out-of-scope` |
| permit: `owner-match` / `capability-valid` | permit: `owner-principal` / `capability-in-scope` |

Nothing is broken by this — Person 4 renders `decision.reason` verbatim and both are truthful —
but a judge reading the audit log sees two words for one idea. Unifying is a 15-minute change
plus test updates, and it is **not Person 3's call to make unilaterally**: it touches Person 2's
tests and Person 4's copy. Recommend picking one set at the next standup. Whoever changes it must
update `capability/reasons.ts`, `policy/pdp.ts`, `policy/pdp.test.ts` and this table together.
