#!/usr/bin/env bash
# Sync Obsidian vault into Astro content collections.
#
# Vault folder structure expected:
#   ~/Documents/obsidian_vault/
#     central-lab/       → src/content/central-lab/
#     marine-lab/        → src/content/marine-lab/
#     aerospace-lab/     → src/content/aerospace-lab/
#     attachments/       → public/attachments/  (images, PDFs, etc.)
#
# Usage:
#   ./scripts/sync-vault.sh            # sync only
#   ./scripts/sync-vault.sh --publish  # sync + git commit + push

set -euo pipefail

VAULT="${HOME}/Documents/obsidian_vault"
CONTENT="$(dirname "$0")/../src/content"
PUBLIC="$(dirname "$0")/../public"
PUBLISH=false

for arg in "$@"; do
  [[ "$arg" == "--publish" ]] && PUBLISH=true
done

sync_station() {
  local station="$1"
  local src="${VAULT}/${station}"
  local dst="${CONTENT}/${station}"

  if [[ ! -d "$src" ]]; then
    echo "  [skip] ${station}: no such folder in vault"
    return
  fi

  mkdir -p "$dst"
  rsync -av --delete \
    --exclude=".*" \
    --filter="protect _index.md" \
    --include="*/" \
    --include="*.md" \
    --exclude="*" \
    "${src}/" "${dst}/"

  # Auto-create _index.md for any directory that doesn't have one yet
  while IFS= read -r -d '' dir; do
    local index_file="${dir}/_index.md"
    if [[ ! -f "$index_file" ]]; then
      local dirname
      dirname=$(basename "$dir")
      # Title: replace hyphens/underscores with spaces, title-case each word
      local title
      title=$(echo "$dirname" | tr '_-' '  ' | awk '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) substr($i,2); print}')
      printf -- '---\ntitle: %s\norder: 999\n---\n' "$title" > "$index_file"
      echo "  [new]  _index.md: ${dir#"$dst/"}"
    fi
  done < <(find "$dst" -mindepth 1 -type d -print0)

  echo "  [ok]   ${station}"
}

echo "==> Syncing vault: ${VAULT}"
sync_station "central-lab"
sync_station "marine-lab"
sync_station "aerospace-lab"

# Sync references.bib (Better BibTeX auto-export from Zotero)
if [[ -f "${VAULT}/references.bib" ]]; then
  cp "${VAULT}/references.bib" "$(dirname "$0")/../references.bib"
  echo "  [ok]   references.bib"
fi

# Sync attachments (images, PDFs, videos referenced in articles)
if [[ -d "${VAULT}/attachments" ]]; then
  mkdir -p "${PUBLIC}/attachments"
  rsync -av --delete "${VAULT}/attachments/" "${PUBLIC}/attachments/"
  echo "  [ok]   attachments"
fi

echo "==> Sync complete."

if [[ "$PUBLISH" == true ]]; then
  cd "$(dirname "$0")/.."
  git add src/content
  [[ -d public/attachments ]] && git add public/attachments
  git commit -m "sync: obsidian vault $(date '+%Y-%m-%d %H:%M')" || echo "  [info] nothing to commit"
  git push
  echo "==> Published."
fi
