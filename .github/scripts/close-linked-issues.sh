!/usr/bin/env bash
# Close GitHub issues linked from a merged PR (idempotent).
# Usage: close-linked-issues.sh <pr-number> [repo]
# Env: GH_TOKEN (required), GITHUB_REPOSITORY (if repo omitted)
set -euo pipefail

N="${1:?PR number required}"
REPO="${2:-${GITHUB_REPOSITORY:?repo required}}"

PR_JSON="$(gh pr view "$N" --repo "$REPO" --json title,body,number,state,mergedAt)"
TITLE="$(echo "$PR_JSON" | jq -r '.title // ""')"
BODY="$(echo "$PR_JSON" | jq -r '.body // ""')"
TEXT="${TITLE}"$'\n'"${BODY}"

# Collect issue numbers from title/body keywords and common title forms.
# EN: closes/close/closed/fix/fixes/fixed/resolve/resolves/resolved
# DE: schlieÃŸt/schliesst/schlieÃŸen/schliessen/behebt/behoben
mapfile -t ISSUES < <(
  {
    echo "$TEXT" | grep -oiE \
      '(closes?|closed|fix(es|ed)?|resolves?|resolved|schlieÃŸt|schliesst|schlieÃŸen|schliessen|behebt|behoben)[[:space:]]+#[[:space:]]*[0-9]+' \
      || true
    echo "$TITLE" | grep -oiE '\(#[0-9]+\)' || true
    echo "$TITLE" | grep -oiE 'issue[[:space:]]*#[0-9]+' || true
  } | grep -oE '[0-9]+' | sort -n | uniq
)

if [ "${#ISSUES[@]}" -eq 0 ]; then
  echo "No linked issue numbers found on PR #$N"
  exit 0
fi

echo "Linked issues on PR #$N: ${ISSUES[*]}"

for ISSUE in "${ISSUES[@]}"; do
  if [ "$ISSUE" = "$N" ]; then
    echo "Skip #$ISSUE (same number as this PR)"
    continue
  fi

  ISSUE_JSON="$(gh api "repos/${REPO}/issues/${ISSUE}" 2>/dev/null || true)"
  if [ -z "$ISSUE_JSON" ]; then
    echo "Skip #$ISSUE (not found)"
    continue
  fi

  if echo "$ISSUE_JSON" | jq -e '.pull_request != null' >/dev/null 2>&1; then
    echo "Skip #$ISSUE (is a pull request)"
    continue
  fi

  STATE="$(echo "$ISSUE_JSON" | jq -r '.state')"
  if [ "$STATE" != "open" ]; then
    echo "Skip #$ISSUE (already $STATE)"
    continue
  fi

  COMMENT="Arbeit gemerged via PR #${N} / Work merged via PR #${N}"
  gh issue close "$ISSUE" --repo "$REPO" --comment "$COMMENT"
  echo "Closed issue #$ISSUE"
done
