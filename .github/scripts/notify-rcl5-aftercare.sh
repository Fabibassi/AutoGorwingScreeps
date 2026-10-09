#!/usr/bin/env bash
# Fail-soft: open/update a single "RCL5 aftercare verify" issue when probe
# summary shows roomRcl>=5. Comment once when aftercareArmed flips true, then close.
set -euo pipefail

SUMMARY="${1:-.probe-summary.json}"
ISSUE_TITLE="${ISSUE_TITLE:-RCL5 aftercare verify}"
REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY required}"

if [[ ! -f "$SUMMARY" ]]; then
  echo "No probe summary — skip issue notify"
  exit 0
fi

RCL="$(jq -r '.roomRcl // empty' "$SUMMARY")"
if [[ -z "$RCL" || "$RCL" == "null" ]]; then
  echo "roomRcl missing — skip"
  exit 0
fi
if [[ "$RCL" -lt 5 ]]; then
  echo "Still RCL${RCL} — no issue"
  exit 0
fi

ROOM="$(jq -r '.room // "W21N35"' "$SUMMARY")"
MODE="$(jq -r '.rcl5Mode // "null"' "$SUMMARY")"
ARMED="$(jq -r '.aftercareArmed // false' "$SUMMARY")"
PROG="$(jq -r '.progress // "?"' "$SUMMARY")"
PTOT="$(jq -r '.progressTotal // "?"' "$SUMMARY")"
STOR="$(jq -r '.storageEnergy // "?"' "$SUMMARY")"
EXT="$(jq -r '.extensionCount // "?"' "$SUMMARY")"
SITES="$(jq -r '.constructionSites // "?"' "$SUMMARY")"
AT="$(jq -r '.at // "?"' "$SUMMARY")"
RUN="$(jq -r '.runUrl // empty' "$SUMMARY")"
WOULD="$(jq -r '.maybeArmWouldWrite // "null"' "$SUMMARY")"

BODY=$(cat <<EOF
## SitRep — ${ROOM} @ RCL${RCL}

| Field | Value |
| --- | --- |
| probedAt | ${AT} |
| roomRcl | ${RCL} |
| rcl5Mode | \`${MODE}\` |
| aftercareArmed | **${ARMED}** |
| maybeArmWouldWrite | \`${WOULD}\` |
| progress | ${PROG} / ${PTOT} |
| storageEnergy | ${STOR} |
| extensionCount | ${EXT} |
| constructionSites | ${SITES} |
| probe run | ${RUN:-n/a} |

Auto-opened by Live Probe cron when \`roomRcl >= 5\`.
Verified = \`aftercareArmed=true\` (\`rcl5Mode=build_heavy\`).
EOF
)

EXISTING="$(gh issue list --repo "$REPO" \
  --search "in:title \"${ISSUE_TITLE}\"" \
  --state all --limit 20 --json number,title,state \
  | jq -r --arg t "$ISSUE_TITLE" '[.[] | select(.title == $t)] | first | .number // empty')"

if [[ -z "$EXISTING" ]]; then
  echo "Creating issue: $ISSUE_TITLE"
  URL="$(gh issue create --repo "$REPO" --title "$ISSUE_TITLE" --body "$BODY")"
  EXISTING="$(echo "$URL" | grep -oE '[0-9]+$')"
  echo "Created #${EXISTING}"
else
  echo "Updating issue #${EXISTING}"
  STATE="$(gh issue view "$EXISTING" --repo "$REPO" --json state -q .state)"
  if [[ "$STATE" == "CLOSED" && "$ARMED" != "true" ]]; then
    gh issue reopen "$EXISTING" --repo "$REPO" || true
  fi
  gh issue edit "$EXISTING" --repo "$REPO" --body "$BODY"
fi

STATE="$(gh issue view "$EXISTING" --repo "$REPO" --json state -q .state)"

if [[ "$ARMED" == "true" ]]; then
  COMMENTS="$(gh api "repos/${REPO}/issues/${EXISTING}/comments" --paginate)"
  if echo "$COMMENTS" | jq -e \
    '[.[] | select(.body | contains("<!-- aftercare-armed-verified -->"))] | length > 0' \
    >/dev/null; then
    echo "Armed already commented"
  else
    gh issue comment "$EXISTING" --repo "$REPO" --body "$(cat <<EOF
<!-- aftercare-armed-verified -->
**aftercareArmed flipped true** — \`rcl5Mode=build_heavy\` confirmed on live (${ROOM}).

Probe: ${RUN:-see artifact .probe-summary.json}
EOF
)"
  fi
  if [[ "$STATE" != "CLOSED" ]]; then
    gh issue close "$EXISTING" --repo "$REPO" \
      --comment "Verified: RCL≥5 and aftercareArmed=true. Closing." || true
  else
    echo "Issue #${EXISTING} already closed (verified)"
  fi
else
  echo "RCL≥5 but aftercare not armed yet (rcl5Mode=${MODE}) — body updated, no spam comment"
fi
