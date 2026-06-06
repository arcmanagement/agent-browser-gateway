#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image="${ABG_REPRO_IMAGE:-agent-browser-gateway-repro:local}"
out_dir="${ABG_REPRO_OUT:-${repo_root}/dist/reproducible-docker}"
source_date_epoch="${SOURCE_DATE_EPOCH:-$(git -C "${repo_root}" log -1 --format=%ct)}"

if [[ -n "${ABG_REPRO_PLATFORM:-}" ]]; then
  docker build \
    --pull=false \
    --platform "${ABG_REPRO_PLATFORM}" \
    --build-arg "SOURCE_DATE_EPOCH=${source_date_epoch}" \
    --file "${repo_root}/Dockerfile.repro" \
    --tag "${image}" \
    "${repo_root}"
else
  docker build \
    --pull=false \
    --build-arg "SOURCE_DATE_EPOCH=${source_date_epoch}" \
    --file "${repo_root}/Dockerfile.repro" \
    --tag "${image}" \
    "${repo_root}"
fi

container="$(docker create "${image}")"
cleanup() {
  docker rm -f "${container}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

rm -rf "${out_dir}"
mkdir -p "${out_dir}"
docker cp "${container}:/out/." "${out_dir}/"

printf 'Wrote reproducible Docker build outputs to %s\n' "${out_dir}"
find "${out_dir}" -maxdepth 1 -type f -print | sort
