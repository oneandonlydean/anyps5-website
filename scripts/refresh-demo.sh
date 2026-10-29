#!/bin/sh
# Refreshes every data source and redeploys the Cloudflare demo. Run it by hand, or daily with the systemd user timer
# in scripts/systemd/ (see README). GitHub calls use `gh auth token` and the deploy uses Wrangler's saved login, so no
# secrets live here.
set -eu
cd "$(dirname "$0")/.."
echo "== refresh started $(date -Is)"
npm run sync
npm run fetch:upstream
npm run fetch:coverage
npm run deploy:demo
echo "== refresh finished $(date -Is)"
