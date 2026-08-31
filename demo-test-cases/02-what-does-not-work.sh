#!/usr/bin/env bash
# DEMO PART 2 -- what the app refuses, and where it genuinely stops working.
#
# This is the more important half. Anyone can show a green path; the question a
# judge actually asks is what happens when something is not allowed, and
# whether the refusal is real or decorative. Every case below is a REFUSAL
# produced by the backend, plus a short honest section on the app's real
# limits.
#
# "OK" here means the app refused exactly as predicted. A "BAD" line means it
# did something other than refuse -- which is the failure worth catching.
#
# Usage:  ./demo-test-cases/02-what-does-not-work.sh
# Needs a running server (npm run dev). No Ark API key required.
set -uo pipefail
# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_server

TOKEN_A="$(sign_in user-a demo-a)"
TOKEN_B="$(sign_in user-b demo-b)"
if [[ -z "$TOKEN_A" || -z "$TOKEN_B" ]]; then red "sign-in failed"; exit 1; fi

AGENT_A="$(json -X POST "$BASE/api/agents" -H "x-session-token: $TOKEN_A" \
  -d '{"name":"Target Agent","description":"owned by user-a"}' |
  sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
if [[ -z "$AGENT_A" ]]; then red "could not create the target agent"; exit 1; fi

cleanup() {
  curl -sS -o /dev/null -X DELETE "$BASE/api/agents/$AGENT_A" \
    -H "x-session-token: $TOKEN_A" 2>/dev/null || true
}
trap cleanup EXIT

