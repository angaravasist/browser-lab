#!/usr/bin/env bash
# Picks the generated Grid TOML for this CPU architecture and profile, enforces image digest pins,
# then hands over to the upstream Selenium entrypoint. Fails closed: Grid does not start with an unpinned image.
set -euo pipefail
case "$(uname -m)" in
  x86_64) arch=amd64 ;;
  aarch64|arm64) arch=arm64 ;;
  *) echo "BrowserLab: unsupported grid architecture $(uname -m)" >&2; exit 1 ;;
esac
profile="${BROWSERLAB_GRID_PROFILE:-default}"
file="grid-${profile}-${arch}.toml"
toml="/opt/selenium/${file}"
if [ ! -f "${toml}" ]; then
  echo "BrowserLab: no browser catalogue for profile '${profile}' on ${arch} (${file})." >&2
  exit 1
fi

api() { sudo curl -sf --unix-socket /var/run/docker.sock "$@"; }
api http://d/_ping >/dev/null || { echo "BrowserLab: Docker socket not reachable from grid (DOCKER_NOT_RUNNING)." >&2; exit 1; }

while read -r _ kind image ref; do
  repo="${image%:*}"; tag="${image##*:}"
  if [ "${kind}" = local ]; then
    api "http://d/images/${image}/json" >/dev/null || { echo "BrowserLab: local image ${image} missing; build it from ${ref}." >&2; exit 1; }
    continue
  fi
  if api "http://d/images/${image}/json" | grep -q "\"${repo}@${ref}\""; then
    echo "BrowserLab: ${image} pinned at ${ref}"
    continue
  fi
  echo "BrowserLab: pulling ${repo}@${ref} (first start can take several minutes)"
  out="$(api -X POST "http://d/images/create?fromImage=${repo}&tag=${ref}")" || { echo "BrowserLab: pull failed for ${repo}@${ref}" >&2; exit 1; }
  if grep -q '"error"' <<<"${out}"; then echo "BrowserLab: pull failed for ${repo}@${ref}: $(grep -o '"error":"[^"]*"' <<<"${out}" | head -1)" >&2; exit 1; fi
  api -X POST "http://d/images/${repo}@${ref}/tag?repo=${repo}&tag=${tag}" >/dev/null || { echo "BrowserLab: could not tag ${repo}@${ref}" >&2; exit 1; }
  api "http://d/images/${image}/json" | grep -q "\"${repo}@${ref}\"" || { echo "BrowserLab: ${image} does not resolve to pinned ${ref}" >&2; exit 1; }
  echo "BrowserLab: ${image} pinned at ${ref}"
done < <(grep -E '^# (pin|local) ' "${toml}")

export SE_NODE_DOCKER_CONFIG_FILENAME="${file}"
exec /opt/bin/entry_point.sh
