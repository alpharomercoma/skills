#!/bin/bash
# Start (or reuse) the dedicated Kaggle automation Chrome.
#
# The profile is permanent and separate from your everyday Chrome, so the Kaggle
# sign-in survives reboots and your normal browser is never quit or copied.
# Chrome 136+ only honours --remote-debugging-port on a non-default user-data-dir,
# which this is. CDP binds to 127.0.0.1, but any local process can use it, so this
# profile should hold nothing except the Kaggle sign-in.
#
#   bash start-chrome.sh [url]
#
# Override the port with KAGGLE_CDP_PORT (default 9333).
set -euo pipefail

PORT="${KAGGLE_CDP_PORT:-9333}"
STATE="$HOME/.kaggle-agent"
PROFILE="$STATE/chrome-profile"
URL="${1:-https://www.kaggle.com/}"
CDP="http://127.0.0.1:$PORT/json/version"

if curl -fs --max-time 2 "$CDP" >/dev/null 2>&1; then
  # Something answers on this port. Using it blindly could mean driving another account.
  pid="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -1)"
  if [ -n "$pid" ] && ps -o command= -p "$pid" | grep -qF -- "--user-data-dir=$PROFILE"; then
    echo "already running on port $PORT"
    exit 0
  fi
  echo "Port $PORT is in use by another program, not the Kaggle Chrome. Refusing to use it." >&2
  echo "Free the port, or set KAGGLE_CDP_PORT to another port for both this script and the CLI." >&2
  exit 1
fi

if [ "$(uname)" != "Darwin" ]; then
  echo "start-chrome.sh only supports macOS. Start Chrome yourself with" >&2
  echo "  --user-data-dir=$PROFILE --remote-debugging-port=$PORT" >&2
  exit 1
fi

# A Chrome already using this profile without CDP would swallow the launch below.
if pgrep -f -- "--user-data-dir=$PROFILE" >/dev/null 2>&1; then
  echo "A Chrome is using $PROFILE but port $PORT is not answering." >&2
  echo "Close it with: pkill -f -- '--user-data-dir=$PROFILE'   then run this again." >&2
  exit 1
fi

mkdir -p "$PROFILE"
chmod 700 "$STATE" "$PROFILE"

# The three --disable-* flags keep a covered or minimised window from having its
# timers throttled, which would stall long-running polls.
open -na "Google Chrome" --args \
  --user-data-dir="$PROFILE" \
  --remote-debugging-port="$PORT" \
  --no-first-run \
  --no-default-browser-check \
  --window-size=1600,1100 \
  --disable-background-timer-throttling \
  --disable-backgrounding-occluded-windows \
  --disable-renderer-backgrounding \
  "$URL"

for _ in $(seq 1 30); do
  if curl -fs --max-time 1 "$CDP" >/dev/null 2>&1; then
    echo "started on port $PORT (profile: $PROFILE)"
    exit 0
  fi
  sleep 1
done

echo "Chrome did not answer on port $PORT within 30 s" >&2
exit 1
