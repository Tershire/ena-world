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
    --include="*/" \
    --include="*.md" \
    --exclude="*" \
    "${src}/" "${dst}/"
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
