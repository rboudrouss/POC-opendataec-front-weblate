#!/usr/bin/env bash
# Initialise Weblate with AEC translation data.
# Run after: pnpm weblate:up (then wait ~30s for Weblate to be ready)
set -euo pipefail

WEBLATE_URL="http://localhost:8080"
ADMIN_USER="admin"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="${1:-$SCRIPT_DIR/../data}"
SOURCE_LANG="fr"
LANGS=(da en es eu fi it nl no pl pt sv)

echo "→ Waiting for Weblate to be ready..."
until curl -sf "$WEBLATE_URL/api/" > /dev/null 2>&1; do printf "."; sleep 3; done
echo " ready."

echo "→ Getting admin API token..."
TOKEN=$(docker exec weblate /app/venv/bin/weblate drf_create_token "$ADMIN_USER" 2>&1 \
  | grep -oP '(?<=Generated token )\S+' || true)
if [ -z "$TOKEN" ]; then
  TOKEN=$(docker exec weblate /app/venv/bin/weblate shell -c \
    "from weblate.auth.models import User; u=User.objects.get(username='$ADMIN_USER'); print(u.auth_token.key)" 2>&1 | tail -1)
fi
[ -z "$TOKEN" ] && { echo "ERROR: Could not get admin token."; exit 1; }
echo "→ Token acquired: ${TOKEN:0:10}..."

AUTH=(-H "Authorization: Token $TOKEN")

# ── Create project ────────────────────────────────────────────────
echo "→ Creating project 'aec'..."
curl -sf -X POST "$WEBLATE_URL/api/projects/" "${AUTH[@]}" \
  -H "Content-Type: application/json" \
  -d '{"name":"AEC","slug":"aec","web":"https://open-dataec.fr","source_review":true,"translation_review":true}' > /dev/null || true

curl -sf -X PATCH "$WEBLATE_URL/api/projects/aec/" "${AUTH[@]}" \
  -H "Content-Type: application/json" \
  -d '{"source_review":true,"translation_review":true}' > /dev/null || true

# ── Approve all units in a translation ───────────────────────────
approve_translation() {
  local slug="$1"
  local lang="$2"
  local page=1
  local approved=0

  while true; do
    local resp
    resp=$(curl -sf "$WEBLATE_URL/api/translations/aec/$slug/$lang/units/?page_size=200&page=$page" \
      -H "Authorization: Token $TOKEN")

    local summary
    summary=$(echo "$resp" | python3 -c "
import sys, json, urllib.request, urllib.error

data = json.load(sys.stdin)
token = sys.argv[1]
url_base = sys.argv[2]
approved = 0

for unit in data.get('results', []):
    uid = unit['id']
    target = unit.get('target', [])
    if unit.get('state', 0) == 30 or not target or target == ['']:
        continue
    payload = json.dumps({'target': target, 'state': 30}).encode()
    req = urllib.request.Request(
        f'{url_base}/api/units/{uid}/',
        data=payload,
        headers={'Authorization': f'Token {token}', 'Content-Type': 'application/json'},
        method='PATCH'
    )
    try:
        urllib.request.urlopen(req)
        approved += 1
    except urllib.error.HTTPError as e:
        print(f'WARN unit {uid}: {e.code} {e.read().decode()[:80]}', file=sys.stderr)

print(approved)
" "$TOKEN" "$WEBLATE_URL" 2>/dev/null)

    approved=$((approved + ${summary:-0}))

    local next
    next=$(echo "$resp" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('next') or '')" 2>/dev/null || echo "")
    [ -z "$next" ] && break
    page=$((page + 1))
  done

  echo "$approved"
}

# ── Create component + upload all language files ──────────────────
setup_component() {
  local slug="$1"
  local name="$2"
  echo "→ Component '$slug'..."

  curl -sf -X POST "$WEBLATE_URL/api/projects/aec/components/" "${AUTH[@]}" \
    -H "Content-Type: application/json" \
    -d "{
      \"name\": \"$name\",
      \"slug\": \"$slug\",
      \"file_format\": \"json\",
      \"filemask\": \"*.json\",
      \"template\": \"$SOURCE_LANG.json\",
      \"source_language\": \"$SOURCE_LANG\",
      \"vcs\": \"local\",
      \"repo\": \"local:\"
    }" > /dev/null 2>&1 || true

  # Upload + approve source language
  if [ -f "$DATA_DIR/$slug/$SOURCE_LANG.json" ]; then
    printf "  $SOURCE_LANG "
    curl -sf -X POST "$WEBLATE_URL/api/translations/aec/$slug/$SOURCE_LANG/file/" \
      "${AUTH[@]}" -F "file=@$DATA_DIR/$slug/$SOURCE_LANG.json" -F "method=replace" > /dev/null || true
    local n
    n=$(approve_translation "$slug" "$SOURCE_LANG")
    printf "(${n} validés) "
  fi

  # Upload each target language
  for lang in "${LANGS[@]}"; do
    [ -f "$DATA_DIR/$slug/$lang.json" ] || continue
    printf "$lang "
    curl -sf -X POST "$WEBLATE_URL/api/components/aec/$slug/translations/" \
      "${AUTH[@]}" -H "Content-Type: application/json" \
      -d "{\"language_code\":\"$lang\"}" > /dev/null 2>&1 || true
    curl -sf -X POST "$WEBLATE_URL/api/translations/aec/$slug/$lang/file/" \
      "${AUTH[@]}" -F "file=@$DATA_DIR/$slug/$lang.json" -F "method=replace" > /dev/null || true
  done
  echo ""
}

setup_component "parts"    "Parts"
setup_component "chapters" "Chapters"
setup_component "sections" "Sections"
setup_component "measures" "Measures"

# ── Enable suggestion voting on all components ────────────────────
echo "→ Enabling suggestion_voting..."
for slug in parts chapters sections measures; do
  curl -sf -X PATCH "$WEBLATE_URL/api/components/aec/$slug/" "${AUTH[@]}" \
    -H "Content-Type: application/json" \
    -d '{"suggestion_voting": true}' > /dev/null || true
done
echo "  suggestion_voting=true on parts, chapters, sections, measures"

echo "✓ Done. pnpm dev → http://localhost:5173  login: admin / admin"
