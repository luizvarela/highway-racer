#!/usr/bin/env bash
# Build with the GitHub Pages base path and publish dist/ to the gh-pages branch.
set -euo pipefail
cd "$(dirname "$0")/.."

npx tsc --noEmit
npx vite build --base=/highway-racer/
touch dist/.nojekyll

sha=$(git rev-parse --short HEAD)
tmp=$(mktemp -d)
trap 'git worktree remove --force "$tmp" 2>/dev/null || true' EXIT

if git ls-remote --exit-code --heads origin gh-pages >/dev/null; then
  git fetch -q origin gh-pages
  git worktree add -q "$tmp" origin/gh-pages --detach
else
  git worktree add -q --detach "$tmp"
  git -C "$tmp" checkout -q --orphan gh-pages-new
fi
git -C "$tmp" rm -rqf --ignore-unmatch .
cp -R dist/. "$tmp"/
git -C "$tmp" add -A
git -C "$tmp" commit -qm "Deploy $sha" || { echo "nothing changed"; exit 0; }
git -C "$tmp" push -q origin HEAD:gh-pages
echo "pushed $sha to gh-pages"