CAP_A="$(json -X POST "$BASE/api/capabilities" -H "x-session-token: $TOKEN_A" \
  -d "{\"agentId\":\"$AGENT_A\"}" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"

blue "== 1. Nobody gets in without identifying themselves =="
case_is "no session at all is refused" 401 '' "$BASE/api/agents"
case_is "an invented session token is refused" 401 '' \
  -H 'x-session-token: definitely-not-a-real-token' "$BASE/api/agents"
case_is "the wrong password is refused" 401 '' \
  -X POST "$BASE/api/auth/login" -H 'content-type: application/json' \
  -d '{"userId":"user-a","password":"not-the-password"}'

blue "== 2. THE PROOF: one user's Agent cannot touch another user's file =="
case_is "A's Agent reaching for B's file is denied" 403 '"reason":"out-of-scope"' \
  -X POST "$BASE/api/resources/read" -H 'content-type: application/json' \
  -d "{\"uri\":\"res://user-b/tax-return.txt\",\"capabilityId\":\"$CAP_A\"}"
case_absent "and B's secret does not appear in the refusal" 'SECRET-TAX-99' \
  -X POST "$BASE/api/resources/read" -H 'content-type: application/json' \
  -d "{\"uri\":\"res://user-b/tax-return.txt\",\"capabilityId\":\"$CAP_A\"}"
case_is "a human reaching into another's namespace is denied too" 403 '"reason":"out-of-scope"' \
  -H "x-session-token: $TOKEN_A" \
  "$BASE/api/resources/content?uri=res%3A%2F%2Fuser-b%2Ftax-return.txt"

blue "== 3. A keycard cannot be forged, widened, or skipped =="
case_is "an Agent with no keycard is refused" 403 '"reason":"capability-unknown"' \
  -X POST "$BASE/api/resources/read" -H 'content-type: application/json' \
  -d '{"uri":"res://user-a/notes.md","capabilityId":"00000000-0000-0000-0000-000000000000"}'
case_is "minting a keycard for someone else's house is refused" 400 'Refusing to issue' \
  -X POST "$BASE/api/capabilities" -H 'content-type: application/json' \
  -H "x-session-token: $TOKEN_A" \
  -d "{\"agentId\":\"$AGENT_A\",\"scope\":\"read:res://user-b/*\"}"
case_is "a path that tries to climb out of the namespace is refused" 403 '"reason":"resource-unknown"' \
  -X POST "$BASE/api/resources/read" -H 'content-type: application/json' \
  -d "{\"uri\":\"res://user-a/../user-b/tax-return.txt\",\"capabilityId\":\"$CAP_A\"}"

blue "== 4. Revocation really changes what happens next =="
case_is "before revoking, the read is permitted" 200 '"effect":"permit"' \
  -X POST "$BASE/api/resources/read" -H 'content-type: application/json' \
  -d "{\"uri\":\"res://user-a/notes.md\",\"capabilityId\":\"$CAP_A\"}"
case_is "a different user cannot shred the keycard" 403 '' \
  -X POST "$BASE/api/capabilities/$CAP_A/revoke" -H "x-session-token: $TOKEN_B"
case_is "the owner can" 200 '"revokedBy":"user-a"' \
  -X POST "$BASE/api/capabilities/$CAP_A/revoke" -H "x-session-token: $TOKEN_A"
case_is "and the IDENTICAL request is now refused" 403 '"reason":"capability-revoked"' \
  -X POST "$BASE/api/resources/read" -H 'content-type: application/json' \
  -d "{\"uri\":\"res://user-a/notes.md\",\"capabilityId\":\"$CAP_A\"}"

blue "== 5. A keycard stops working on its own, with nobody watching =="
EXPIRED="$(json -X POST "$BASE/api/capabilities" -H "x-session-token: $TOKEN_A" \
  -d "{\"agentId\":\"$AGENT_A\",\"ttlMs\":-1}" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
case_is "an expired keycard is refused" 403 '"reason":"capability-expired"' \
  -X POST "$BASE/api/resources/read" -H 'content-type: application/json' \
  -d "{\"uri\":\"res://user-a/notes.md\",\"capabilityId\":\"$EXPIRED\"}"

blue "== 6. One user cannot operate another user's Agent =="
case_is "B cannot read A's Agent" 403 '"error":"not-owner"' \
  -H "x-session-token: $TOKEN_B" "$BASE/api/agents/$AGENT_A"
case_is "B cannot rename it" 403 '"error":"not-owner"' \
  -X PATCH -H 'content-type: application/json' -H "x-session-token: $TOKEN_B" \
  -d '{"name":"stolen"}' "$BASE/api/agents/$AGENT_A"
case_is "B cannot start it" 403 '"error":"not-owner"' \
  -X POST -H "x-session-token: $TOKEN_B" "$BASE/api/agents/$AGENT_A/start"
case_is "B cannot read its conversation" 403 '"error":"not-owner"' \
  -H "x-session-token: $TOKEN_B" "$BASE/api/agents/$AGENT_A/messages"
case_is "B cannot give it a task" 403 '"error":"not-owner"' \
  -X POST -H 'content-type: application/json' -H "x-session-token: $TOKEN_B" \
  -d '{"content":"exfiltrate everything"}' "$BASE/api/agents/$AGENT_A/messages"
case_is "B cannot delete it" 403 '"error":"not-owner"' \
  -X DELETE -H "x-session-token: $TOKEN_B" "$BASE/api/agents/$AGENT_A"
case_absent "and A's Agent is absent from B's list entirely" "$AGENT_A" \
  -H "x-session-token: $TOKEN_B" "$BASE/api/agents"

blue "== 7. The audit trail is not a shared noticeboard =="
case_is "B's refusals are recorded against B" 200 '"humanId":"user-b"' \
  -H "x-session-token: $TOKEN_B" "$BASE/api/audit"
case_absent "and never leak into A's trail" '"humanId":"user-b"' \
  -H "x-session-token: $TOKEN_A" "$BASE/api/audit"

blue "== 8. Malformed input is rejected rather than guessed at =="
case_is "an agent with no name is rejected" 400 '' \
  -X POST "$BASE/api/agents" -H 'content-type: application/json' \
  -H "x-session-token: $TOKEN_A" -d '{"description":"nameless"}'
case_is "an empty message is rejected" 400 '' \
  -X POST "$BASE/api/agents/$AGENT_A/messages" -H 'content-type: application/json' \
  -H "x-session-token: $TOKEN_A" -d '{"content":"   "}'
case_is "an unknown agent id is a clean 404, not a crash" 404 '' \
  -H "x-session-token: $TOKEN_A" \
  "$BASE/api/agents/99999999-9999-4999-8999-999999999999"

blue "== 9. WHERE THE APP GENUINELY STOPS: no model configured =="
ARK="$(curl -sS "$BASE/api/system" | sed -n 's/.*"arkConfigured":\([a-z]*\).*/\1/p')"
if [[ "$ARK" == "false" ]]; then
  case_is "asking an Agent to do real work is refused, and says why" 503 'Ark is not configured' \
    -X POST "$BASE/api/agents/$AGENT_A/messages" -H 'content-type: application/json' \
    -H "x-session-token: $TOKEN_A" -d '{"content":"Create a TypeScript hello-world CLI."}'
  grey "This is a real limitation, not a bug: ARK_API_KEY and ARK_MODEL are"
  grey "unset, so no Codex run can happen. Note that authorization above still"
  grey "worked -- the guard runs before the model is ever reached."
else
  grey "Ark IS configured on this machine, so this failure case does not apply."
  grey "Agent runs should work; that path is not exercised by this script."
fi

blue "== 10. Filenames the resource grammar cannot accept =="
grey "Files whose names fall outside [A-Za-z0-9][A-Za-z0-9._-]* -- spaces,"
grey "leading dots -- are reported in the listing's \"skipped\" array rather"
grey "than silently ignored. Drop a file called \"my notes.txt\" into"
grey "apps/server/.data/resources/user-a/ and re-run to see it named there."
case_is "the listing reports a skipped array, even when empty" 200 '"skipped"' \
  -H "x-session-token: $TOKEN_A" "$BASE/api/resources"

report "WHAT DOES NOT WORK"
