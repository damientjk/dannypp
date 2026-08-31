#!/usr/bin/env bash
# DEMO PART 1 -- what the app does.
#
# Every case below is a real HTTP request to a running control plane. Nothing
# is stubbed and the browser is not involved, which is the point: these are the
# same calls the world makes, so whatever passes here is what the animation is
# rendering.
#
# Usage:  ./demo-test-cases/01-what-works.sh
#         BASE=http://localhost:3000 ./demo-test-cases/01-what-works.sh
#
# Needs a running server (npm run dev). No Ark API key required -- authorization
# is decided before the model is ever called.
set -uo pipefail
# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_server

blue "== 1. The platform is up =="
case_is "the control plane answers" 200 '"ok":true' "$BASE/api/health"

blue "== 2. A human signs in =="
TOKEN_A="$(sign_in user-a demo-a)"
if [[ -z "$TOKEN_A" ]]; then red "user-a could not sign in"; exit 1; fi
green "user-a signed in and holds a session"
case_is "the session identifies the human it belongs to" 200 '"id":"user-a"' \
  -H "x-session-token: $TOKEN_A" "$BASE/api/auth/me"

blue "== 3. An Agent can be created, and it belongs to its creator =="
CREATED="$(json -X POST "$BASE/api/agents" -H "x-session-token: $TOKEN_A" \
  -d '{"name":"Demo Agent","description":"created by the demo","instructions":"Demo only."}')"
AGENT_ID="$(printf '%s' "$CREATED" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
if [[ -z "$AGENT_ID" ]]; then red "agent creation failed: $CREATED"; exit 1; fi
green "agent $AGENT_ID created"
grey "stamped with ownerId=user-a by the backend, not by the caller"

# Tidy up even if a case below fails and the script stops early.
cleanup() {
  curl -sS -o /dev/null -X DELETE "$BASE/api/agents/$AGENT_ID" \
    -H "x-session-token: $TOKEN_A" 2>/dev/null || true
  curl -sS -o /dev/null -X DELETE "$BASE/api/resources/demo-added.md" 2>/dev/null || true
}
trap cleanup EXIT

case_is "the owner sees it in their own list" 200 "$AGENT_ID" \
  -H "x-session-token: $TOKEN_A" "$BASE/api/agents"
case_is "the owner can rename it" 200 '"name":"Demo Agent v2"' \
  -X PATCH -H 'content-type: application/json' -H "x-session-token: $TOKEN_A" \
  -d '{"name":"Demo Agent v2"}' "$BASE/api/agents/$AGENT_ID"

blue "== 4. The owner issues a scoped keycard to their Agent =="
CAP="$(json -X POST "$BASE/api/capabilities" -H "x-session-token: $TOKEN_A" \
  -d "{\"agentId\":\"$AGENT_ID\"}")"
CAP_ID="$(printf '%s' "$CAP" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
if [[ -z "$CAP_ID" ]]; then red "capability issuance failed: $CAP"; exit 1; fi
green "keycard $CAP_ID issued"
grey "scope read:res://user-a/*  ·  time-bound  ·  revocable"

case_is "the owner can see the keycards they hold" 200 "$CAP_ID" \
  -H "x-session-token: $TOKEN_A" "$BASE/api/capabilities"

blue "== 5. THE NORMAL CASE: the Agent opens a door it is allowed through =="
case_is "the read is permitted by the policy engine" 200 '"effect":"permit"' \
  -X POST "$BASE/api/resources/read" -H 'content-type: application/json' \
  -d "{\"uri\":\"res://user-a/secret-recipe.txt\",\"capabilityId\":\"$CAP_ID\"}"
case_is "and it really read the file, not a canned reply" 200 'SECRET-RECIPE-42' \
  -X POST "$BASE/api/resources/read" -H 'content-type: application/json' \
  -d "{\"uri\":\"res://user-a/secret-recipe.txt\",\"capabilityId\":\"$CAP_ID\"}"

blue "== 6. A human reads their own file, still through the guard =="
case_is "permitted, with the decision attached" 200 '"effect":"permit"' \
  -H "x-session-token: $TOKEN_A" \
  "$BASE/api/resources/content?uri=res%3A%2F%2Fuser-a%2Fnotes.md"

blue "== 7. The folders on screen are a real directory =="
case_is "every room's file is listed" 200 'res://user-a/analytics-summary.md' \
  -H "x-session-token: $TOKEN_A" "$BASE/api/resources"
case_is "both houses are visible, so the world can draw them" 200 'res://user-b/notes.md' \
  -H "x-session-token: $TOKEN_A" "$BASE/api/resources"

blue "== 8. Every decision lands in the audit trail =="
case_is "the permit was recorded" 200 '"effect":"permit"' \
  -H "x-session-token: $TOKEN_A" "$BASE/api/audit"
case_is "attributed to the human the Agent acted for" 200 '"humanId":"user-a"' \
  -H "x-session-token: $TOKEN_A" "$BASE/api/audit"
case_is "naming the file that was opened" 200 'res://user-a/secret-recipe.txt' \
  -H "x-session-token: $TOKEN_A" "$BASE/api/audit"

report "WHAT WORKS"
