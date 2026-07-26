#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
policy_script="${script_dir}/ci-change-policy.sh"
test_repo="$(mktemp -d)"
output_file="${test_repo}/policy-output"

cleanup() {
  find "$test_repo" -depth -delete
}
trap cleanup EXIT

fail() {
  printf 'ci-change-policy-test: %s\n' "$1" >&2
  exit 1
}

output_value() {
  local key="$1"
  awk -F= -v key="$key" '$1 == key { print $2 }' "$output_file"
}

assert_output() {
  local scenario="$1"
  local key="$2"
  local expected="$3"
  local actual

  actual="$(output_value "$key")"
  if [ "$actual" != "$expected" ]; then
    fail "${scenario}: expected ${key}=${expected}, got ${actual:-missing}"
  fi
}

run_policy() {
  local scenario="$1"
  local event_name="$2"
  local base_ref="$3"
  local ref_name="$4"
  local base_sha="$5"
  local head_sha="$6"
  local expected_swift="$7"
  local expected_extension="$8"
  local expected_full="$9"

  : > "$output_file"
  (
    cd "$test_repo"
    GITHUB_EVENT_NAME="$event_name" \
      GITHUB_BASE_REF="$base_ref" \
      GITHUB_REF_NAME="$ref_name" \
      PR_BASE_SHA="$base_sha" \
      PR_HEAD_SHA="$head_sha" \
      DEFAULT_BRANCH=main \
      GITHUB_OUTPUT="$output_file" \
      "$policy_script" >/dev/null
  )

  assert_output "$scenario" run_swift "$expected_swift"
  assert_output "$scenario" run_extension "$expected_extension"
  assert_output "$scenario" full_verification "$expected_full"
}

git -C "$test_repo" init --quiet
git -C "$test_repo" config user.name "CI Policy Test"
git -C "$test_repo" config user.email "ci-policy@example.com"
printf 'base\n' > "${test_repo}/README.md"
git -C "$test_repo" add README.md
git -C "$test_repo" commit --quiet -m "Create base"
base_sha="$(git -C "$test_repo" rev-parse HEAD)"

mkdir -p "${test_repo}/extension"
printf 'export {};\n' > "${test_repo}/extension/example.ts"
git -C "$test_repo" add extension/example.ts
git -C "$test_repo" commit --quiet -m "Change extension"
extension_sha="$(git -C "$test_repo" rev-parse HEAD)"

run_policy "main push" push "" main "" "" true true true
run_policy "main-targeting PR" pull_request main feature "" "" true true true
run_policy \
  "non-main extension-only PR" \
  pull_request \
  stacked-base \
  feature \
  "$base_sha" \
  "$extension_sha" \
  false \
  true \
  false

printf 'policy\n' >> "${test_repo}/scripts-ci-policy-placeholder"
git -C "$test_repo" add scripts-ci-policy-placeholder
git -C "$test_repo" commit --quiet -m "Prepare policy path"
policy_base_sha="$(git -C "$test_repo" rev-parse HEAD)"
mkdir -p "${test_repo}/scripts"
printf '#!/usr/bin/env bash\n' > "${test_repo}/scripts/ci-change-policy-test.sh"
git -C "$test_repo" add scripts/ci-change-policy-test.sh
git -C "$test_repo" commit --quiet -m "Change CI policy"
policy_head_sha="$(git -C "$test_repo" rev-parse HEAD)"

run_policy \
  "non-main CI policy PR" \
  pull_request \
  stacked-base \
  feature \
  "$policy_base_sha" \
  "$policy_head_sha" \
  true \
  true \
  false

printf 'ci-change-policy-test: all scenarios passed\n'
