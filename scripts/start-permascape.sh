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
# PERMASCAPE_LAUNCH_QUIET=1: no browser, dialog, notification or window closing (tests, rehearsals).
# PERMASCAPE_PORT=<n>: another port (default 8140).
QUIET="${PERMASCAPE_LAUNCH_QUIET:-0}"

# The physical path (pwd -P): the server reports its folder with symlinks
# resolved, and the launcher must see the same string to know it is ours.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
LOGDIR="$HOME/Library/Logs/Permascape3D"
LOG="$LOGDIR/launcher.log"
SRVLOG="$LOGDIR/server.log"
PORT="${PERMASCAPE_PORT:-8140}"
URL="http://127.0.0.1:$PORT"
APP_ID="permascape-3d"
# Projects live outside the app folder, so a new version can replace the folder
# without losing them. A folder that already keeps its own data/projects (an
# older copy, or a developer's) goes on using that.
if [ -n "${PERMASCAPE_DATA:-}" ]; then DATA="$PERMASCAPE_DATA"
elif [ -d "$ROOT/data/projects" ]; then DATA="$ROOT/data"
else DATA="$HOME/Permascape 3D Data"; fi
export PERMASCAPE_DATA="$DATA"

mkdir -p "$LOGDIR" 2>/dev/null
say() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG" 2>/dev/null; }

# When borrowed, the Terminal window is only a means to an end: close it on the
# way out. The closer is detached (setsid) so Terminal closes without asking.
MYTTY="$(tty 2>/dev/null || true)"
close_window() {
  [ "$QUIET" = 1 ] && return 0
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
  [ "$QUIET" = 1 ] && { printf '%b\n' "$1" >&2; exit 1; }
  /usr/bin/osascript -e 'activate' -e "display dialog \"$1\" with title \"Permascape 3D\" buttons {\"OK\"} default button 1 with icon caution" >/dev/null 2>&1
  exit 1
}
note() { say "note: $1"; [ "$QUIET" = 1 ] && return 0; /usr/bin/osascript -e "display notification \"$1\" with title \"Permascape 3D\"" >/dev/null 2>&1; }

say "--- launch --- (via_terminal=$VIA_TERMINAL) root: $ROOT"
[ -f "$ROOT/server/server.mjs" ] || die "Can't find Permascape 3D.\n\nExpected: $ROOT/server/server.mjs"

# Finder gives a bare PATH, so scripts/setup.sh hunts for a Node.js that is new
# enough (20+). A new Mac has none: setup then fetches the pinned version into
# ./runtime, checked against the checksum nodejs.org publishes. Nothing is
# installed system-wide.
SETUP="$ROOT/scripts/setup.sh"
[ -f "$SETUP" ] || die "Can't find scripts/setup.sh.\n\nKeep the whole Permascape 3D folder together."
if ! NODE="$(/bin/bash "$SETUP" --check 2>>"$LOG")"; then
  note "First start: downloading Node.js (about 50 MB, one to three minutes)."
  NODE="$(/bin/bash "$SETUP" 2>>"$LOG")" || die "Permascape 3D needs Node.js and could not download it.\n\nConnect to the internet and open Start Permascape again.\n\nDetails: ~/Library/Logs/Permascape3D/launcher.log"
fi
[ -x "$NODE" ] || die "Permascape 3D needs Node.js 20 or newer.\n\nInstall it from nodejs.org, then open Start Permascape again."
NPM="$(dirname "$NODE")/npm"
export PATH="$(dirname "$NODE"):$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
say "node: $NODE ($("$NODE" -v 2>/dev/null))"

# Liveness is not identity. Ask whatever is on the port who it is and where it runs from.
whoami_json() { /usr/bin/curl -s --max-time 3 "$URL/api/whoami" 2>/dev/null; }
is_ours() { whoami_json | /usr/bin/grep -q "\"app\":\"$APP_ID\"" && whoami_json | /usr/bin/grep -qF "\"project\":\"$ROOT\""; }
is_same_app() { whoami_json | /usr/bin/grep -q "\"app\":\"$APP_ID\""; }
same_data() { whoami_json | /usr/bin/grep -qF "\"data\":\"$DATA\""; }
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

