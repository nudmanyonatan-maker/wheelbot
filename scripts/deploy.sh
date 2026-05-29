#!/usr/bin/env bash
# Push to origin/main and auto-approve the resulting Railway deploy.
#
# Why this exists: the WheelBot Railway project is on the Hobby plan, which
# gates every new deploy at NEEDS_APPROVAL once free credits are exhausted.
# There's no API mutation to disable that gate without upgrading the plan, but
# we CAN approve each gated deploy via Railway's GraphQL API.
#
# Usage:
#   ./scripts/deploy.sh                # push + approve + watch
#   ./scripts/deploy.sh --no-push      # just approve any pending deploy
#
# Reads the rotating Railway access token from ~/.railway/config.json.
# Run `railway login` if the token has expired.

set -euo pipefail

PROJECT_ID="7090fcd0-8984-4796-838e-201e5a5edf3e"
SERVICE_ID="7b2ab2bc-cf6a-4abc-ba85-ac647d1b1cdf"
ENV_ID="78a92d21-93f3-4ddc-afd0-05b10a330448"
GRAPHQL="https://backboard.railway.com/graphql/v2"

read_token() {
  python3 -c "import json; print(json.load(open('$HOME/.railway/config.json'))['user']['accessToken'])"
}

gql() {
  # $1 = query, $2 (optional) = JSON variables (defaults to empty object).
  # set -u is enabled (see set -euo pipefail above), so use ${2:-} to default
  # the optional positional parameter to empty without tripping unset-var.
  local query="$1"
  local vars="${2:-}"
  if [[ -z "$vars" ]]; then vars='{}'; fi
  local body
  body=$(python3 -c "import json,sys; print(json.dumps({'query': sys.argv[1], 'variables': json.loads(sys.argv[2])}))" "$query" "$vars")
  # Capture token into a variable instead of inlining $(read_token) into the
  # curl invocation — inline expansion exposes the bearer token in process
  # listings (`ps auxe`) for the lifetime of the curl call.
  local token
  token=$(read_token)
  curl -s "$GRAPHQL" \
    -H "Authorization: Bearer $token" \
    -H "Content-Type: application/json" \
    -d "$body"
}

if [[ "${1:-}" != "--no-push" ]]; then
  echo "→ pushing main to origin..."
  git push origin main
  echo "→ waiting 5s for Railway to register the push..."
  sleep 5
fi

echo "→ checking for gated deploys..."
PENDING=$(gql 'query($pid: String!) { deployments(first:5, input:{projectId:$pid, status:{in:[NEEDS_APPROVAL]}}) { edges { node { id meta } } } }' "{\"pid\":\"$PROJECT_ID\"}" \
  | python3 -c "
import sys, json
raw = sys.stdin.read()
try:
    d = json.loads(raw)
except json.JSONDecodeError:
    sys.stderr.write(f'  ✗ Railway returned non-JSON response: {raw[:200]}\n')
    sys.exit(2)
# GraphQL errors come back as {errors:[...], data:null} — never assume data is dict.
if d.get('errors') or d.get('data') is None:
    err = (d.get('errors') or [{}])[0].get('message', 'unknown')
    sys.stderr.write(f'  ✗ Railway API error: {err}\n')
    sys.stderr.write('  -> run: railway login   (refresh the access token, then retry)\n')
    sys.exit(2)
edges = ((d.get('data') or {}).get('deployments') or {}).get('edges') or []
if not edges:
    print('')
else:
    n = edges[0]['node']
    meta = n.get('meta') or {}
    print(f\"{n['id']}|{(meta.get('commitHash') or '?')[:8]}|{(meta.get('commitMessage') or '').splitlines()[0][:60]}\")
")
# Note: with `set -euo pipefail` at the top, an exit-2 inside the python
# heredoc above already aborts the script after its stderr is flushed,
# so a separate exit-code check here would be unreachable.

if [[ -z "$PENDING" ]]; then
  echo "  no gated deploys — either nothing changed, or auto-deploy is on."
  exit 0
fi

DEPLOY_ID="${PENDING%%|*}"
REST="${PENDING#*|}"
COMMIT="${REST%%|*}"
MSG="${REST#*|}"
echo "→ approving $COMMIT — $MSG"
RESULT=$(gql 'mutation($id: String!) { deploymentApprove(id: $id) }' "{\"id\":\"$DEPLOY_ID\"}")
# Parse the JSON properly instead of grepping — grep is fragile to formatting
# changes (whitespace, key order) and would silently fail on, e.g.,
# `"deploymentApprove" : true`.
if printf '%s' "$RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get('data',{}).get('deploymentApprove') is True else 1)" 2>/dev/null; then
  echo "  ✓ approved. Build/deploy starting."
else
  echo "  ✗ approval failed:"
  printf '%s' "$RESULT" | python3 -m json.tool 2>/dev/null || printf '%s\n' "$RESULT"
  exit 1
fi

echo "→ tailing build logs (Ctrl-C to stop early)..."
railway logs --service wheelbot 2>&1 | head -40
