#!/usr/bin/env bash
# Runs both halves of the gate demo and saves a transcript next to them.
#
# This is the one command to run before showing the project to anyone, and the
# transcript it writes is the artefact to hand over afterwards.
#
# Usage:  ./demo-test-cases/run-all.sh [base-url]
# Needs a running server (npm run dev). No Ark API key required.
set -uo pipefail

BASE="${1:-http://localhost:3000}"
export BASE
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TRANSCRIPT="$HERE/transcript.txt"
STATUS=0

# Colour is good on a terminal and noise in a committed file.
strip_ansi() { sed -e 's/\x1b\[[0-9;]*m//g'; }

if ! curl -sS -o /dev/null --max-time 5 "$BASE/api/health" 2>/dev/null; then
  printf 'No server answering at %s -- start one with `npm run dev` first.\n' "$BASE" >&2
  exit 1
fi

{
  printf 'Volc Agent Launchpad -- the gate, demonstrated\n'
  printf 'Backend: %s\n' "$BASE"
  printf 'Every scenario is a pair: the same request sent twice, with only\n'
  printf 'the permission changed in between. BLOCKED then GOES IN (or the\n'
  printf 'other way round) is the permission doing the work.\n'
  printf '%s\n' '----------------------------------------------------------'
} > "$TRANSCRIPT"

for script in 01-the-gate.sh 02-the-same-rule-for-agents.sh; do
  printf '\n### %s\n\n' "$script" | tee -a "$TRANSCRIPT"
  # Captured once, printed once, saved once, so the transcript is exactly what
  # was on screen and cannot drift from it.
  output="$(bash "$HERE/$script" 2>&1)"
  script_status=$?
  printf '%s\n' "$output"
  printf '%s\n' "$output" | strip_ansi >> "$TRANSCRIPT"
  [[ $script_status -eq 0 ]] || STATUS=1
done

echo
# The summary goes into the transcript without the absolute path: this file is
# committed, and nobody's home directory belongs in the repository.
if [[ $STATUS -eq 0 ]]; then
  printf 'Every case behaved as predicted.\n' >> "$TRANSCRIPT"
  printf 'Every case behaved as predicted. Transcript: %s\n' "$TRANSCRIPT"
else
  printf 'AT LEAST ONE CASE DID NOT BEHAVE AS PREDICTED.\n' >> "$TRANSCRIPT"
  printf 'AT LEAST ONE CASE DID NOT BEHAVE AS PREDICTED. Transcript: %s\n' "$TRANSCRIPT"
fi
exit $STATUS
