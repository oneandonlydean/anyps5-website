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
npx wrangler deploy
