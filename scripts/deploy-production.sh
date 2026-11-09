#!/bin/sh
# Builds the site for the official domain and deploys the production Worker (site, API and Discord bot). Unlike the
# demo, it is open to search engines.
set -eu
export SITE_URL="${SITE_URL:-https://anyps5.gg}"
npm run build
cat > dist/_headers <<'HEADERS'
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
/_astro/*
  Cache-Control: public, max-age=31536000, immutable
# Screenshot and art copies are named after the image they were made from, so a name's content never changes.
/community/*
  Cache-Control: public, max-age=31536000, immutable
/art/*
  Cache-Control: public, max-age=31536000, immutable
HEADERS
npx wrangler d1 migrations apply SITE_DB --remote --env production
npx wrangler deploy --env production
