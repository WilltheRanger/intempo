#!/usr/bin/env bash
#
# Build Audiveris and print the two environment variables that switch it on.
#
#     backend/scripts/install-audiveris.sh              # into ~/.local/audiveris
#     backend/scripts/install-audiveris.sh /opt/omr     # somewhere else
#
# Everything here is a workaround for something that bit during the first
# build, so nothing in it is decorative:
#
#   * v5.4, not the latest. Every release from 5.9 onward targets Java 25 and
#     most machines have 21. If you have a JDK 25, `AUDIVERIS_TAG=5.11.0` works
#     and is preferable.
#
#   * `javax.media:jai-core` is removed. It is a declared dependency served
#     only from repository.jboss.org, which some networks block outright, and
#     its sole trace in the Audiveris source is the property-key *string*
#     "com.sun.media.jai.disableMediaLib" — not an API call. The maintained
#     fork jai-imageio-core is already a dependency. If your network can reach
#     jboss, `KEEP_JAI=1` leaves it alone.
#
#   * Audiveris refuses images over 20 megapixels outright. A phone photo is
#     routinely 24-48MP, so anything shot on a phone must be scaled down before
#     it reaches the engine. The provider reports the refusal in Audiveris's own
#     words when it happens.
set -euo pipefail

PREFIX="${1:-$HOME/.local/audiveris}"
TAG="${AUDIVERIS_TAG:-v5.4}"
SRC="$PREFIX/src"

command -v java >/dev/null || { echo "no java on PATH — install a JDK 21 first" >&2; exit 1; }
JAVA_MAJOR="$(java -version 2>&1 | sed -n 's/.*version "\([0-9]*\).*/\1/p' | head -1)"
echo "java $JAVA_MAJOR · building Audiveris $TAG into $PREFIX"

mkdir -p "$PREFIX"
if [ ! -d "$SRC/.git" ]; then
  git clone --depth 1 --branch "$TAG" https://github.com/Audiveris/audiveris "$SRC"
else
  git -C "$SRC" fetch --depth 1 origin "$TAG" && git -C "$SRC" checkout -q FETCH_HEAD
fi

if [ -z "${KEEP_JAI:-}" ]; then
  # Both spellings: 5.4 lists dependencies as maps, later versions as strings.
  sed -i.bak \
    -e "/\[group: 'javax.media', name: 'jai-core', version: '1.1.3'\],/d" \
    -e '/"javax.media:jai-core:1.1.3",/d' \
    "$SRC/app/build.gradle"
fi

( cd "$SRC" && ./gradlew --no-daemon -q installDist )

BIN="$(find "$SRC/app/build/install" -maxdepth 3 -type f -name Audiveris | head -1)"
[ -n "$BIN" ] || { echo "build finished but no Audiveris launcher was produced" >&2; exit 1; }

cat <<EOF

Built: $BIN

Add these to backend/.env — the second one is not optional, the argument shape
differs from every other engine:

  OMR_COMMAND=$BIN
  OMR_ARGS=-batch -export -output {out} -- {image}

Check it with:

  cd backend && uv run python scripts/read_page.py YOUR_PHOTO.png --provider omr-local

Remember the 20-megapixel ceiling: scale a phone photo down first, or the
engine refuses the page.
EOF
