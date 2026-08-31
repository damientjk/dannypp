#!/usr/bin/env bash
# Shared helpers for the demo test cases.
#
# Sourced by 01-what-works.sh and 02-what-does-not-work.sh. Kept in one place
# so the two scripts read as a list of cases rather than a list of plumbing.

BASE="${BASE:-http://localhost:3000}"
PASS=0
FAIL=0

blue()  { printf '\033[1;34m%s\033[0m\n' "$*"; }
green() { printf '\033[0;32m  OK    %s\033[0m\n' "$*"; }
red()   { printf '\033[0;31m  BAD   %s\033[0m\n' "$*"; }
grey()  { printf '\033[0;90m        %s\033[0m\n' "$*"; }

json() { curl -sS -H 'content-type: application/json' "$@"; }

# case <description> <expected-status> <expected-substring> <curl args...>
#
# Prints OK when the server answered exactly as the case predicts. The
# expected status is part of the assertion on purpose: "refused" and "crashed"
# are different outcomes and a demo that blurs them proves nothing.
case_is() {
  local description="$1" want_status="$2" want_body="$3"; shift 3
  local response status body
  response="$(curl -sS -w $'\n%{http_code}' "$@")"
  status="${response##*$'\n'}"
  body="${response%$'\n'*}"

  if [[ "$status" == "$want_status" && "$body" == *"$want_body"* ]]; then
    green "$description"
    grey "HTTP $status  ·  $want_body"
    PASS=$((PASS + 1))
  else
    red "$description"
    grey "expected HTTP $want_status containing '$want_body'"
    grey "got HTTP $status: $body"
    FAIL=$((FAIL + 1))
  fi
}

# case_absent <description> <forbidden-substring> <curl args...>
#
# For the cases where the whole point is that something is NOT in the answer.
# A status code cannot show that a secret stayed put; only reading the body can.
case_absent() {
  local description="$1" forbidden="$2"; shift 2
  local body
  body="$(curl -sS "$@")"
  if [[ "$body" != *"$forbidden"* ]]; then
    green "$description"
    grey "no '$forbidden' anywhere in the response"
    PASS=$((PASS + 1))
  else
    red "$description"
    grey "leaked '$forbidden': $body"
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
    blue "== $1: $PASS of $PASS cases behaved as predicted =="
  else
    blue "== $1: $PASS behaved as predicted, $FAIL did NOT =="
  fi
  [[ "$FAIL" -eq 0 ]]
}
