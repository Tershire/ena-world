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

Every article needs at minimum a `title`. Only articles with `public: true` are included in the build — articles without it are invisible on the site.

```yaml
---
title: "Kalman Filter"
description: "Optional one-liner shown in listings."
date: 2026-05-17
tags: [estimation, filtering]
public: true          # omit or set false to keep the note private
---
```

### Wikilinks

`[[Article Title]]` links are supported and resolve to kebab-case slugs:

```markdown
See also [[Extended Kalman Filter]] and [[Particle Filter]].
```

---

## Obsidian ↔ Google Drive sync (Ubuntu setup)

The vault is kept in sync with Google Drive via **rclone bisync**. This lets notes written on any device (phone, tablet, other computer) flow into the Ubuntu machine where the site is built.

### Full sync pipeline

```
Obsidian (any device)
  ↕  Google Drive (cloud)
  ↕  rclone bisync
~/Documents/obsidian_vault/   (Ubuntu)
  ↓  sync-vault.sh
src/content/                  (Astro)
  ↓  git push
GitHub Pages
```

### One-time setup

**1. Install rclone and configure a Google Drive remote named `google_drive`:**

```bash
sudo apt install rclone
rclone config   # follow prompts → name the remote "google_drive", type "drive"
```

**2. Create the ignore file** at `~/.config/rclone/obsidian-ignore.txt`:

```
.obsidian/workspace.json
.obsidian/workspace-mobile.json

.obsidian/cache/**
.obsidian/thumbnails/**
.obsidian/plugins/*/data.json

.trash/**
.DS_Store
```

**3. Add the sync alias** to `~/.bashrc`:

```bash
alias s='rclone bisync ~/Documents/obsidian_vault google_drive:obsidian_vault --exclude-from ~/.config/rclone/obsidian-ignore.txt --verbose'
```

Then reload: `source ~/.bashrc`

**4. Run the first bisync with `--resync`** (one time only, to initialize state):

```bash
rclone bisync ~/Documents/obsidian_vault google_drive:obsidian_vault \
  --exclude-from ~/.config/rclone/obsidian-ignore.txt \
  --resync --verbose
```

### Daily usage

```bash
s                                  # 1. pull/push changes with Google Drive
./scripts/sync-vault.sh --publish  # 2. sync vault → Astro + commit + push
```

Or step by step if you want to review before publishing:

```bash
s                          # 1. sync with Google Drive
./scripts/sync-vault.sh    # 2. sync vault → src/content/ (no publish)
npm run build              # 3. preview build locally (optional)
git add src/content public/attachments
git commit -m "sync: obsidian vault"
git push                   # 4. triggers GitHub Pages deploy
```

---

## Publish dashboard (Ubuntu GUI)

`scripts/dashboard.py` is a PyQt6 GUI with four buttons that cover the full publish pipeline.

```
[ sync local ↔ drive ]  [ sync local → ENA ]  [ check npm build ]  [ publish git push ]
```

If **sync local ↔ drive** fails, a red **⚠ resync (recover)** button appears automatically. Clicking it runs `rclone bisync --resync` to reinitialize the sync state. The button disappears once bisync succeeds.

### One-time setup

**1. Create the virtual environment:**

```bash
mkdir -p ~/Documents/virtual_environments
/opt/python/3.12.13/bin/python3 -m venv ~/Documents/virtual_environments/general-py312
```

**2. Install PyQt6:**

```bash
~/Documents/virtual_environments/general-py312/bin/pip install PyQt6
```

**3. (If needed) Install the Qt xcb platform library:**

```bash
sudo apt install libxcb-cursor0
```

### Launching

```bash
./scripts/dashboard.sh
```

`dashboard.sh` activates the virtual environment automatically before running `dashboard.py`.

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
  dashboard.py                PyQt6 publish dashboard
  dashboard.sh                Launcher (activates venv automatically)

.github/workflows/
  deploy.yml                  GitHub Actions → GitHub Pages
```
