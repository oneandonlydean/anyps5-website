#!/usr/bin/env bash
# The bot's cutover from the old gh-discord-roles Worker to production, in the one order that keeps every linked
# member: see "Going live" in the README. Run from the repository root once production has its other secrets:
#   bash worker/rekey/cutover.sh
# The new key and the one-time password live only in this script's variables; they are never printed or saved.
set -euo pipefail
cd "$(dirname "$0")/../.."

OLD=gh-discord-roles
REKEY_URL=https://anyps5.emdd.me/rekey
wrangler() { npx --no-install wrangler "$@"; }
step() { printf '\n== %s\n' "$*"; }

if wrangler secret list --env production 2>/dev/null | grep -q '"TOKEN_KEY"'; then
  echo "Production already has TOKEN_KEY, so the bot is already on there. Stopping." >&2
  exit 1
fi
missing=""
for name in DISCORD_CLIENT_ID DISCORD_CLIENT_SECRET DISCORD_BOT_TOKEN GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET GITHUB_TOKEN; do
  wrangler secret list --env production 2>/dev/null | grep -q "\"$name\"" || missing="$missing $name"
done
if [ -n "$missing" ]; then
  echo "Production is missing:$missing. Set them first: npx wrangler secret put <NAME> --env production" >&2
  exit 1
fi

key=$(openssl rand -base64 32)
password=$(openssl rand -hex 24)

step "1. Giving the old Worker the new key and a one-time password"
printf '%s' "$key" | wrangler secret put NEW_TOKEN_KEY --name "$OLD" >/dev/null
printf '%s' "$password" | wrangler secret put REKEY_PASSWORD --name "$OLD" >/dev/null

step "2. Replacing the old bot with the one-off re-encryption Worker (this stops the old bot and its cron)"
wrangler deploy -c worker/rekey/wrangler.jsonc

step "3. Adding the bot database's new tables (follows, stickies, server tools, votes)"
(cd worker && npx --no-install wrangler d1 migrations apply DB --remote --env production -c ../wrangler.jsonc)

call() {
  curl -sS --fail-with-body --retry 5 --retry-delay 3 --retry-all-errors --doh-url https://1.1.1.1/dns-query \
    -X POST -H "Authorization: Bearer $password" "$REKEY_URL$1"
}

step "4. Checking every member's tokens can be read (nothing changes yet)"
call "?dry-run" | tee /dev/stderr | grep -q '"members"'
echo

step "5. Re-encrypting them with the new key"
result=$(call "")
echo "$result"
node -e '
  const r = JSON.parse(process.argv[1]);
  if (r.members > 0 && r.rekeyed + r.already === 0) { console.error("No member could be read: not turning production on."); process.exit(1); }
  if (r.unreadable.length) console.log(`${r.unreadable.length} member(s) could not be read; they will need to link again.`);
' "$result"

step "6. Turning the bot on in production"
printf '%s' "$key" | wrangler secret put TOKEN_KEY --env production >/dev/null
echo "Done. Next: the Developer Portal URLs, then delete the old Worker (README, Going live)."
