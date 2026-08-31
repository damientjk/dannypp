#!/usr/bin/env bash
# THE SAME RULE, APPLIED TO THE AGENTS THEMSELVES.
#
# Scenario 1 showed a robot at a door. An Agent is also something somebody
# owns, and the same question applies to it: with permission you can operate
# it, without permission you cannot. Every pair below is the identical request
# sent twice -- once by the owner, once by somebody else.
#
# The gate is the same gate. Only the thing behind it is different.
#
# Usage:  ./demo-test-cases/02-the-same-rule-for-agents.sh
# Needs a running server (npm run dev). No Ark API key required.
set -uo pipefail
# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_server

TOKEN_A="$(sign_in user-a demo-a)"
TOKEN_B="$(sign_in user-b demo-b)"
if [[ -z "$TOKEN_A" || -z "$TOKEN_B" ]]; then
  bad "SETUP" "could not sign in"; exit 1
fi

AGENT="$(json -X POST "$BASE/api/agents" -H "x-session-token: $TOKEN_A" \
  -d '{"name":"Owned By A","description":"belongs to user-a"}' |
  sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
if [[ -z "$AGENT" ]]; then bad "SETUP" "could not create the agent"; exit 1; fi

cleanup() {
  curl -sS -o /dev/null -X DELETE "$BASE/api/agents/$AGENT" \
    -H "x-session-token: $TOKEN_A" 2>/dev/null || true
}
trap cleanup EXIT

blue "== SCENARIO 1: you have to say who you are before anything else =="
step "the same listing, asked three ways"
echo
turned_away "with no identity at all" 401 "$BASE/api/agents"
turned_away "with an invented session token" 401 \
  -H 'x-session-token: definitely-not-a-real-token' "$BASE/api/agents"
goes_through "signed in as User A" '"agents"' \
  -H "x-session-token: $TOKEN_A" "$BASE/api/agents"
note "identity first. The gate has nothing to decide about a stranger."

echo
blue "== SCENARIO 2: the owner can work with their Agent; nobody else can =="
step "Agent $AGENT belongs to User A. Every pair below is the same request."
echo

step "--- look at it ---"
goes_through "User A, its owner" "$AGENT" \
  -H "x-session-token: $TOKEN_A" "$BASE/api/agents/$AGENT"
stopped_at_gate "User B, who does not own it" '"error":"not-owner"' \
  -H "x-session-token: $TOKEN_B" "$BASE/api/agents/$AGENT"

step "--- rename it ---"
goes_through "User A" '"name":"Renamed By Its Owner"' \
  -X PATCH -H 'content-type: application/json' -H "x-session-token: $TOKEN_A" \
  -d '{"name":"Renamed By Its Owner"}' "$BASE/api/agents/$AGENT"
stopped_at_gate "User B" '"error":"not-owner"' \
  -X PATCH -H 'content-type: application/json' -H "x-session-token: $TOKEN_B" \
  -d '{"name":"Renamed By A Stranger"}' "$BASE/api/agents/$AGENT"

step "--- start it ---"
goes_through "User A" '"status"' \
  -X POST -H "x-session-token: $TOKEN_A" "$BASE/api/agents/$AGENT/start"
stopped_at_gate "User B" '"error":"not-owner"' \
  -X POST -H "x-session-token: $TOKEN_B" "$BASE/api/agents/$AGENT/start"

step "--- read its conversation ---"
goes_through "User A" '"messages"' \
  -H "x-session-token: $TOKEN_A" "$BASE/api/agents/$AGENT/messages"
stopped_at_gate "User B" '"error":"not-owner"' \
  -H "x-session-token: $TOKEN_B" "$BASE/api/agents/$AGENT/messages"

step "--- give it a task ---"
stopped_at_gate "User B trying to put it to work" '"error":"not-owner"' \
  -X POST -H 'content-type: application/json' -H "x-session-token: $TOKEN_B" \
  -d '{"content":"go and read everything you can find"}' \
  "$BASE/api/agents/$AGENT/messages"

step "--- delete it ---"
stopped_at_gate "User B" '"error":"not-owner"' \
  -X DELETE -H "x-session-token: $TOKEN_B" "$BASE/api/agents/$AGENT"
note "six different doors, one rule: ownership decides, and the server checks."

echo
blue "== SCENARIO 3: what you cannot open, you cannot even see =="
goes_through "User A's own list contains it" "$AGENT" \
  -H "x-session-token: $TOKEN_A" "$BASE/api/agents"
stays_hidden "User B's list does not mention it at all" "$AGENT" \
  -H "x-session-token: $TOKEN_B" "$BASE/api/agents"
note "not a hidden button. It is not in the answer B receives."

echo
blue "== SCENARIO 4: the record of who was refused is private too =="
step "User B has just been turned away several times above"
echo
goes_through "B's own log shows B being refused" '"humanId":"user-b"' \
  -H "x-session-token: $TOKEN_B" "$BASE/api/audit"
stays_hidden "and none of it appears in A's log" '"humanId":"user-b"' \
  -H "x-session-token: $TOKEN_A" "$BASE/api/audit"
note "the audit trail is split the same way the resources are."

echo
blue "== SCENARIO 5: where this demo stops, stated plainly =="
ARK="$(curl -sS "$BASE/api/system" | sed -n 's/.*"arkConfigured":\([a-z]*\).*/\1/p')"
if [[ "$ARK" == "false" ]]; then
  turned_away "the owner asking their Agent to do real work" 503 \
    -X POST "$BASE/api/agents/$AGENT/messages" -H 'content-type: application/json' \
    -H "x-session-token: $TOKEN_A" \
    -d '{"content":"Create a TypeScript hello-world CLI."}'
  step "ARK_API_KEY and ARK_MODEL are unset, so there is no model to run."
  note "note WHERE it stops: every permission check above still worked. The"
  step "  gate runs before the model is ever reached, so the middleware is"
  step "  demonstrable on a machine that could not run an Agent at all."
else
  step "Ark IS configured here, so this limit does not apply on this machine."
  step "Agent runs should work; this script does not exercise that path."
fi

report "THE SAME RULE FOR AGENTS"
