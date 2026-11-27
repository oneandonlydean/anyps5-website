#!/bin/sh
# Builds the site and deploys it to Cloudflare: `deploy.sh production` for anyps5.gg (site, API and, once its secrets
# are set, the Discord bot), `deploy.sh demo` for demo.anyps5.gg, which is kept out of search engines.
set -eu
target="${1:?usage: deploy.sh demo|production}"
case "$target" in
  production) env="production"; export SITE_URL="${SITE_URL:-https://anyps5.gg}" ;;
  demo) env=""; export SITE_URL="https://demo.anyps5.gg" ;;
  *) echo "usage: deploy.sh demo|production" >&2 && exit 2 ;;
esac

# Refresh the data first, as the Update site workflow does, so a deploy from a laptop never puts older data over the
# workflow's. SKIP_SYNC=1 skips it, for a quick look at a code change, but only when the data was refreshed in the last
# 30 minutes: older data would replace whatever the workflow deployed since.
fresh=$(find data/generated/coverage.json -mmin -30 2>/dev/null || true)
if [ "${SKIP_SYNC:-}" = 1 ] && [ -z "$fresh" ]; then
  echo "SKIP_SYNC ignored: the data is more than 30 minutes old, so refreshing it first."
fi
if [ "${SKIP_SYNC:-}" != 1 ] || [ -z "$fresh" ]; then
  export GITHUB_TOKEN="${GITHUB_TOKEN:-$(gh auth token)}"
  npm run sync
  npm run fetch:upstream
  npm run fetch:coverage
  npm run fetch:commits
fi

npm run build
{
  echo "/*"
  if [ "$target" = demo ]; then echo "  X-Robots-Tag: noindex"; fi
  cat <<'HEADERS'
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
} > dist/_headers

# The site database's migrations; needs "D1: Edit" on the Cloudflare token. Without it, the running Worker says which
# migrations the database has, and the deploy stops if this code needs one it doesn't: uploads would fail.
if ! npx wrangler d1 migrations apply SITE_DB --remote --env="$env"; then
  schema=$(curl -sS -w '\n%{http_code}' "$SITE_URL/api/schema" || printf '\n000')
  status=$(printf '%s' "$schema" | tail -n 1)
  if [ "$status" = 404 ]; then
    # A Worker from before /api/schema existed, or none yet: nothing to compare against.
    echo "::warning::Could not apply the site database's migrations or check them; check the token has D1 Edit."
  elif [ "$status" != 200 ]; then
    echo "::error::Could not apply the site database's migrations, and $SITE_URL/api/schema answered $status." && exit 1
  else
    missing=""
    for file in worker/site-migrations/*.sql; do
      name=$(basename "$file")
      case "$schema" in *"\"$name\""*) ;; *) missing="$missing $name" ;; esac
    done
    if [ -n "$missing" ]; then
      echo "::error::The site database is missing migrations:$missing. Give the token D1 Edit, or run: npx wrangler d1 migrations apply SITE_DB --remote --env=\"$env\"" && exit 1
    fi
    echo "::warning::Could not apply the site database's migrations, but it has them all; check the token has D1 Edit."
  fi
fi
# The bot's database. Production's is gh-worker's live one, so its migrations are run by hand at the bot's cutover
# (see "Going live" in the README), not on every deploy.
if [ "$target" = demo ]; then
  npx wrangler d1 migrations apply DB --remote --env="" || echo "::warning::Could not apply the test bot database's migrations; check the token has D1 Edit."
fi
npx wrangler deploy --env="$env"
