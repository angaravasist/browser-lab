# Genuine Mozilla Firefox 115 ESR on the official SeleniumHQ Firefox 115 node (same Grid 4.51.0 / geckodriver 0.37.1).
# The official Selenium "115.0" image ships 115.0.3 from the RELEASE channel, which is not ESR evidence.
# The browser binary is downloaded from Mozilla at build time, signature-checked, and never redistributed by BrowserLab.
# Build (amd64 only; Mozilla publishes no Linux aarch64 build of 115 ESR):
#   docker compose -f compose.yaml -f compose.legacy-amd64.yaml build firefox-esr-image
FROM selenium/standalone-firefox:115.0-geckodriver-0.37-grid-4.51.0-20261010@sha256:cac2a022ca540b73a41cc40587a0c7a178267ac2b0d532c54d0b0c46d0d3e1a6

ARG FIREFOX_ESR=115.43.1esr
# Primary key of "Mozilla Software Releases <release@mozilla.com>"; SHA256SUMS must be signed by it.
ARG MOZILLA_RELEASE_KEY=14F26682D0916CDD81E37B6D61B7B526D98F0353
USER root
RUN set -eux; \
    base="https://archive.mozilla.org/pub/firefox/releases/${FIREFOX_ESR}"; \
    tarball="firefox-${FIREFOX_ESR}.tar.bz2"; \
    work="$(mktemp -d)"; cd "$work"; \
    curl -fsSL -o KEY "$base/KEY"; curl -fsSL -o SHA256SUMS "$base/SHA256SUMS"; curl -fsSL -o SHA256SUMS.asc "$base/SHA256SUMS.asc"; \
    curl -fsSL -o "$tarball" "$base/linux-x86_64/en-US/$tarball"; \
    export GNUPGHOME="$work/gnupg"; mkdir -m 700 "$GNUPGHOME"; gpg -q --import KEY; \
    gpg --status-fd 1 --verify SHA256SUMS.asc SHA256SUMS | grep -E "^\[GNUPG:\] VALIDSIG .* ${MOZILLA_RELEASE_KEY}$"; \
    grep " linux-x86_64/en-US/${tarball}\$" SHA256SUMS | sed "s# linux-x86_64/en-US/# #" | sha256sum -c -; \
    old="$(dirname "$(readlink -f "$(command -v firefox)")")"; new="/opt/firefox-${FIREFOX_ESR}"; \
    mkdir -p "$new"; tar -xjf "$tarball" -C "$new" --strip-components=1; chown -R root:root "$new"; \
    ln -sf "$new/firefox" "$(command -v firefox)"; rm -rf "$old"; cd /; rm -rf "$work"; \
    HOME=/root firefox --version | grep -q "^Mozilla Firefox ${FIREFOX_ESR}"; \
    grep -q '"app.update.channel", "esr"' "$new/defaults/pref/channel-prefs.js"; \
    echo "Installed $(HOME=/root firefox --version) at $new, channel=esr"
USER 1200
LABEL org.opencontainers.image.title="BrowserLab Firefox ${FIREFOX_ESR} node" \
      org.opencontainers.image.source="https://archive.mozilla.org/pub/firefox/releases/${FIREFOX_ESR}/" \
      org.opencontainers.image.description="Mozilla Firefox ESR on SeleniumHQ standalone-firefox 115 (Grid 4.51.0). Built locally; not redistributed."
