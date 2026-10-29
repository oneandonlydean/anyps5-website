#!/bin/sh
# Builds the site for the official domain and deploys the production Worker (site, API and Discord bot). Unlike the
# demo, it is open to search engines. SITE_URL must be the official address, e.g. SITE_URL=https://anyps5.example.
set -eu
: "${SITE_URL:?Set SITE_URL to the official site address}"
export SITE_URL
npm run build
cat > dist/_headers <<'HEADERS'
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
/_astro/*
  Cache-Control: public, max-age=31536000, immutable
HEADERS
npx wrangler d1 migrations apply SITE_DB --remote --env production
npx wrangler deploy --env production
