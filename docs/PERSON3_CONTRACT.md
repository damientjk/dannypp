# Person 3 — Capabilities & Protected Resources: the contract

Status: **implemented and green.** `npm run check` passes; `docs/demo/person3-evidence.sh`
passes 12/12 against a live backend.

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

## 4. For Person 2 — the PDP

Your `decide()` becomes a wrapper. Do **not** re-implement scope matching; there must be exactly
one matcher in the repo and it is `capability/scope.ts`.

```ts
// apps/server/src/policy/pdp.ts
import { authorizeCapability } from "../capability/authorize.js";

export const pdp: PolicyDecisionPoint = {
  async decide(request) {
    const verdict = authorizeCapability(request);   // takes PolicyRequest as-is
    return {
      ...verdict,
      requestId: request.requestId,
      decidedAt: new Date().toISOString(),
    };
    // ...and write your audit entry here.
  },
};
```

`authorizeCapability` reads `principal`, `action`, `resource` and `capability` straight off the
`PolicyRequest`, so **your PDP needs no reference to my capability store at all.** It never throws.

When yours is ready, swap it in at [`index.ts`](../apps/server/src/index.ts) where `referencePdp`
is currently wired, and delete `capability/reference-pdp.ts`. **Do not wire the existing stub in
`policy/pdp.ts` as-is** — it permits everything, which would silently disable every denial in the
demo while all the tests kept passing.

### Issuing at run start

```ts
import { capabilityStore } from "../capability/store.js";
const capability = capabilityStore.issueForRun(agentPrincipal, run.id);  // read-only, 5 min
```

### Enforcing at the runner boundary

```ts
const result = await gate.access({
  principal: agentPrincipal,
  action: "read",
  resourceUri,                 // from an explicit request field, NEVER parsed from the prompt
  requestId: run.id,
  capabilityId: capability.id,
  workspacePath: agent.workspacePath,
});
if (result.effect === "deny") throw new HttpError(403, result.decision.reason);
// ...run the agent; the file is now at <workspace>/inbox/<name>
finally { await gate.clear(agent.workspacePath); }   // <-- REQUIRED, see §6
```

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

Already covered by 141 passing tests, including every negative case on your list:

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
