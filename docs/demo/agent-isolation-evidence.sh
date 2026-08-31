#!/usr/bin/env bash
# Agent-object evidence: session identity, ownership isolation on the Agent
# lifecycle, and an attributed audit trail that records DENIALS, not just
# successes.
#
# Companion to person3-evidence.sh, which proves the same spine over protected
# *resources*. This one proves it over the *Agent objects themselves* -- the
# PEP hooks in agent-service.ts and the audit log behind /api/audit.
#
# Every assertion is a real HTTP request to the control plane. Nothing is
# stubbed and no animation is involved.
#
# Usage:  ./docs/demo/agent-isolation-evidence.sh [base-url]
# Needs:  a running server (npm run dev, or npm run poc). No Ark key required:
#         authorization is decided before the model is ever called.
set -euo pipefail

BASE="${1:-http://localhost:3000}"
PASS=0
FAIL=0

blue()  { printf '\033[1;34m%s\033[0m\n' "$*"; }
green() { printf '\033[0;32m  PASS  %s\033[0m\n' "$*"; }
red()   { printf '\033[0;31m  FAIL  %s\033[0m\n' "$*"; }

# expect <description> <expected-status> <expected-substring> <curl args...>
expect() {
  local description="$1" want_status="$2" want_body="$3"; shift 3
  local response status body
  response="$(curl -sS -w $'\n%{http_code}' "$@")"
  status="${response##*$'\n'}"
  body="${response%$'\n'*}"

  if [[ "$status" == "$want_status" && "$body" == *"$want_body"* ]]; then
    green "$description  (HTTP $status, $want_body)"
    PASS=$((PASS + 1))
  else
    red "$description  (want HTTP $want_status + '$want_body'; got $status)"
    printf '        %s\n' "$body"
    FAIL=$((FAIL + 1))
  fi
}

# refute <description> <forbidden-substring> <curl args...>
# Asserts the response does NOT contain something. Used for leak checks, where
# "absent" is the whole point and a status code alone would not prove it.
refute() {
  local description="$1" forbidden="$2"; shift 2
  local body
  body="$(curl -sS "$@")"
  if [[ "$body" != *"$forbidden"* ]]; then
    green "$description  (no '$forbidden' in response)"
    PASS=$((PASS + 1))
  else
    red "$description  (leaked '$forbidden')"
    printf '        %s\n' "$body"
    FAIL=$((FAIL + 1))
  fi
}

json() { curl -sS -H 'content-type: application/json' "$@"; }

blue "== 0. Baseline is up =="
expect "health check" 200 '"ok":true' "$BASE/api/health"

