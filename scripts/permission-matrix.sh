#!/usr/bin/env bash
#
# Permission matrix: drives every authorization path in the middleware against a
# running server and prints permit/deny with the reason the PDP actually gave.
#
#   npm run dev            # or npm run poc
#   ./scripts/permission-matrix.sh
#
# BASE defaults to the dev API. APP_AUTH_TOKEN is sent as a bearer when set.
# Exits non-zero if any case does not behave as documented.

set -uo pipefail

BASE="${BASE:-http://localhost:3000}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
STATUS=""
BODY=""

blue()  { printf '\033[36m%s\033[0m\n' "$1"; }
dim()   { printf '\033[2m%s\033[0m\n' "$1"; }

call() { # method path [json-body] [session-token]
  local method="$1" path="$2" data="${3:-}" session="${4:-}"
  local args=(-s -o "$TMP/body" -w '%{http_code}' -X "$method" "$BASE$path")
  [ -n "${APP_AUTH_TOKEN:-}" ] && args+=(-H "authorization: Bearer $APP_AUTH_TOKEN")
  [ -n "$session" ] && args+=(-H "x-session-token: $session")
  # Only declare a JSON body when there is one: Fastify rejects an empty body
  # that arrives with content-type: application/json, which would mask the 403
  # these cases are actually about.
  [ -n "$data" ] && args+=(-H 'content-type: application/json' --data "$data")
  STATUS="$(curl "${args[@]}")"
  BODY="$(cat "$TMP/body")"
}

jget() { # dotted path into $BODY, empty string when absent
  printf '%s' "$BODY" | python3 -c '
import json, sys
try:
    value = json.load(sys.stdin)
except Exception:
    sys.exit(0)
for key in sys.argv[1].split("."):
    if isinstance(value, dict) and key in value:
        value = value[key]
    else:
        sys.exit(0)
print(value if isinstance(value, str) else json.dumps(value))
' "$1"
}

expect() { # label expected-status expected-substring
  local label="$1" want_status="$2" want_body="${3:-}"
  local ok=1
  [ "$STATUS" = "$want_status" ] || ok=0
  if [ -n "$want_body" ] && ! printf '%s' "$BODY" | grep -q -- "$want_body"; then ok=0; fi
  if [ "$ok" = 1 ]; then
    PASS=$((PASS + 1))
    printf '  \033[32mPASS\033[0m %-58s %s %s\n' "$label" "$STATUS" "${want_body:-}"
  else
    FAIL=$((FAIL + 1))
    printf '  \033[31mFAIL\033[0m %-58s got %s want %s %s\n' "$label" "$STATUS" "$want_status" "${want_body:-}"
    dim "       body: $(printf '%s' "$BODY" | head -c 240)"
  fi
}

login() { # userId password -> token on stdout
  call POST /api/auth/login "{\"userId\":\"$1\",\"password\":\"$2\"}"
  jget sessionToken
}

call GET /api/health
if [ "$STATUS" != "200" ]; then
  echo "No server at $BASE (health returned $STATUS). Start it with: npm run dev" >&2
  exit 1
fi

########################################################################
blue "A. Authentication — no session, no access"
########################################################################

call GET /api/agents
expect "A1  no session cannot list agents"                   401
call POST /api/auth/login '{"userId":"user-a","password":"wrong"}'
expect "A2  wrong password is refused"                       401 "Invalid credentials"
call GET /api/auth/me "" "not-a-real-token"
expect "A3  forged session token resolves to nobody"         401

TOKEN_A="$(login user-a demo-a)"
TOKEN_B="$(login user-b demo-b)"
[ -n "$TOKEN_A" ] && [ -n "$TOKEN_B" ] || { echo "login failed" >&2; exit 1; }
call GET /api/auth/me "" "$TOKEN_A"
expect "A4  valid login returns a usable session"            200 '"id":"user-a"'

########################################################################
blue "B. Human principal — owner branch of the PDP (GET /api/resources/content)"
########################################################################

call GET "/api/resources/content?uri=res://user-a/secret-recipe.txt" "" "$TOKEN_A"
expect "B1  user-a reads own resource"                       200 "owner-principal"
call GET "/api/resources/content?uri=res://user-b/tax-return.txt" "" "$TOKEN_A"
expect "B2  user-a is denied user-b's resource"              403 "out-of-scope"
call GET "/api/resources/content?uri=res://user-b/tax-return.txt" "" "$TOKEN_B"
expect "B3  user-b reads the same file fine (it is theirs)"  200 "owner-principal"
call GET "/api/resources/content?uri=res://user-a/notes.md" "" ""
expect "B4  listing/reading needs a session at all"          401

