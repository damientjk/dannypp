#!/usr/bin/env bash
# THE GATE -- an Agent at a door, with and without permission.
#
# Every scenario below is a pair. The same Agent walks up to the same door
# twice, and the ONLY thing that changes between the two attempts is whether it
# has permission. If the pair comes back BLOCKED then GOES IN, the permission
# is doing the work. If both attempts matched, nothing would be proven.
#
# These are real HTTP requests to a running control plane -- the same calls the
# pixel world makes when a robot walks up to a room. Nothing is stubbed, and
# the browser is not involved.
#
# Usage:  ./demo-test-cases/01-the-gate.sh
# Needs a running server (npm run dev). No Ark API key required: the gate is
# decided before the model is ever reached.
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
  -d '{"name":"Gate Demo Agent","description":"walks up to doors"}' |
  sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
if [[ -z "$AGENT" ]]; then bad "SETUP" "could not create the agent"; exit 1; fi

cleanup() {
  curl -sS -o /dev/null -X DELETE "$BASE/api/agents/$AGENT" \
    -H "x-session-token: $TOKEN_A" 2>/dev/null || true
}
trap cleanup EXIT

# The door this demo keeps returning to. In the world this is the Auth Module
# room; underneath, it is this file.
DOOR="res://user-a/notes.md"
NO_KEYCARD="00000000-0000-0000-0000-000000000000"

open_door() {
  curl -sS -w $'\n%{http_code}' -X POST "$BASE/api/resources/read" \
    -H 'content-type: application/json' \
    -d "{\"uri\":\"$1\",\"capabilityId\":\"$2\"}"
}

blue "== SCENARIO 1: the owner grants permission, and the door opens =="
step "Agent $AGENT is walking up to Auth Module ($DOOR)"
echo
stopped_at_gate "with no keycard at all, it is stopped" '"reason":"capability-unknown"' \
  -X POST "$BASE/api/resources/read" -H 'content-type: application/json' \
  -d "{\"uri\":\"$DOOR\",\"capabilityId\":\"$NO_KEYCARD\"}"