open_page() {
  [ "$QUIET" = 1 ] && { say "quiet: not opening $URL"; return 0; }
  { "$HOME/.local/bin/open-page" "$URL" 2>/dev/null || /usr/bin/open "$URL"; }
}

cd "$ROOT" || die "Can't enter $ROOT"
/bin/cat "$ROOT/package.json" >/dev/null 2>&1 || die "macOS privacy is blocking this launcher from reading the project folder.\n\nFix, once: System Preferences > Security & Privacy > Privacy > Full Disk Access > add Terminal."

# A downloaded copy marks every file "from the internet"; once the person has
# opened the launcher, that mark only makes macOS refuse the Node it fetched.
/usr/bin/xattr -rd com.apple.quarantine "$ROOT" 2>/dev/null || true

# The server needs one small package (pngjs, for the terrain tiles). The app
# itself ships ready built in dist/, so a new copy never needs a build.
if [ ! -f "$ROOT/node_modules/pngjs/package.json" ]; then
  say "installing the server package"
  note "First start: setting up, usually under a minute."
  "$NPM" install --omit=dev --no-audit --no-fund >> "$SRVLOG" 2>&1 || die "Setting up failed. Check the internet connection and open Start Permascape again.\n\nDetails: ~/Library/Logs/Permascape3D/server.log"
fi

# Rebuild only when the source no longer matches the build in dist/ (someone
# changed the code). That needs the full toolkit, which is big and slow on an
# older Mac, so say so honestly.
if ! "$NODE" "$ROOT/scripts/source-hash.mjs" --check 2>>"$LOG"; then
  if [ ! -x "$ROOT/node_modules/.bin/vite" ]; then
    say "installing the build tools"
    note "The app's code was changed, so it must be rebuilt. Getting the build tools first: 3 to 10 minutes."
    "$NPM" install --no-audit --no-fund >> "$SRVLOG" 2>&1 || die "Getting the build tools failed.\n\nDetails: ~/Library/Logs/Permascape3D/server.log"
  fi
  say "building the app"
  note "Rebuilding Permascape 3D: 1 to 5 minutes. The page opens by itself when it is ready."
  "$NPM" run build >> "$SRVLOG" 2>&1 || die "Building the app failed.\n\nDetails: ~/Library/Logs/Permascape3D/server.log"
fi
[ -f "$ROOT/dist/index.html" ] || die "The app is missing its dist folder.\n\nDownload Permascape 3D again and keep the whole folder together."

if is_ours; then
  if stale_server; then
    say "running server predates the code, restarting it"
    kill "$(our_pid)" 2>/dev/null
    for _ in 1 2 3 4 5 6 7 8; do port_busy || break; sleep 0.5; done
  else
    say "already running, opening"
    open_page
    close_window
    exit 0
  fi
elif is_same_app && same_data; then
  # An older copy from another folder serving the same projects (an earlier
  # download): stop it, so one server owns the projects.
  say "stopping a Permascape 3D from another folder that serves the same projects"
  kill "$(our_pid)" 2>/dev/null
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do port_busy || break; sleep 0.5; done
elif is_same_app; then
  die "Another copy of Permascape 3D is already running on port $PORT, from a different folder.\n\nQuit that one first, then click the icon again."
elif port_busy; then
  die "Port $PORT is being used by a different program, so Permascape 3D was not started.\n\nQuit that program, then click the icon again."
fi

say "starting server (data: $DATA)"
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
  open_page
  close_window
  exit 0
fi
die "Permascape 3D did not start.\n\nDetails: ~/Library/Logs/Permascape3D/server.log"
