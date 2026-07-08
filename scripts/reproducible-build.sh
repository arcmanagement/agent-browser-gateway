#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${repo_root}"

export MISE_DATA_DIR="${MISE_DATA_DIR:-${repo_root}/.build/mise-data}"
export MISE_CACHE_DIR="${MISE_CACHE_DIR:-${repo_root}/.build/mise-cache}"
export XDG_STATE_HOME="${XDG_STATE_HOME:-${repo_root}/.build/xdg-state}"
export GNUPGHOME="${GNUPGHOME:-${repo_root}/.build/gnupg}"
mkdir -p "${MISE_DATA_DIR}" "${MISE_CACHE_DIR}" "${XDG_STATE_HOME}" "${GNUPGHOME}"
chmod 700 "${GNUPGHOME}"
pnpm_store_dir="${PNPM_STORE_DIR:-${repo_root}/.build/pnpm-store}"

node_pin="$(awk -F '"' '/^node = / { print $2 }' mise.toml)"
pnpm_pin="$(awk -F '"' '/^pnpm = / { print $2 }' mise.toml)"

tool_runner=()
if [[ "${ABG_REPRO_USE_SYSTEM_TOOLS:-0}" != "1" ]]; then
  if ! command -v mise >/dev/null 2>&1; then
    printf 'Missing required tool: mise. Run mise install, or set ABG_REPRO_USE_SYSTEM_TOOLS=1 to use PATH tools.\n' >&2
    exit 1
  fi
  tool_runner=(mise exec "node@${node_pin}" "pnpm@${pnpm_pin}" --)
fi

run_tool() {
  "${tool_runner[@]}" "$@"
}

version="${VERSION:-$(run_tool node -e 'console.log(JSON.parse(require("fs").readFileSync("extension/package.json", "utf8")).version)')}"
out_dir="${ABG_REPRO_OUT:-${repo_root}/dist/reproducible-build}"
source_date_epoch="${SOURCE_DATE_EPOCH:-$(git -C "${repo_root}" log -1 --format=%ct)}"
swift_flags="${SWIFT_BUILD_FLAGS:--Xswiftc -file-prefix-map -Xswiftc ${repo_root}=. -Xcc -ffile-prefix-map=${repo_root}=. -Xcc -fmacro-prefix-map=${repo_root}=. -Xcxx -ffile-prefix-map=${repo_root}=. -Xcxx -fmacro-prefix-map=${repo_root}=.}"

require_tool() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required tool: %s\n' "$1" >&2
    exit 1
  fi
}

portable_touch_epoch() {
  local file="$1"
  local stamp
  if stamp="$(date -u -r "${source_date_epoch}" '+%Y%m%d%H%M.%S' 2>/dev/null)"; then
    touch -t "${stamp}" "${file}"
  else
    stamp="$(date -u -d "@${source_date_epoch}" '+%Y%m%d%H%M.%S')"
    touch -t "${stamp}" "${file}"
  fi
}

normalize_tree_mtime() {
  local dir="$1"
  while IFS= read -r -d '' file; do
    portable_touch_epoch "${file}"
  done < <(find "${dir}" -print0)
}

zip_dir_deterministic() {
  local source_dir="$1"
  local zip_path="$2"
  rm -f "${zip_path}"
  (
    cd "${source_dir}"
    find . -type f | LC_ALL=C sort | sed 's#^\./##' | zip -X -q "${zip_path}" -@
  )
  portable_touch_epoch "${zip_path}"
}

require_tool shasum
require_tool zip
run_tool node --version >/dev/null
run_tool pnpm --version >/dev/null

rm -rf "${out_dir}"
mkdir -p "${out_dir}"
mkdir -p "${repo_root}/.build/clang-module-cache" "${repo_root}/.build/swiftpm-cache"

export CLANG_MODULE_CACHE_PATH="${CLANG_MODULE_CACHE_PATH:-${repo_root}/.build/clang-module-cache}"
export SWIFTPM_CACHE_PATH="${SWIFTPM_CACHE_PATH:-${repo_root}/.build/swiftpm-cache}"

printf '==> write build inputs\n'
{
  printf 'version=%s\n' "${version}"
  printf 'git_commit=%s\n' "$(git rev-parse HEAD)"
  printf 'source_date_epoch=%s\n' "${source_date_epoch}"
  printf 'swift_build_flags=%s\n' "${swift_flags}"
  printf 'node_version=%s\n' "$(run_tool node --version)"
  printf 'pnpm_version=%s\n' "$(run_tool pnpm --version)"
  if command -v swift >/dev/null 2>&1; then
    printf 'swift_version=%s\n' "$(swift --version 2>&1 | head -1)"
  fi
  printf '\n[mise]\n'
  cat mise.toml
  printf '\n[global.json]\n'
  cat global.json
} > "${out_dir}/BUILD_INPUTS.txt"
portable_touch_epoch "${out_dir}/BUILD_INPUTS.txt"

printf '==> build Chrome extension zip\n'
CI=true run_tool pnpm \
  --store-dir "${pnpm_store_dir}" \
  --dir extension install \
  --frozen-lockfile
(
  cd extension
  SOURCE_DATE_EPOCH="${source_date_epoch}" "${tool_runner[@]}" pnpm run build
)
normalize_tree_mtime "${repo_root}/extension/dist"
zip_dir_deterministic "${repo_root}/extension/dist" "${out_dir}/agent-browser-gateway-extension-${version}.zip"

if [[ "${ABG_REPRO_SKIP_GATEWAY:-0}" != "1" ]]; then
  require_tool swift
  printf '==> build unsigned Gateway and abg release products\n'
  SOURCE_DATE_EPOCH="${source_date_epoch}" SWIFT_BUILD_FLAGS="${swift_flags}" swift build -c release --product abg --disable-sandbox
  SOURCE_DATE_EPOCH="${source_date_epoch}" SWIFT_BUILD_FLAGS="${swift_flags}" swift build -c release --product Gateway --disable-sandbox
  cp ".build/release/abg" "${out_dir}/abg-$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m)"
  cp ".build/release/Gateway" "${out_dir}/Gateway-$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m)"
  portable_touch_epoch "${out_dir}/abg-$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m)"
  portable_touch_epoch "${out_dir}/Gateway-$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m)"
else
  printf '==> skip Gateway products because ABG_REPRO_SKIP_GATEWAY=1\n'
fi

if [[ "${ABG_REPRO_INCLUDE_DOCKER:-0}" == "1" ]]; then
  printf '==> build pinned Docker Linux CLI artifact\n'
  ABG_REPRO_OUT="${out_dir}/docker-linux-cli" SOURCE_DATE_EPOCH="${source_date_epoch}" bash scripts/repro-docker-build.sh
fi

printf '==> write SBOM and checksums\n'
run_tool node scripts/write-release-sbom.mjs "${repo_root}" "${out_dir}" "${out_dir}/agent-browser-gateway-${version}.spdx.json" "${version}"
portable_touch_epoch "${out_dir}/agent-browser-gateway-${version}.spdx.json"
(
  cd "${out_dir}"
  find . -maxdepth 1 -type f ! -name 'SHA256SUMS.txt' -print | LC_ALL=C sort | sed 's#^\./##' | xargs shasum -a 256 > SHA256SUMS.txt
)
portable_touch_epoch "${out_dir}/SHA256SUMS.txt"

printf 'Wrote reproducible build outputs to %s\n' "${out_dir}"
find "${out_dir}" -maxdepth 1 -type f -print | LC_ALL=C sort
