#!/bin/bash
#
#  Builds the Permascape 3D download: a folder a designer unzips and
#  double-clicks, with Node.js, the one server package and the built app
#  inside, so nothing has to be installed and npm never runs on their Mac.
#
#    scripts/package.sh            both Macs (Intel and Apple Silicon)
#    scripts/package.sh arm64      one of them (x64 for Intel)
#
#  Output, next to the built app in dist/:
#    Permascape 3D (Intel Mac).zip
#    Permascape 3D (Apple Silicon).zip
#    SHA256SUMS
#
#  Works from a bare `git archive` of the repo (no node_modules; the store's
#  copy has no dist/ either): the app is built here in a scratch folder from
#  package-lock.json. Downloads are cached in ~/Library/Caches/permascape-package
#  and checked against the pins in setup.sh.
#
#  The source ships too (src, server, test, CLAUDE.md), because the buyer may
#  make it their own: the bundled Node carries npm for that, and the launcher
#  rebuilds the app by itself if the code was changed.
#
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
VER="$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' "$ROOT/package.json" | head -1)"
pin() { sed -n "s/^$1=\"\(.*\)\"/\1/p" "$ROOT/scripts/setup.sh"; }
NODE_VERSION="$(pin NODE_VERSION)"
OUT="$ROOT/dist"; mkdir -p "$OUT"
CACHE="$HOME/Library/Caches/permascape-package"; mkdir -p "$CACHE"
ARCHES=("${1:-x64}"); [ $# -eq 0 ] && ARCHES=(x64 arm64)
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
NAME="Permascape 3D"
NPM_BIN="$(command -v npm || true)"
[ -n "$NPM_BIN" ] || { echo "package.sh needs npm on this (the building) Mac to build the app." >&2; exit 1; }

# ------------------------------------------------------------ the built app
echo "== building the app from package-lock.json"
B="$WORK/build"; mkdir -p "$B"
/usr/bin/rsync -a --exclude '.git' --exclude 'node_modules' --exclude 'dist' --exclude 'runtime' --exclude 'data' \
  --exclude 'Showcase Film' --exclude '.DS_Store' "$ROOT/" "$B/"
( cd "$B" && "$NPM_BIN" ci --no-audit --no-fund --loglevel=error >/dev/null && "$NPM_BIN" run build >/dev/null )
[ -f "$B/dist/index.html" ] || { echo "The build did not make dist/index.html." >&2; exit 1; }
( cd "$B" && node scripts/source-hash.mjs --check ) || { echo "The built app does not match the source." >&2; exit 1; }

# The server's one package, exactly as the lockfile pins it.
echo "== server packages"
mkdir -p "$WORK/deps"
cp "$ROOT/package.json" "$ROOT/package-lock.json" "$WORK/deps/"
( cd "$WORK/deps" && "$NPM_BIN" ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error >/dev/null )
NATIVE="$(find "$WORK/deps/node_modules" \( -name '*.node' -o -name 'binding.gyp' -o -name '*.dylib' -o -name '*.so' \) -print)"
[ -z "$NATIVE" ] || { echo "Refusing: server packages have native code, so one copy cannot serve both Macs:" >&2; echo "$NATIVE" >&2; exit 1; }

# What ships: the built app, the server, the launchers, and the source to make it your own.
SHIP=("READ ME FIRST.txt" CLAUDE.md README.md package.json package-lock.json index.html vite.config.ts
      tailwind.config.js postcss.config.js tsconfig.json src server test
      scripts/setup.sh scripts/start-permascape.sh scripts/source-hash.mjs
      "Start Permascape.app" "Start Permascape.command")
JUNK=(--exclude '.DS_Store' --exclude '*.log' --exclude '.env*' --exclude 'node_modules')

SUMS="$CACHE/SHASUMS256-$NODE_VERSION.txt"
[ -f "$SUMS" ] || /usr/bin/curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" -o "$SUMS"

rm -f "$OUT/SHA256SUMS"
for ARCH in "${ARCHES[@]}"; do
  case "$ARCH" in x64) LABEL="Intel Mac";; arm64) LABEL="Apple Silicon";; *) echo "unknown arch $ARCH" >&2; exit 2;; esac
  echo "== $LABEL ($ARCH)"
  DEST="$WORK/$ARCH/$NAME"; mkdir -p "$DEST"
  for item in "${SHIP[@]}"; do
    [ -e "$ROOT/$item" ] || { echo "Missing from the app folder: $item" >&2; exit 1; }
    /usr/bin/rsync -aR "${JUNK[@]}" "$ROOT/./$item" "$DEST/"
  done
  /usr/bin/rsync -a --exclude '*.zip' --exclude 'SHA256SUMS' "$B/dist/" "$DEST/dist/"
  /usr/bin/rsync -a "$WORK/deps/node_modules/" "$DEST/node_modules/"

  # Node, with npm (for someone who changes the code), checked twice: nodejs.org's sums and setup.sh's pin.
  TGZ="node-$NODE_VERSION-darwin-$ARCH.tar.gz"
  [ -f "$CACHE/$TGZ" ] || /usr/bin/curl -fsSL --retry 3 "https://nodejs.org/dist/$NODE_VERSION/$TGZ" -o "$CACHE/$TGZ"
  ( cd "$CACHE" && grep " $TGZ\$" "$SUMS" | /usr/bin/shasum -a 256 -c - >/dev/null ) \
    || { rm -f "$CACHE/$TGZ"; echo "Node download failed its checksum" >&2; exit 1; }
  [ "$(/usr/bin/shasum -a 256 "$CACHE/$TGZ" | cut -d' ' -f1)" = "$(pin "NODE_SHA_$ARCH")" ] \
    || { echo "Node $ARCH does not match the pin in setup.sh" >&2; exit 1; }
  mkdir -p "$DEST/runtime/node"
  P="node-$NODE_VERSION-darwin-$ARCH"
  /usr/bin/tar -xzf "$CACHE/$TGZ" -C "$DEST/runtime/node" --strip-components 1 "$P/bin/node" "$P/bin/npm" "$P/bin/npx" "$P/lib/node_modules/npm" "$P/LICENSE"
  want=x86_64; [ "$ARCH" = arm64 ] && want=arm64
  [[ "$(/usr/bin/file -b "$DEST/runtime/node/bin/node")" == *"$want"* ]] || { echo "Wrong processor type inside the $LABEL zip" >&2; exit 1; }
  echo "$ARCH" > "$DEST/runtime/ARCH"
  # Not "runtime/NODE": macOS folders are case-insensitive and that collides with runtime/node.
  printf 'node %s\npermascape-3d %s\n' "$NODE_VERSION" "$VER" > "$DEST/runtime/VERSIONS"

  # Nothing private or built-on-this-Mac may ride along (captured, never piped into grep -q under pipefail).
  BAD="$(find "$DEST" \( -name '.env*' -o -name '*.log' -o -name '.git' -o -name 'data' -o -name 'profile.json' -o -name 'Showcase Film' \) -not -path '*/runtime/node/*' -print)"
  [ -z "$BAD" ] || { echo "Refusing: private files are in the package:" >&2; echo "$BAD" >&2; exit 1; }
  LEAK="$(grep -rlF "$HOME/" "$DEST" --exclude-dir=runtime 2>/dev/null || true)"
  [ -z "$LEAK" ] || { echo "Refusing: these files name a folder on this Mac:" >&2; echo "$LEAK" >&2; exit 1; }
  # Words that must never ship can be listed in tools/private-words.txt (kept out of git).
  if [ -f "$ROOT/tools/private-words.txt" ]; then
    HITS="$(grep -rliwF -f "$ROOT/tools/private-words.txt" "$DEST" --exclude-dir=runtime --exclude-dir=node_modules --exclude='*.icns' --exclude='*.woff2' 2>/dev/null || true)"
    [ -z "$HITS" ] || { echo "Refusing: these files name something private:" >&2; echo "$HITS" >&2; exit 1; }
  fi

  chmod +x "$DEST/Start Permascape.command" "$DEST/scripts/"*.sh "$DEST/Start Permascape.app/Contents/MacOS/"*
  # The icon's seal must survive the copy (git does not keep it): verify it, re-seal if needed.
  /usr/bin/codesign --verify --strict "$DEST/Start Permascape.app" 2>/dev/null \
    || { /usr/bin/xattr -cr "$DEST/Start Permascape.app"; /usr/bin/codesign --force --deep --sign - "$DEST/Start Permascape.app" 2>/dev/null; }
  /usr/bin/codesign --verify --strict "$DEST/Start Permascape.app"

  ZIP="$OUT/$NAME ($LABEL).zip"; rm -f "$ZIP"
  ( cd "$WORK/$ARCH" && /usr/bin/ditto -c -k --sequesterRsrc --keepParent "$NAME" "$ZIP" )
  echo "   $(du -h "$ZIP" | cut -f1)  $ZIP"
done

( cd "$OUT" && /usr/bin/shasum -a 256 "$NAME ("*").zip" > SHA256SUMS )
echo "   $OUT/SHA256SUMS"
echo "   version $VER, Node $NODE_VERSION"