step "the owner now grants it a keycard for this room"
KEYCARD="$(json -X POST "$BASE/api/capabilities" -H "x-session-token: $TOKEN_A" \
  -d "{\"agentId\":\"$AGENT\",\"scope\":\"read:$DOOR\"}" |
  sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
if [[ -z "$KEYCARD" ]]; then bad "SETUP" "keycard was not issued"; exit 1; fi
step "keycard $KEYCARD  ·  scope read:$DOOR"
echo

goes_through "the very same request now passes" '"effect":"permit"' \
  -X POST "$BASE/api/resources/read" -H 'content-type: application/json' \
  -d "{\"uri\":\"$DOOR\",\"capabilityId\":\"$KEYCARD\"}"
goes_through "and it really read the file behind the door" 'User A notes' \
  -X POST "$BASE/api/resources/read" -H 'content-type: application/json' \
  -d "{\"uri\":\"$DOOR\",\"capabilityId\":\"$KEYCARD\"}"
note "same agent, same door. Only the permission changed."

echo
blue "== SCENARIO 2: the owner takes permission away, and the door shuts =="
step "the same keycard still opens the same door right now"
goes_through "before revoking" '"effect":"permit"' \
  -X POST "$BASE/api/resources/read" -H 'content-type: application/json' \
  -d "{\"uri\":\"$DOOR\",\"capabilityId\":\"$KEYCARD\"}"

step "the owner shreds the keycard"
curl -sS -o /dev/null -X POST "$BASE/api/capabilities/$KEYCARD/revoke" \
  -H "x-session-token: $TOKEN_A"
echo

stopped_at_gate "the identical request is now stopped" '"reason":"capability-revoked"' \
  -X POST "$BASE/api/resources/read" -H 'content-type: application/json' \
  -d "{\"uri\":\"$DOOR\",\"capabilityId\":\"$KEYCARD\"}"
note "nothing about the agent or the door changed. The permission did."

echo
blue "== SCENARIO 3: permission that runs out on its own =="
EXPIRED="$(json -X POST "$BASE/api/capabilities" -H "x-session-token: $TOKEN_A" \
  -d "{\"agentId\":\"$AGENT\",\"scope\":\"read:$DOOR\",\"ttlMs\":-1}" |
  sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
step "a keycard was issued for this door, but its time has passed"
echo
stopped_at_gate "an out-of-date keycard does not open it" '"reason":"capability-expired"' \
  -X POST "$BASE/api/resources/read" -H 'content-type: application/json' \
  -d "{\"uri\":\"$DOOR\",\"capabilityId\":\"$EXPIRED\"}"
note "permission is time-bound, so nobody has to remember to take it back."

echo
blue "== SCENARIO 4: a keycard opens ONE door, not every door =="
GOOD="$(json -X POST "$BASE/api/capabilities" -H "x-session-token: $TOKEN_A" \
  -d "{\"agentId\":\"$AGENT\",\"scope\":\"read:$DOOR\"}" |
  sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
step "the agent is holding a fresh keycard for Auth Module"
echo
goes_through "at the door it was given" '"effect":"permit"' \
  -X POST "$BASE/api/resources/read" -H 'content-type: application/json' \
  -d "{\"uri\":\"$DOOR\",\"capabilityId\":\"$GOOD\"}"
stopped_at_gate "at Billing, holding that same keycard" '"reason":"out-of-scope"' \
  -X POST "$BASE/api/resources/read" -H 'content-type: application/json' \
  -d "{\"uri\":\"res://user-a/secret-recipe.txt\",\"capabilityId\":\"$GOOD\"}"
note "one keycard, one room. Being let in somewhere is not being let in anywhere."

echo
blue "== SCENARIO 5: THE PROOF -- a door in somebody else's house =="
step "the agent belongs to User A and is carrying User A's keycard"
echo
goes_through "at its own owner's door" '"effect":"permit"' \
  -X POST "$BASE/api/resources/read" -H 'content-type: application/json' \
  -d "{\"uri\":\"$DOOR\",\"capabilityId\":\"$GOOD\"}"
stopped_at_gate "at User B's door" '"reason":"out-of-scope"' \
  -X POST "$BASE/api/resources/read" -H 'content-type: application/json' \
  -d "{\"uri\":\"res://user-b/tax-return.txt\",\"capabilityId\":\"$GOOD\"}"
stays_hidden "and B's file stays behind the door" 'SECRET-TAX-99' \
  -X POST "$BASE/api/resources/read" -H 'content-type: application/json' \
  -d "{\"uri\":\"res://user-b/tax-return.txt\",\"capabilityId\":\"$GOOD\"}"
note "User A's agent cannot reach User B's resource. This is the whole point."

echo
blue "== SCENARIO 6: the gate cannot be walked around =="
stopped_at_gate "sneaking sideways out of the namespace" '"reason":"resource-unknown"' \
  -X POST "$BASE/api/resources/read" -H 'content-type: application/json' \
  -d "{\"uri\":\"res://user-a/../user-b/tax-return.txt\",\"capabilityId\":\"$GOOD\"}"
turned_away "asking for a keycard to another owner's house" 400 \
  -X POST "$BASE/api/capabilities" -H 'content-type: application/json' \
  -H "x-session-token: $TOKEN_A" \
  -d "{\"agentId\":\"$AGENT\",\"scope\":\"read:res://user-b/*\"}"
turned_away "a stranger trying to shred User A's keycard" 403 \
  -X POST "$BASE/api/capabilities/$GOOD/revoke" -H "x-session-token: $TOKEN_B"
note "permission cannot be forged, widened, or taken away by the wrong person."

echo
blue "== EVERY ONE OF THOSE DECISIONS WAS WRITTEN DOWN =="
goes_through "the openings are in the audit trail" '"effect":"permit"' \
  -H "x-session-token: $TOKEN_A" "$BASE/api/audit"
goes_through "so are the refusals, with the reason given" '"effect":"deny"' \
  -H "x-session-token: $TOKEN_A" "$BASE/api/audit"
goes_through "attributed to the human the agent acted for" '"humanId":"user-a"' \
  -H "x-session-token: $TOKEN_A" "$BASE/api/audit"
note "the Security Log in the world is a view of exactly this."

report "THE GATE"
