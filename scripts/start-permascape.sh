#!/bin/bash
# Pages open through ~/.local/bin/open-page, which checks the page really opened (2026-10-22: a Chrome started outside macOS made every icon "do nothing").
#
#  THE PERMASCAPE 3D LAUNCH LOGIC. Safe to edit: it lives outside
#  the app bundle, so changing it never breaks the icon's signature.
#
#  Runs one of two ways, and behaves the same in both:
#    - directly from "Start Permascape.app", when macOS lets the bundle read here
#    - inside a Terminal window (--via-terminal), when macOS privacy blocks the
#      bundle from ~/Desktop. Terminal already holds that permission.
#
#  Logs live in ~/Library/Logs/Permascape3D, NOT in the project: a blocked
#  launcher can neither write nor read back a log under ~/Desktop.
#
set -u

VIA_TERMINAL=0
[ "${1:-}" = "--via-terminal" ] && VIA_TERMINAL=1

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOGDIR="$HOME/Library/Logs/Permascape3D"
LOG="$LOGDIR/launcher.log"
SRVLOG="$LOGDIR/server.log"
PORT=8140
URL="http://127.0.0.1:$PORT"
APP_ID="permascape-3d"

mkdir -p "$LOGDIR" 2>/dev/null
say() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG" 2>/dev/null; }

# When borrowed, the Terminal window is only a means to an end: close it on the
# way out. The closer is detached (setsid) so Terminal closes without asking.
MYTTY="$(tty 2>/dev/null || true)"
close_window() {
  [ "$VIA_TERMINAL" = 1 ] || return 0
  case "$MYTTY" in /dev/tty*) ;; *) return 0 ;; esac
  /usr/bin/perl -MPOSIX -e 'fork and exit; POSIX::setsid(); exec @ARGV' /bin/bash -c "
    sleep 1.5
    /usr/bin/osascript >/dev/null 2>&1 <<OSA
      tell application \"Terminal\"
        repeat with w in windows
          try
            if tty of selected tab of w is \"$MYTTY\" then
              close w saving no
              exit repeat
            end if
          end try
        end repeat
      end tell
OSA
  " >/dev/null 2>&1
}

die() {
  say "FAILED: $1"
  close_window
  /usr/bin/osascript -e 'activate' -e "display dialog \"$1\" with title \"Permascape 3D\" buttons {\"OK\"} default button 1 with icon caution" >/dev/null 2>&1
  exit 1
}
note() { /usr/bin/osascript -e "display notification \"$1\" with title \"Permascape 3D\"" >/dev/null 2>&1; }

say "--- launch --- (via_terminal=$VIA_TERMINAL) root: $ROOT"
[ -f "$ROOT/server/server.mjs" ] || die "Can't find Permascape 3D.\n\nExpected: $ROOT/server/server.mjs"