# The traversal family: uri.ts is the chokepoint, all of these must die there.
call GET "/api/resources/content?uri=res://user-a/../user-b/tax-return.txt" "" "$TOKEN_A"
expect "B5  dot-dot traversal to another owner"              403 "resource-unknown"
call GET "/api/resources/content?uri=res://user-a/%2e%2e/user-b/notes.md" "" "$TOKEN_A"
expect "B6  percent-encoded traversal"                       403 "resource-unknown"
call GET "/api/resources/content?uri=res://user-a/..%5cuser-b/notes.md" "" "$TOKEN_A"
expect "B7  backslash traversal"                             403 "resource-unknown"
call GET "/api/resources/content?uri=res://user-c/notes.md" "" "$TOKEN_A"
expect "B8  unknown owner namespace"                         403 "resource-unknown"
call GET "/api/resources/content?uri=res:/user-a/notes.md" "" "$TOKEN_A"
expect "B9  malformed scheme"                                403 "resource-unknown"
call GET "/api/resources" "" "$TOKEN_A"
expect "B10 metadata for both houses is listable"            200 "res://user-b/"

########################################################################
blue "C. Agent principal — the capability IS the credential (POST /api/resources/read)"
########################################################################

call POST /api/agents '{"name":"matrix-probe","description":"permission matrix"}' "$TOKEN_A"
expect "C1  user-a creates an agent"                         201 '"ownerId":"user-a"'
AGENT_A="$(jget agent.id)"

call POST /api/capabilities "{\"agentId\":\"$AGENT_A\"}" "$TOKEN_A"
expect "C2  mint default keycard (read over own namespace)"  201 "read:res://user-a/\*"
CAP_OK="$(jget capability.id)"

call POST /api/resources/read "{\"uri\":\"res://user-a/secret-recipe.txt\",\"capabilityId\":\"$CAP_OK\"}"
expect "C3  agent reads in scope, with NO session header"    200 "capability-in-scope"
call POST /api/resources/read "{\"uri\":\"res://user-b/tax-return.txt\",\"capabilityId\":\"$CAP_OK\"}"
expect "C4  same keycard cannot open user-b's house"         403 "out-of-scope"

# Wrong verb vs wrong house are deliberately different reasons.
call POST /api/capabilities "{\"agentId\":\"$AGENT_A\",\"scope\":\"write:res://user-a/*\"}" "$TOKEN_A"
CAP_WRITE="$(jget capability.id)"
call POST /api/resources/read "{\"uri\":\"res://user-a/notes.md\",\"capabilityId\":\"$CAP_WRITE\"}"
expect "C5  write-only keycard cannot read"                  403 "action-not-in-scope"

# Narrow glob: one file, not the namespace.
call POST /api/capabilities "{\"agentId\":\"$AGENT_A\",\"scope\":\"read:res://user-a/notes.md\"}" "$TOKEN_A"
CAP_NARROW="$(jget capability.id)"
call POST /api/resources/read "{\"uri\":\"res://user-a/notes.md\",\"capabilityId\":\"$CAP_NARROW\"}"
expect "C6  narrow keycard opens its one file"               200 "capability-in-scope"
call POST /api/resources/read "{\"uri\":\"res://user-a/secret-recipe.txt\",\"capabilityId\":\"$CAP_NARROW\"}"
expect "C7  narrow keycard denied the neighbouring file"     403 "out-of-scope"

# Expiry, without mocking a clock: a non-positive ttl mints an expired keycard.
call POST /api/capabilities "{\"agentId\":\"$AGENT_A\",\"ttlMs\":-1}" "$TOKEN_A"
CAP_EXPIRED="$(jget capability.id)"
call POST /api/resources/read "{\"uri\":\"res://user-a/notes.md\",\"capabilityId\":\"$CAP_EXPIRED\"}"
expect "C8  expired keycard"                                 403 "capability-expired"

# Revocation takes effect on the very next access.
call POST /api/capabilities "{\"agentId\":\"$AGENT_A\"}" "$TOKEN_A"
CAP_REVOKE="$(jget capability.id)"
call POST /api/resources/read "{\"uri\":\"res://user-a/notes.md\",\"capabilityId\":\"$CAP_REVOKE\"}"
expect "C9  keycard works before revocation"                 200 "capability-in-scope"
call POST "/api/capabilities/$CAP_REVOKE/revoke" "" "$TOKEN_A"
expect "C10 owner shreds their own keycard"                  200 '"revokedBy":"user-a"'
call POST /api/resources/read "{\"uri\":\"res://user-a/notes.md\",\"capabilityId\":\"$CAP_REVOKE\"}"
expect "C11 revoked keycard fails on the NEXT access"        403 "capability-revoked"

call POST /api/resources/read '{"uri":"res://user-a/notes.md","capabilityId":"00000000-0000-4000-8000-000000000000"}'
expect "C12 unknown capability id"                           403 "capability-unknown"
call POST /api/resources/read "{\"uri\":\"res://user-a/../user-b/tax-return.txt\",\"capabilityId\":\"$CAP_OK\"}"
expect "C13 traversal under a valid keycard"                 403 "resource-unknown"

