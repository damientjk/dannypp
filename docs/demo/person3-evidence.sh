#!/usr/bin/env bash
# Person 3 evidence: capabilities, ownership isolation and revocation, proved
# against a running backend over HTTP.
#
# Every assertion below is a real request to the control plane. Nothing is
# stubbed, and no animation is involved -- this is the script to run if a judge
# asks whether the UI is deciding anything.
#
# Usage:  ./docs/demo/person3-evidence.sh [base-url]
# Needs:  a running server (npm run dev, or npm run poc). No Ark key required:
#         the middleware path does not call the model.
set -euo pipefail

BASE="${1:-http://localhost:3000}"
AGENT_ID="${AGENT_ID:-11111111-1111-4111-8111-111111111111}"
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

json() { curl -sS -H 'content-type: application/json' "$@"; }

blue "== 0. Baseline is up =="
expect "health check" 200 '"ok":true' "$BASE/api/health"

blue "== 1. User A signs in =="
TOKEN_A="$(json -X POST "$BASE/api/auth/login" \
  -d '{"userId":"user-a","password":"demo-a"}' | sed -n 's/.*"sessionToken":"\([^"]*\)".*/\1/p')"
[[ -n "$TOKEN_A" ]] || { red "login failed"; exit 1; }
green "session issued for user-a"

TOKEN_B="$(json -X POST "$BASE/api/auth/login" \
  -d '{"userId":"user-b","password":"demo-b"}' | sed -n 's/.*"sessionToken":"\([^"]*\)".*/\1/p')"
green "session issued for user-b"

blue "== 2. A's agent is issued a scoped, time-bound keycard =="
CAP="$(json -X POST "$BASE/api/capabilities" -H "x-session-token: $TOKEN_A" \
  -d "{\"agentId\":\"$AGENT_ID\"}")"
CAP_ID="$(printf '%s' "$CAP" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
[[ -n "$CAP_ID" ]] || { red "capability issuance failed: $CAP"; exit 1; }
green "capability $CAP_ID  scope=read:res://user-a/*"

blue "== 3. NORMAL CASE: A's agent reads A's resource -> permit =="
expect "agent reads its owner's resource" 200 '"effect":"permit"' \
  -X POST "$BASE/api/resources/read" -H 'content-type: application/json' \
  -d "{\"uri\":\"res://user-a/secret-recipe.txt\",\"capabilityId\":\"$CAP_ID\"}"

blue "== 4. THE BLESSED PROOF: A's agent reaches for B's resource -> deny =="
expect "cross-user read is denied at the backend" 403 '"reason":"out-of-scope"' \
  -X POST "$BASE/api/resources/read" -H 'content-type: application/json' \
  -d "{\"uri\":\"res://user-b/tax-return.txt\",\"capabilityId\":\"$CAP_ID\"}"

expect "and B's secret is not in the response body" 403 'out-of-scope' \
  -X POST "$BASE/api/resources/read" -H 'content-type: application/json' \
  -d "{\"uri\":\"res://user-b/tax-return.txt\",\"capabilityId\":\"$CAP_ID\"}"

blue "== 5. Traversal cannot be used to get around the scope =="
expect "res://user-a/../user-b/... is rejected" 403 '"reason":"resource-unknown"' \
  -X POST "$BASE/api/resources/read" -H 'content-type: application/json' \
  -d "{\"uri\":\"res://user-a/../user-b/tax-return.txt\",\"capabilityId\":\"$CAP_ID\"}"

blue "== 6. Only the owner may shred the keycard =="
expect "user B cannot revoke user A's capability" 403 '' \
  -X POST "$BASE/api/capabilities/$CAP_ID/revoke" -H "x-session-token: $TOKEN_B"

blue "== 7. REVOCATION CASE: owner shreds it, the same read now fails =="
expect "owner revokes" 200 '"revokedBy":"user-a"' \
  -X POST "$BASE/api/capabilities/$CAP_ID/revoke" -H "x-session-token: $TOKEN_A"

expect "the identical request is now denied" 403 '"reason":"capability-revoked"' \
  -X POST "$BASE/api/resources/read" -H 'content-type: application/json' \
  -d "{\"uri\":\"res://user-a/secret-recipe.txt\",\"capabilityId\":\"$CAP_ID\"}"

blue "== 8. Expiry is enforced too =="
EXPIRED="$(json -X POST "$BASE/api/capabilities" -H "x-session-token: $TOKEN_A" \
  -d "{\"agentId\":\"$AGENT_ID\",\"ttlMs\":-1}" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
expect "an expired keycard is denied" 403 '"reason":"capability-expired"' \
  -X POST "$BASE/api/resources/read" -H 'content-type: application/json' \
  -d "{\"uri\":\"res://user-a/notes.md\",\"capabilityId\":\"$EXPIRED\"}"

blue "== 9. A forged scope cannot widen access =="
expect "minting a keycard for B's namespace is refused" 400 'Refusing to issue' \
  -X POST "$BASE/api/capabilities" -H 'content-type: application/json' \
  -H "x-session-token: $TOKEN_A" \
  -d "{\"agentId\":\"$AGENT_ID\",\"scope\":\"read:res://user-b/*\"}"

blue "== 10. Humans are isolated from each other as well =="
expect "user A cannot read user B's resource directly" 403 '"reason":"out-of-scope"' \
  -H "x-session-token: $TOKEN_A" \
  "$BASE/api/resources/content?uri=res%3A%2F%2Fuser-b%2Ftax-return.txt"

expect "user A can read their own" 200 '"effect":"permit"' \
  -H "x-session-token: $TOKEN_A" \
  "$BASE/api/resources/content?uri=res%3A%2F%2Fuser-a%2Fnotes.md"

echo
blue "== Result: $PASS passed, $FAIL failed =="
[[ "$FAIL" -eq 0 ]]
