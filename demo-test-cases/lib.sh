#!/usr/bin/env bash
# Shared helpers for the gate demo.
#
# Every scenario in this folder is a PAIR: the same agent, at the same door,
# with only the permission changed in between. These helpers exist so the
# scripts read as that contrast rather than as curl plumbing.

BASE="${BASE:-http://localhost:3000}"
PASS=0
FAIL=0

blue()  { printf '\033[1;34m%s\033[0m\n' "$*"; }
step()  { printf '\033[0;90m      %s\033[0m\n' "$*"; }
note()  { printf '\033[1;33m      ^ %s\033[0m\n' "$*"; }
ok()    { printf '\033[0;32m  %-9s %s\033[0m\n' "$1" "$2"; }
bad()   { printf '\033[0;31m  %-9s %s\033[0m\n' "$1" "$2"; }

json() { curl -sS -H 'content-type: application/json' "$@"; }

# Internal. Runs the request and compares status + body against the prediction.
_attempt() {
  local verdict="$1" description="$2" want_status="$3" want_body="$4"; shift 4
  local response status body
  response="$(curl -sS -w $'\n%{http_code}' "$@")"
  status="${response##*$'\n'}"
  body="${response%$'\n'*}"

  if [[ "$status" == "$want_status" && "$body" == *"$want_body"* ]]; then
    ok "$verdict" "$description"
    step "$want_body"
    PASS=$((PASS + 1))
  else
    bad "UNEXPECTED" "$description"
    step "expected $verdict: HTTP $want_status containing '$want_body'"
    step "got HTTP $status: $body"
    FAIL=$((FAIL + 1))
  fi
}

# goes_through <description> <expected-substring> <curl args...>
#   The agent has permission and the gate opens.
goes_through() { _attempt "GOES IN" "$1" 200 "$2" "${@:3}"; }

# stopped_at_gate <description> <expected-reason> <curl args...>
#   The agent does not have permission and the backend refuses. 403 is the
#   assertion, not just "an error": being refused and crashing are different
#   outcomes and a demo that blurs them proves nothing.
stopped_at_gate() { _attempt "BLOCKED" "$1" 403 "$2" "${@:3}"; }

# turned_away <description> <expected-status> <curl args...>
#   Not a gate decision -- no session, bad input, unknown id.
turned_away() { _attempt "REFUSED" "$1" "$2" "" "${@:3}"; }

# stays_hidden <description> <forbidden-substring> <curl args...>
#   Some refusals can only be proven by reading the body: a status code cannot
#   show that a secret stayed where it was.
stays_hidden() {
  local description="$1" forbidden="$2"; shift 2
  local body
  body="$(curl -sS "$@")"
  if [[ "$body" != *"$forbidden"* ]]; then
    ok "UNSEEN" "$description"
    step "no '$forbidden' anywhere in the response"
    PASS=$((PASS + 1))
  else
    bad "LEAKED" "$description"
    step "found '$forbidden': $body"
    FAIL=$((FAIL + 1))
  fi
}

sign_in() {
  json -X POST "$BASE/api/auth/login" -d "{\"userId\":\"$1\",\"password\":\"$2\"}" |
    sed -n 's/.*"sessionToken":"\([^"]*\)".*/\1/p'
}

require_server() {
  if ! curl -sS -o /dev/null --max-time 5 "$BASE/api/health" 2>/dev/null; then
    printf 'No server answering at %s\n' "$BASE" >&2
    printf 'Start one first:  npm run dev\n' >&2
    exit 1
  fi
}

report() {
  echo
  if [[ "$FAIL" -eq 0 ]]; then
    blue "== $1: the gate behaved correctly in all $PASS checks =="
  else
    blue "== $1: $PASS correct, $FAIL WRONG =="
  fi
  [[ "$FAIL" -eq 0 ]]
}