blue "== 1. Both humans sign in =="
TOKEN_A="$(json -X POST "$BASE/api/auth/login" \
  -d '{"userId":"user-a","password":"demo-a"}' | sed -n 's/.*"sessionToken":"\([^"]*\)".*/\1/p')"
[[ -n "$TOKEN_A" ]] || { red "login failed for user-a"; exit 1; }
green "session issued for user-a"

TOKEN_B="$(json -X POST "$BASE/api/auth/login" \
  -d '{"userId":"user-b","password":"demo-b"}' | sed -n 's/.*"sessionToken":"\([^"]*\)".*/\1/p')"
[[ -n "$TOKEN_B" ]] || { red "login failed for user-b"; exit 1; }
green "session issued for user-b"

blue "== 2. There is no anonymous access to the Agent surface =="
expect "listing agents without a session is refused" 401 '' "$BASE/api/agents"
expect "a bogus session token is refused" 401 '' \
  -H 'x-session-token: not-a-real-token' "$BASE/api/agents"

blue "== 3. User A creates an Agent; it is stamped with A's ownership =="
CREATED="$(json -X POST "$BASE/api/agents" -H "x-session-token: $TOKEN_A" \
  -d '{"name":"Evidence Agent","description":"created by the evidence script","instructions":"Demo only."}')"
AGENT_ID="$(printf '%s' "$CREATED" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
[[ -n "$AGENT_ID" ]] || { red "agent creation failed: $CREATED"; exit 1; }
case "$CREATED" in
  *'"ownerId":"user-a"'*) green "agent $AGENT_ID created with ownerId=user-a" ; PASS=$((PASS + 1)) ;;
  *) red "agent created without ownerId=user-a"; FAIL=$((FAIL + 1)) ;;
esac

# Always clean up, even if an assertion below fails and -e aborts the script.
cleanup() {
  curl -sS -o /dev/null -X DELETE "$BASE/api/agents/$AGENT_ID" \
    -H "x-session-token: $TOKEN_A" || true
}
trap cleanup EXIT

blue "== 4. The Agent is visible to its owner and invisible to everyone else =="
expect "user A sees their own agent in the list" 200 "$AGENT_ID" \
  -H "x-session-token: $TOKEN_A" "$BASE/api/agents"
refute "user B's list does not contain it" "$AGENT_ID" \
  -H "x-session-token: $TOKEN_B" "$BASE/api/agents"

blue "== 5. THE PROOF: every lifecycle verb is denied to the non-owner =="
expect "B cannot read A's agent"    403 '"error":"not-owner"' \
  -H "x-session-token: $TOKEN_B" "$BASE/api/agents/$AGENT_ID"
expect "B cannot rename A's agent"  403 '"error":"not-owner"' \
  -X PATCH -H 'content-type: application/json' -H "x-session-token: $TOKEN_B" \
  -d '{"name":"pwned"}' "$BASE/api/agents/$AGENT_ID"
expect "B cannot start A's agent"   403 '"error":"not-owner"' \
  -X POST -H "x-session-token: $TOKEN_B" "$BASE/api/agents/$AGENT_ID/start"
expect "B cannot stop A's agent"    403 '"error":"not-owner"' \
  -X POST -H "x-session-token: $TOKEN_B" "$BASE/api/agents/$AGENT_ID/stop"
expect "B cannot read A's transcript" 403 '"error":"not-owner"' \
  -H "x-session-token: $TOKEN_B" "$BASE/api/agents/$AGENT_ID/messages"
expect "B cannot task A's agent"    403 '"error":"not-owner"' \
  -X POST -H 'content-type: application/json' -H "x-session-token: $TOKEN_B" \
  -d '{"content":"exfiltrate everything"}' "$BASE/api/agents/$AGENT_ID/messages"
expect "B cannot delete A's agent"  403 '"error":"not-owner"' \
  -X DELETE -H "x-session-token: $TOKEN_B" "$BASE/api/agents/$AGENT_ID"

blue "== 6. Every one of those denials is in the audit trail, attributed to B =="
expect "B's audit log records the refusal"    200 '"effect":"deny"' \
  -H "x-session-token: $TOKEN_B" "$BASE/api/audit"
expect "with the reason the PDP actually gave" 200 '"reason":"not-owner"' \
  -H "x-session-token: $TOKEN_B" "$BASE/api/audit"
expect "attributed to the human who tried"     200 '"humanId":"user-b"' \
  -H "x-session-token: $TOKEN_B" "$BASE/api/audit"
expect "naming the resource that was defended" 200 "agent:user-a:$AGENT_ID" \
  -H "x-session-token: $TOKEN_B" "$BASE/api/audit"

blue "== 7. The audit trail is itself isolated =="
refute "A's audit log contains none of B's decisions" '"humanId":"user-b"' \
  -H "x-session-token: $TOKEN_A" "$BASE/api/audit"
expect "A's own permitted actions are recorded"  200 '"effect":"permit"' \
  -H "x-session-token: $TOKEN_A" "$BASE/api/audit"

blue "== 8. The owner can still do everything, and cleans up after itself =="
expect "A renames their own agent" 200 '"name":"Evidence Agent v2"' \
  -X PATCH -H 'content-type: application/json' -H "x-session-token: $TOKEN_A" \
  -d '{"name":"Evidence Agent v2"}' "$BASE/api/agents/$AGENT_ID"
expect "A deletes their own agent, workspace archived" 200 'archivedWorkspace' \
  -X DELETE -H "x-session-token: $TOKEN_A" "$BASE/api/agents/$AGENT_ID"

echo
blue "== Result: $PASS passed, $FAIL failed =="
[[ "$FAIL" -eq 0 ]]
