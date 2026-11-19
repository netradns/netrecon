#!/usr/bin/env bash
# ============================================================
# NetRecon - Dev Tool (macOS/Linux)
#
# Bash equivalent of release.ps1. Run from the netrecon/ directory.
#
# Menu:
#   [1] Commit & Push  - save work to GitHub, no tag, no build
#   [2] Rebuild        - commit + re-tag current version (triggers CI build)
#   [3] Release Patch  - bump patch (x.y.Z+1), tag, build
#   [4] Release Minor  - bump minor (x.Y+1.0), tag, build
#   [5] Release Major  - bump major (X+1.0.0), tag, build
#   [6] Cancel
#
# Version source: the VERSION file.
# On release the images are published to:
#   ghcr.io/netradns/netrecon:<version>
#   ghcr.io/netradns/netrecon-dns-proxy:<version>
#
# Requirements: git on PATH. Run `chmod +x release.sh` once, then `./release.sh`.
# ============================================================

set -euo pipefail

if [ -t 1 ]; then
  C_CYAN=$'\033[36m'; C_YELLOW=$'\033[33m'; C_GREEN=$'\033[32m'
  C_RED=$'\033[31m'; C_MAGENTA=$'\033[35m'; C_GRAY=$'\033[90m'
  C_WHITE=$'\033[37m'; C_RESET=$'\033[0m'
else
  C_CYAN=''; C_YELLOW=''; C_GREEN=''; C_RED=''; C_MAGENTA=''
  C_GRAY=''; C_WHITE=''; C_RESET=''
fi

# ---- Read current version from VERSION file ---------------------------------
currentVersion="$(tr -d '[:space:]' < VERSION)"
IFS='.' read -r major minor patch <<< "$currentVersion"

echo ""
echo "${C_CYAN}========================================${C_RESET}"
echo "${C_CYAN}  NetRecon - Dev Tool${C_RESET}"
echo "${C_CYAN}========================================${C_RESET}"
echo ""
echo -n "  Current version: "
echo "${C_YELLOW}v${currentVersion}${C_RESET}"
echo ""

status="$(git status --porcelain)"
if [ -n "$status" ]; then
  echo "${C_GRAY}  Uncommitted changes:${C_RESET}"
  while IFS= read -r line; do echo "${C_GRAY}    ${line}${C_RESET}"; done <<< "$status"
  echo ""
else
  echo "${C_GREEN}  No uncommitted changes.${C_RESET}"
  echo ""
fi

echo "${C_WHITE}  What would you like to do?${C_RESET}"
echo ""
echo "${C_WHITE}    [1] Commit & Push  (save work, no tag, no build)${C_RESET}"
echo "${C_MAGENTA}    [2] Rebuild        (commit, push, re-tag v${currentVersion}, triggers build)${C_RESET}"
echo "${C_GREEN}    [3] Release Patch  (bump + build)                  -> v${major}.${minor}.$((patch + 1))${C_RESET}"
echo "${C_YELLOW}    [4] Release Minor  (bump + build)                  -> v${major}.$((minor + 1)).0${C_RESET}"
echo "${C_RED}    [5] Release Major  (bump + build)                  -> v$((major + 1)).0.0${C_RESET}"
echo "${C_GRAY}    [6] Cancel${C_RESET}"
echo ""

read -r -p "  Enter choice (1-6): " choice

case "$choice" in
  1)
    if [ -z "$status" ]; then
      echo ""
      echo "${C_GREEN}  Nothing to commit. You're all caught up.${C_RESET}"
      exit 0
    fi
    echo ""
    read -r -p "  Commit message: " commitMsg
    if [ -z "${commitMsg// }" ]; then
      echo "${C_RED}  Commit message is required. Exiting.${C_RESET}"; exit 1
    fi
    git add -A
    echo "${C_GREEN}  [1/3] Staged all changes${C_RESET}"
    git commit -m "$commitMsg"
    echo "${C_GREEN}  [2/3] Committed: ${commitMsg}${C_RESET}"
    git push
    echo "${C_GREEN}  [3/3] Pushed to GitHub${C_RESET}"
    echo ""
    echo "${C_CYAN}  Done! Changes pushed (no build triggered).${C_RESET}"
    echo ""
    exit 0
    ;;
  2)
    echo ""
    if [ -n "$status" ]; then
      defaultMsg="Update v${currentVersion}"
      read -r -p "  Commit message (Enter for '${defaultMsg}'): " commitMsg
      [ -z "${commitMsg// }" ] && commitMsg="$defaultMsg"
      git add -A
      echo "${C_GREEN}  [1/5] Staged all changes${C_RESET}"
      git commit -m "$commitMsg"
      echo "${C_GREEN}  [2/5] Committed: ${commitMsg}${C_RESET}"
    else
      echo "${C_GRAY}  [1/5] No changes to commit (re-tagging only)${C_RESET}"
      echo "${C_GRAY}  [2/5] (skipped)${C_RESET}"
    fi
    git tag -d "v${currentVersion}" >/dev/null 2>&1 || true
    git push origin --delete "v${currentVersion}" >/dev/null 2>&1 || true
    echo "${C_GREEN}  [3/5] Removed old v${currentVersion} tag${C_RESET}"
    git tag "v${currentVersion}"
    echo "${C_GREEN}  [4/5] Tagged v${currentVersion} (new HEAD)${C_RESET}"
    git push
    git push --tags
    echo "${C_GREEN}  [5/5] Pushed to GitHub${C_RESET}"
    echo ""
    echo "${C_CYAN}========================================${C_RESET}"
    echo "${C_CYAN}  Done! v${currentVersion} re-tagged.${C_RESET}"
    echo "${C_CYAN}  GitHub Actions will rebuild the images.${C_RESET}"
    echo "${C_CYAN}========================================${C_RESET}"
    echo ""
    exit 0
    ;;
  3) newVersion="${major}.${minor}.$((patch + 1))" ;;
  4) newVersion="${major}.$((minor + 1)).0" ;;
  5) newVersion="$((major + 1)).0.0" ;;
  6) echo "${C_GRAY}  Cancelled.${C_RESET}"; exit 0 ;;
  *) echo "${C_RED}  Invalid choice. Exiting.${C_RESET}"; exit 1 ;;
esac

echo ""
echo "${C_CYAN}  Releasing v${newVersion}...${C_RESET}"
echo ""

defaultMsg="Release v${newVersion}"
read -r -p "  Commit message (Enter for '${defaultMsg}'): " commitMsg
[ -z "${commitMsg// }" ] && commitMsg="$defaultMsg"

# ---- Step 1: Update VERSION file (no trailing newline) ----------------------
printf '%s' "$newVersion" > VERSION
echo "${C_GREEN}  [1/5] Updated VERSION -> v${newVersion}${C_RESET}"

git add -A
echo "${C_GREEN}  [2/5] Staged all changes${C_RESET}"

git commit -m "$commitMsg"
echo "${C_GREEN}  [3/5] Committed: ${commitMsg}${C_RESET}"

git tag "v${newVersion}"
echo "${C_GREEN}  [4/5] Tagged v${newVersion}${C_RESET}"

git push
git push --tags
echo "${C_GREEN}  [5/5] Pushed to GitHub${C_RESET}"

echo ""
echo "${C_CYAN}========================================${C_RESET}"
echo "${C_CYAN}  Done! v${newVersion} is on its way.${C_RESET}"
echo "${C_CYAN}  GitHub Actions will build the images.${C_RESET}"
echo "${C_CYAN}========================================${C_RESET}"
echo ""
