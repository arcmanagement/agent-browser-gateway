#!/usr/bin/env bash
set -euo pipefail

event_name="${GITHUB_EVENT_NAME:-}"
base_ref="${GITHUB_BASE_REF:-}"
ref_name="${GITHUB_REF_NAME:-}"
base_sha="${PR_BASE_SHA:-}"
head_sha="${PR_HEAD_SHA:-${GITHUB_SHA:-}}"
default_branch="${DEFAULT_BRANCH:-main}"

run_swift=false
run_extension=false
full_verification=false
reason=""
changed_files=""

write_output() {
  local key="$1"
  local value="$2"

  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    printf '%s=%s\n' "$key" "$value" >> "$GITHUB_OUTPUT"
  else
    printf '%s=%s\n' "$key" "$value"
  fi
}

mark_changed_areas() {
  local file

  while IFS= read -r file; do
    [ -n "$file" ] || continue

    case "$file" in
      .github/workflows/ci.yml|scripts/ci-change-policy.sh|scripts/ci-change-policy-test.sh)
        run_swift=true
        run_extension=true
        ;;
      Package.swift|Package.resolved|Sources/*|Tests/*|scripts/swift-coverage-check.sh)
        run_swift=true
        ;;
      extension/*)
        run_extension=true
        ;;
    esac
  done <<< "$changed_files"
}

if [ "$event_name" = "pull_request" ] && [ "$base_ref" = "$default_branch" ]; then
  run_swift=true
  run_extension=true
  full_verification=true
  reason="PR targets ${default_branch}, so full verification is required before merge."
elif [ "$event_name" = "push" ] && [ "$ref_name" = "$default_branch" ]; then
  run_swift=true
  run_extension=true
  full_verification=true
  reason="Push reached ${default_branch}, so full verification is required."
elif [ "$event_name" = "workflow_dispatch" ]; then
  run_swift=true
  run_extension=true
  full_verification=true
  reason="Manual dispatch always runs full verification."
elif [ "$event_name" = "pull_request" ]; then
  if [ -n "$base_sha" ] && [ -n "$head_sha" ]; then
    changed_files="$(git diff --name-only "$base_sha" "$head_sha")"
  else
    changed_files="$(git diff --name-only "origin/${default_branch}...HEAD")"
  fi

  mark_changed_areas

  if [ "$run_swift" = false ] && [ "$run_extension" = false ]; then
    reason="Non-${default_branch} PR changed no Swift, extension, or CI policy paths."
  else
    reason="Non-${default_branch} PR runs only checks for changed implementation areas."
  fi
else
  run_swift=true
  run_extension=true
  full_verification=true
  reason="Unknown CI trigger, so full verification is the conservative default."
fi

summary="CI policy: ${reason}

- event: ${event_name:-unknown}
- base_ref: ${base_ref:-n/a}
- ref_name: ${ref_name:-n/a}
- run_swift: ${run_swift}
- run_extension: ${run_extension}
- full_verification: ${full_verification}"

if [ -n "$changed_files" ]; then
  summary="${summary}
- changed_files:
$(printf '%s\n' "$changed_files" | sed 's/^/  - /')"
fi

write_output "run_swift" "$run_swift"
write_output "run_extension" "$run_extension"
write_output "full_verification" "$full_verification"

printf '%s\n' "$summary"

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  printf '%s\n' "$summary" >> "$GITHUB_STEP_SUMMARY"
fi