# Finder gives a bare PATH, so hunt for a node that is new enough (20+).
find_node() {
  NODE=""
  for c in /usr/local/bin/node /opt/homebrew/bin/node "$HOME/.nvm/versions/node"/*/bin/node "$HOME/.volta/bin/node" /usr/bin/node; do
    [ -x "$c" ] && "$c" -e "process.exit(+process.versions.node.split('.')[0] >= 20 ? 0 : 1)" 2>/dev/null && NODE="$c" && return 0
  done
  return 1
}
find_node || die "Permascape 3D needs Node.js 20 or newer.\n\nInstall it from nodejs.org, then click the icon again."
export PATH="$(dirname "$NODE"):$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
say "node: $NODE ($("$NODE" -v 2>/dev/null))"

# Liveness is not identity. Ask whatever is on the port who it is and where it runs from.
whoami_json() { /usr/bin/curl -s --max-time 3 "$URL/api/whoami" 2>/dev/null; }
is_ours() { whoami_json | /usr/bin/grep -q "\"app\":\"$APP_ID\"" && whoami_json | /usr/bin/grep -qF "\"project\":\"$ROOT\""; }
is_same_app() { whoami_json | /usr/bin/grep -q "\"app\":\"$APP_ID\""; }
port_busy() { /usr/sbin/lsof -ti tcp:$PORT -sTCP:LISTEN >/dev/null 2>&1; }
our_pid() { whoami_json | /usr/bin/sed -n 's/.*"pid":\([0-9]*\).*/\1/p'; }

# Pages and the facts file are read live; the server code is not. Restart a
# server that started before the newest server-side file was saved.
stale_server() {
  local pid raw started newest
  pid=$(our_pid); [ -n "$pid" ] || return 1
  raw=$(/bin/ps -o lstart= -p "$pid" 2>/dev/null); [ -n "$raw" ] || return 1
  started=$(/bin/date -j -f "%a %b %e %T %Y" "$raw" +%s 2>/dev/null | head -1)
  case "$started" in ''|*[!0-9]*) return 1 ;; esac
  newest=$(/usr/bin/find "$ROOT/server" -type f -exec /usr/bin/stat -f %m {} + 2>/dev/null | sort -rn | head -1)
  case "$newest" in ''|*[!0-9]*) return 1 ;; esac
  [ "$newest" -gt "$started" ]
}

cd "$ROOT" || die "Can't enter $ROOT"
/bin/cat "$ROOT/package.json" >/dev/null 2>&1 || die "macOS privacy is blocking this launcher from reading the project folder.\n\nFix, once: System Preferences > Security & Privacy > Privacy > Full Disk Access > add Terminal."

# The app is served from dist/. Rebuild it when any source file is newer than the build.
newest_src=$(/usr/bin/find "$ROOT/src" "$ROOT/index.html" -type f -exec /usr/bin/stat -f %m {} + 2>/dev/null | sort -rn | head -1)
built=$(/usr/bin/stat -f %m "$ROOT/dist/index.html" 2>/dev/null || echo 0)
if [ ! -d "$ROOT/node_modules" ]; then
  say "installing packages"
  note "First start: installing packages, about a minute"
  "$(dirname "$NODE")/npm" install --no-audit --no-fund >> "$SRVLOG" 2>&1 || die "Installing packages failed.\n\nDetails: ~/Library/Logs/Permascape3D/server.log"
fi
if [ "${newest_src:-0}" -gt "$built" ]; then
  say "building the app"
  note "Building Permascape 3D, about 20 seconds"
  "$(dirname "$NODE")/npm" run build >> "$SRVLOG" 2>&1 || die "Building the app failed.\n\nDetails: ~/Library/Logs/Permascape3D/server.log"
fi

if is_ours; then
  if stale_server; then
    say "running server predates the code, restarting it"
    kill "$(our_pid)" 2>/dev/null
    for _ in 1 2 3 4 5 6 7 8; do port_busy || break; sleep 0.5; done
  else
    say "already running, opening"
    { "$HOME/.local/bin/open-page" "$URL" || /usr/bin/open "$URL"; }
    close_window
    exit 0
  fi
elif is_same_app; then
  die "Another copy of Permascape 3D is already running on port $PORT, from a different folder.\n\nQuit that one first, then click the icon again."
elif port_busy; then
  die "Port $PORT is being used by a different program, so Permascape 3D was not started.\n\nQuit that program, then click the icon again."
fi

say "starting server"
nohup "$NODE" --no-warnings "$ROOT/server/server.mjs" >> "$SRVLOG" 2>&1 &
SPID=$!
disown $SPID 2>/dev/null

for _ in $(seq 1 40); do
  is_ours && break
  kill -0 $SPID 2>/dev/null || break
  sleep 0.5
done

if is_ours; then
  say "up, opening $URL"
  { "$HOME/.local/bin/open-page" "$URL" || /usr/bin/open "$URL"; }
  close_window
  exit 0
fi
die "Permascape 3D did not start.\n\nDetails: ~/Library/Logs/Permascape3D/server.log"
