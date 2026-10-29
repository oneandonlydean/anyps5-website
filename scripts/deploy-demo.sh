#!/bin/sh
# Builds the site for the demo host and deploys it to Cloudflare. The demo is kept out of search engines.
set -eu
export SITE_URL="https://anyps5-demo.deanisa.ninja"
npm run build
cat > dist/_headers <<'HEADERS'
/*
  X-Robots-Tag: noindex
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
/_astro/*
  Cache-Control: public, max-age=31536000, immutable
HEADERS
# The site database's migrations; needs "D1: Edit" on the Cloudflare token. A failure is reported but doesn't stop
# the deploy, since most deploys add no migrations.
npx wrangler d1 migrations apply SITE_DB --remote --env="" || echo "::warning::Could not apply the site database's migrations; check the token has D1 Edit."
npx wrangler deploy --env=""
