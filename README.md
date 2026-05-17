# ENA World

Personal website for navigation & SLAM study notes. Styled as an explorer's atlas of a fictional planet, with three research stations — each with a unique scroll environment.

**Live site:** https://tershire.github.io/ena-world

---

## Stations

| Station | URL | Scroll effect |
|---|---|---|
| Central Lab | `/central-lab` | Parchment / map |
| Marine Lab | `/marine-lab` | Pelagic zones (ocean depth) |
| Aerospace Lab | `/aerospace-lab` | Atmospheric layers → space |

---

## Local development

```bash
npm install        # first time only
npm run dev        # http://localhost:4321/ena-world
npm run build      # production build → dist/
npm run preview    # preview build locally
```

---

## Writing articles

Articles are written in **Obsidian** (`~/Documents/obsidian_vault`) and synced into the Astro content directory.

### Vault folder structure

```
~/Documents/obsidian_vault/
  central-lab/        ← navigation, SLAM, estimation
  marine-lab/         ← underwater navigation, acoustics
  aerospace-lab/      ← INS, GNSS, aerial SLAM
  attachments/        ← images and files (→ public/attachments/)
```

### Frontmatter

Every article needs at minimum a `title`:

```yaml
---
title: "Kalman Filter"
description: "Optional one-liner shown in listings."
date: 2026-05-17
tags: [estimation, filtering]
draft: false          # true = excluded from build
---
```

### Wikilinks

`[[Article Title]]` links are supported and resolve to kebab-case slugs:

```markdown
See also [[Extended Kalman Filter]] and [[Particle Filter]].
```

---

## Publishing workflow

```
Obsidian → rclone bisync (Google Drive) → sync script → git push → GitHub Pages
```

### Sync from vault and publish in one command

```bash
./scripts/sync-vault.sh --publish
```

### Step by step

```bash
# 1. Sync Obsidian vault → src/content/ (preview first)
./scripts/sync-vault.sh

# 2. Commit and push (triggers GitHub Actions deploy)
git add src/content public/attachments
git commit -m "sync: obsidian vault"
git push
```

GitHub Actions (`.github/workflows/deploy.yml`) builds and deploys automatically on every push to `main`.

---

## GitHub Pages setup (one-time)

1. Push this repo to `github.com/tershire/ena-world`
2. Go to **Settings → Pages → Source → GitHub Actions**
3. Push any commit — first deploy runs automatically

---

## Project structure

```
src/
  content.config.ts          Content Collections schema
  content/
    central-lab/             Article markdown files
    marine-lab/
    aerospace-lab/
  layouts/
    BaseLayout.astro          Nav + footer (shared)
    ArticleLayout.astro       Central Lab articles
    MarineLabLayout.astro     Marine Lab (pelagic depth scroll)
    AerospaceLabLayout.astro  Aerospace Lab (altitude scroll)
  pages/
    index.astro               Homepage: planet hero + station cards
    central-lab/
    marine-lab/
    aerospace-lab/
  styles/
    global.css                Design tokens + base styles

scripts/
  sync-vault.sh               Obsidian → Astro sync

.github/workflows/
  deploy.yml                  GitHub Actions → GitHub Pages
```