########################################################################
blue "D. Issuance and revocation are themselves authorization decisions"
########################################################################

call POST /api/capabilities "{\"agentId\":\"$AGENT_A\",\"scope\":\"read:res://user-b/*\"}" "$TOKEN_A"
expect "D1  cannot mint a keycard for someone else's house"  400 "Refusing to issue"
call POST /api/capabilities "{\"agentId\":\"$AGENT_A\",\"scope\":\"admin:res://user-a/*\"}" "$TOKEN_A"
expect "D2  malformed scope verb is refused at issuance"     400 "Malformed capability scope"
call POST /api/capabilities "{\"agentId\":\"$AGENT_A\",\"scope\":\"read:res://user-a/../user-b/*\"}" "$TOKEN_A"
expect "D3  traversal inside a scope glob is refused"        400 "Malformed capability scope"
call POST /api/capabilities "{\"agentId\":\"$AGENT_A\"}" ""
expect "D4  minting requires a session"                      401
call POST "/api/capabilities/$CAP_OK/revoke" "" "$TOKEN_B"
expect "D5  user-b cannot shred user-a's keycard"            403 "do not own"
call GET /api/capabilities "" "$TOKEN_B"
if printf '%s' "$BODY" | grep -q "$CAP_OK"; then
  FAIL=$((FAIL + 1)); printf '  \033[31mFAIL\033[0m %-58s user-a keycard leaked into user-b list\n' "D6  keycard listing is per-owner"
else
  PASS=$((PASS + 1)); printf '  \033[32mPASS\033[0m %-58s %s no leak\n' "D6  keycard listing is per-owner" "$STATUS"
fi

########################################################################
blue "E. Agent objects — the other resource family (agent:<owner>:<id>)"
########################################################################

call GET "/api/agents/$AGENT_A" "" "$TOKEN_A"
expect "E1  owner reads own agent"                           200 '"id":"'"$AGENT_A"'"'
call GET "/api/agents/$AGENT_A" "" "$TOKEN_B"
expect "E2  user-b reading user-a's agent"                   403 "not-owner"
call PATCH "/api/agents/$AGENT_A" '{"name":"hijacked"}' "$TOKEN_B"
expect "E3  user-b editing user-a's agent"                   403 "not-owner"
call DELETE "/api/agents/$AGENT_A" "" "$TOKEN_B"
expect "E4  user-b deleting user-a's agent"                  403 "not-owner"
call POST "/api/agents/$AGENT_A/start" "" "$TOKEN_B"
expect "E5  user-b starting user-a's agent"                  403 "not-owner"
call GET /api/agents "" "$TOKEN_B"
if printf '%s' "$BODY" | grep -q "$AGENT_A"; then
  FAIL=$((FAIL + 1)); printf '  \033[31mFAIL\033[0m %-58s user-a agent visible to user-b\n' "E6  agent listing is per-owner"
else
  PASS=$((PASS + 1)); printf '  \033[32mPASS\033[0m %-58s %s no leak\n' "E6  agent listing is per-owner" "$STATUS"
fi
# Every decision is appended to the audit trail under the human it belongs to,
# and the trail is itself per-owner.
call GET /api/audit "" "$TOKEN_B"
expect "E7  user-b's denials land in user-b's audit trail"   200 "not-owner"
call GET /api/audit "" "$TOKEN_A"
if printf '%s' "$BODY" | grep -q '"humanId":"user-b"'; then
  FAIL=$((FAIL + 1)); printf '  \033[31mFAIL\033[0m %-58s user-b entries visible to user-a\n' "E8  audit trail is per-owner"
else
  PASS=$((PASS + 1)); printf '  \033[32mPASS\033[0m %-58s %s no leak\n' "E8  audit trail is per-owner" "$STATUS"
fi

########################################################################
blue "F. Edge cases worth watching (documented behaviour, not guarantees)"
########################################################################

call GET "/api/resources/content?uri=res://user-a/does-not-exist.txt" "" "$TOKEN_A"
printf '  \033[33mNOTE\033[0m %-58s %s %s\n' "F1  permitted read of a missing file" "$STATUS" \
  "$(printf '%s' "$BODY" | head -c 80)"
call POST /api/resources/read "{\"uri\":\"res://user-a/does-not-exist.txt\",\"capabilityId\":\"$CAP_OK\"}"
printf '  \033[33mNOTE\033[0m %-58s %s %s\n' "F2  same, under a capability" "$STATUS" \
  "$(printf '%s' "$BODY" | head -c 80)"

call DELETE "/api/agents/$AGENT_A" "" "$TOKEN_A"

echo
printf 'passed %d   failed %d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
