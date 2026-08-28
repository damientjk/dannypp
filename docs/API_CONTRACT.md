# API Contract — Identity & Authorization

Wire-level contract for the auth middleware. Build against this, not against the
backend source. Frozen as of Day 1 — changes go through a PR to @damientjk.

## Conventions

- All requests and responses are JSON.
- **Every authenticated request sends `x-session-token: <token>`.**
  Not `Authorization` — that header is already used by the Starter Kit's optional
  shared-token gate (`APP_AUTH_TOKEN`) and is a separate concern.
- Every error response is `{ "error": string }`, whatever the status code.

## Test users

| userId   | password |
| -------- | -------- |
| `user-a` | `demo-a` |
| `user-b` | `demo-b` |

## `POST /api/auth/login`

**Request**

```json
{ "userId": "user-a", "password": "demo-a" }
```

**200**

```json
{
  "sessionToken": "7d202067-5809-4482-a666-c030d93b3649",
  "principal": { "kind": "human", "id": "user-a", "displayName": "User A" }
}
```

**401** — wrong password or unknown user

```json
{ "error": "Invalid credentials" }
```

Store `sessionToken` and send it as `x-session-token` on every later request.
Sessions last 1 hour and are held in memory, so a server restart logs everyone out.

## `GET /api/auth/me`

Who is the current session? Use it to restore login state on page load.

**Request headers**

```
x-session-token: <token>
```

**200**

```json
{ "principal": { "kind": "human", "id": "user-a", "displayName": "User A" } }
```

**401** — missing, unknown, or expired token

```json
{ "error": "Not signed in" }
```

## `POST /api/agents`

Unchanged from the baseline except that it now requires a session and stamps an owner.

**Request** — same body as before

```json
{ "name": "Robot A", "description": "", "instructions": "" }
```

**201**

```json
{ "agent": { "id": "...", "ownerId": "user-a", "name": "Robot A", "...": "..." } }
```

**401** — no session

```json
{ "error": "Sign in to create an Agent" }
```

> `ownerId` is taken from the session and **cannot be set by the client**. Sending
> `"ownerId": "user-b"` in the body is silently ignored — the field is stripped by
> validation and the agent is created owned by the logged-in user. This is
> deliberate: it is what stops User A forging ownership of User B's resources.

## Other routes

Every other `/api/*` route is unchanged from the baseline. They do not require a
session **yet** — enforcement lands with the real PDP on Day 2, at which point
reads and writes will start returning `403` for out-of-scope access.

## Types

`Agent` gains one field:

```ts
interface Agent {
  id: string;
  ownerId: string; // NEW
  // ...unchanged
}
```

`apps/web/src/types.ts` is a hand-maintained copy of the backend types — it is not
imported from the server, so it does not update itself. It currently lacks
`ownerId`.

## Known frontend gaps

Two things the web app needs before any of this works from the browser:

1. **`apps/web/src/types.ts`** — add `ownerId: string` to `Agent`.
2. **`apps/web/src/api.ts`** — the `request()` helper only knows how to send
   `Authorization: Bearer`. There is no path for `x-session-token`, so every
   authenticated call will return `401` until one is added. Roughly:

   ```ts
   let sessionToken = "";
   export function setSessionToken(token: string): void {
     sessionToken = token.trim();
   }
   // then, inside request()'s headers object:
   ...(sessionToken ? { "x-session-token": sessionToken } : {}),
   ```

   Plus `login` / `me` entries on the `api` object.

## Not yet real

`policy/pdp.ts` is a placeholder that **always permits**. There is no authorization
enforcement behind these endpoints yet — only authentication. The real decision
logic (ownership isolation, capability scope, expiry, revocation) lands Day 2.

Do not build the deny animation against a hardcoded value: it must fire off a real
`{ "effect": "deny", "reason": "..." }` from the backend.
