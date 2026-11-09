#!/bin/sh
# Install Aurifex into every detected host (OMP, DSH, Claude Code).
#
#   curl -fsSL https://raw.githubusercontent.com/lukavtz/aurifex/main/install.sh | sh
#
# Environment:
#   AURIFEX_REF         git ref to download (default: main)
#   AURIFEX_HOME        persistent install root (default: ~/.aurifex)
#   AURIFEX_SOURCE_DIR  use an existing checkout instead of downloading
#   AURIFEX_DRY_RUN=1   print the planned host commands without running them
set -eu

REPO="lukavtz/aurifex"
REF="${AURIFEX_REF:-main}"
HOME_DIR="${AURIFEX_HOME:-$HOME/.aurifex}"
PERSIST_DIR="$HOME_DIR/src"
SOURCE_DIR="${AURIFEX_SOURCE_DIR:-}"
DRY_RUN="${AURIFEX_DRY_RUN:-0}"
TMP_DIR=""

say() {
  printf '%s\n' "$*"
}

fail() {
  printf 'aurifex install: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  # Only the download scratch directory is temporary; the install root persists.
  if [ -n "$TMP_DIR" ] && [ -d "$TMP_DIR" ]; then
    rm -rf "$TMP_DIR"
  fi
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

command -v node >/dev/null 2>&1 ||
  fail "Node.js was not found. Install Node.js >= 24.9 from https://nodejs.org/ and retry."
command -v npm >/dev/null 2>&1 ||
  fail "npm was not found. npm ships with Node.js; reinstall Node.js >= 24.9 and retry."

NODE_VERSION=$(node -e 'process.stdout.write(process.versions.node)' 2>/dev/null) ||
  fail "could not read the Node.js version; reinstall Node.js >= 24.9 and retry."
NODE_MAJOR=${NODE_VERSION%%.*}
NODE_REST=${NODE_VERSION#*.}
NODE_MINOR=${NODE_REST%%.*}
case "$NODE_MAJOR" in
  '' | *[!0-9]*) fail "unexpected Node.js version: $NODE_VERSION" ;;
esac
case "$NODE_MINOR" in
  '' | *[!0-9]*) fail "unexpected Node.js version: $NODE_VERSION" ;;
esac
if [ "$NODE_MAJOR" -lt 24 ] || { [ "$NODE_MAJOR" -eq 24 ] && [ "$NODE_MINOR" -lt 9 ]; }; then
  fail "Node.js >= 24.9 is required (found $NODE_VERSION). Update Node.js from https://nodejs.org/ and retry."
fi

if [ -z "$SOURCE_DIR" ]; then
  command -v curl >/dev/null 2>&1 ||
    fail "curl was not found. Install curl and retry."
  command -v tar >/dev/null 2>&1 ||
    fail "tar was not found. Install tar and retry."
  if [ "$REF" != "main" ] &&
    [ -f "$PERSIST_DIR/package.json" ] &&
    [ "$(cat "$PERSIST_DIR/.aurifex-ref" 2>/dev/null || true)" = "$REF" ]; then
    say "Using existing Aurifex checkout: $PERSIST_DIR ($REF)"
    SOURCE_DIR="$PERSIST_DIR"
  else
    mkdir -p "$HOME_DIR"
    TMP_DIR=$(mktemp -d "$HOME_DIR/.download.XXXXXX") ||
      fail "could not create a staging directory in $HOME_DIR."
    say "Downloading $REPO@$REF..."
    curl -fsSL "https://codeload.github.com/$REPO/tar.gz/$REF" -o "$TMP_DIR/aurifex.tar.gz" ||
      fail "failed to download $REPO@$REF from GitHub."
    mkdir -p "$TMP_DIR/src"
    tar -xzf "$TMP_DIR/aurifex.tar.gz" -C "$TMP_DIR/src" --strip-components=1 ||
      fail "failed to extract the downloaded archive."
    printf '%s\n' "$REF" >"$TMP_DIR/src/.aurifex-ref"
    BACKUP_DIR=""
    if [ -d "$PERSIST_DIR" ]; then
      BACKUP_DIR="$TMP_DIR/previous-src"
      mv "$PERSIST_DIR" "$BACKUP_DIR" || fail "could not stage the existing checkout for replacement."
    fi
    if ! mv "$TMP_DIR/src" "$PERSIST_DIR"; then
      if [ -n "$BACKUP_DIR" ] && [ -d "$BACKUP_DIR" ]; then
        mv "$BACKUP_DIR" "$PERSIST_DIR" || true
      fi
      fail "could not move the checkout to $PERSIST_DIR."
    fi
    SOURCE_DIR="$PERSIST_DIR"
  fi
fi

[ -f "$SOURCE_DIR/package.json" ] ||
  fail "no package.json in $SOURCE_DIR; refusing to install."

if [ ! -f "$SOURCE_DIR/dist/cli.js" ]; then
  say "Building Aurifex..."
  (cd "$SOURCE_DIR" && npm install --silent --no-audit --no-fund) || fail "npm install failed in $SOURCE_DIR."
fi
[ -f "$SOURCE_DIR/dist/cli.js" ] ||
  fail "the build did not produce dist/cli.js in $SOURCE_DIR."

set -- install --source "$SOURCE_DIR"
if [ -n "${AURIFEX_HOSTS:-}" ]; then
  set -- "$@" --host "$AURIFEX_HOSTS"
fi
if [ -n "${AURIFEX_SCOPE:-}" ]; then
  set -- "$@" --scope "$AURIFEX_SCOPE"
fi
if [ "${AURIFEX_YES:-0}" = "1" ]; then
  set -- "$@" --yes
fi
if [ "$DRY_RUN" = "1" ]; then
  set -- "$@" --dry-run
fi
(cd "$SOURCE_DIR" && node dist/cli.js "$@") || fail "aurifex install failed."

if [ "$DRY_RUN" != "1" ]; then
  case "$SOURCE_DIR" in
    *'"'* | *'
'*) fail "install path contains an unsafe character for the launcher." ;;
  esac
  BIN_DIR="${AURIFEX_BIN_DIR:-$HOME/.local/bin}"
  mkdir -p "$BIN_DIR" || fail "could not create $BIN_DIR."
  cat >"$BIN_DIR/aurifex" <<EOF
#!/bin/sh
exec node "$SOURCE_DIR/dist/cli.js" "\$@"
EOF
  chmod 755 "$BIN_DIR/aurifex" || fail "could not make $BIN_DIR/aurifex executable."
  case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *) say "Add $BIN_DIR to PATH to run 'aurifex' directly." ;;
  esac
  say "Installed CLI: $BIN_DIR/aurifex"
fi