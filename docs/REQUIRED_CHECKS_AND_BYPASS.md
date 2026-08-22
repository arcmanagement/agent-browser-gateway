# Required Checks and Emergency Bypass

Captured from GitHub on 2026-06-06.

## Current Repository State

`main` is protected by a repository ruleset rather than classic branch protection.

Evidence commands:

```bash
gh api repos/arcmanagement/agent-browser-gateway/branches/main \
  --jq '{name,protected,protection_url}'

gh api repos/arcmanagement/agent-browser-gateway/rulesets/15909681 \
  --jq '{id,name,target,enforcement,bypass_actors,conditions,rules}'
```

Observed state:

- Branch `main` reports `protected: true`.
- Active ruleset: `main branch protection (brain managed)`.
- Ruleset target: default branch.
- Rules enforced today: deletion prevention, non-fast-forward prevention, and pull-request-only updates.
- Bypass actors: none.
- Required status checks are not currently configured in the active ruleset.
- The classic branch-protection endpoint returns `Branch not protected`; use repository rulesets as the source of truth.

Because no required status-check rule is currently configured, a failing-check PR cannot yet be
proven blocked by GitHub branch protection. Required status checks should be enabled only after the
CI workflows that produce them are reliable on pull requests.

## Target Required Checks

The PR test gates are defined in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml):

| GitHub Actions field | Swift gate | Extension gate |
| --- | --- | --- |
| Workflow | `CI` | `CI` |
| Job ID | `swift-tests` | `extension-tests` |
| Job name | `Swift tests` | `Extension tests` |
| Required-check display name | `CI / Swift tests` | `CI / Extension tests` |
| Runner | `macos-latest` | `ubuntu-latest` |

The gates run these test commands:

```bash
swift test --enable-code-coverage
scripts/swift-coverage-check.sh
cd extension && pnpm run test:coverage
```

plus the Swift debug build and the extension typecheck, lint, and build checks. Swift XCTest
completion is tracked by [#89](https://github.com/arcmanagement/agent-browser-gateway/issues/89),
extension Vitest completion by
[#90](https://github.com/arcmanagement/agent-browser-gateway/issues/90), and their combined test
gate by [#25](https://github.com/arcmanagement/agent-browser-gateway/issues/25).

When required checks are enabled under
[#23](https://github.com/arcmanagement/agent-browser-gateway/issues/23), require `CI / Swift tests`
and `CI / Extension tests`. Both jobs run unconditionally on every pull request, so a required rule
on them never waits on a skipped job. The other CI jobs stay out of the required set: release-only,
tag-only, notarization, Pages deployment, and manual `workflow_dispatch` jobs are release gates,
and the path-gated auxiliary jobs below are intentionally skipped on unrelated PRs.

## CI Cost Policy

Recorded under [#94](https://github.com/arcmanagement/agent-browser-gateway/issues/94). Before the
2026-08 split, every pull request started three `macos-latest` jobs (aggregate verify, release
artifact smoke, dependency inventory); a representative run took about 14 minutes of wall time with
all three billed at the macOS multiplier, and the release configuration was built twice (once in
verify, once inside `make dist`).

Policy:

- `swift-tests` is the only unconditional macOS job. `extension-tests` runs the Node toolchain on
  `ubuntu-latest`.
- `release-artifact-smoke` runs `make dist` (which includes the Swift release build) only when
  build-relevant paths change (`Sources/**`, `Tests/**`, `Package.*`, `extension/**`, `scripts/**`,
  `packaging/**`, `Makefile`, `build-app.sh`, the workflow itself) or on manual dispatch, so
  docs-only PRs skip it. The standalone `swift build -c release` step was removed from the PR gate
  as redundant with `make dist`.
- `swift-dependency-inventory` runs only when `Package.swift` or `Package.resolved` change, or on
  manual dispatch.
- PRs targeting any base branch use the same policy; full verification happens on the PR that
  finally targets `main` because the two protection gates always run.

## Verification Runbook

Use this runbook after the required status-check rule is added.

### Green PR

1. Open a small PR against `main`.
2. Wait for all required checks to finish.
3. Confirm the PR reports a mergeable state and the merge button is enabled.
4. Merge only after the PR has the expected issue link, labels, milestone, and review state.

Useful checks:

```bash
gh pr view <pr> --json mergeStateStatus,statusCheckRollup,reviewDecision
gh pr checks <pr>
```

### Failing-Check PR

1. Open a temporary PR with a deliberate failing test or failing lint fixture.
2. Wait for the required check to fail.
3. Confirm the PR cannot be merged through the GitHub UI.
4. Record the failed check name and PR URL in the governance issue.
5. Close the temporary PR without merging and delete the branch.

Do not leave deliberate-failure branches open after verification.

## Emergency Admin Bypass Policy

Emergency bypass is only acceptable when all of these are true:

- The change is needed to restore a broken release, fix a security issue, or unblock a production-impacting incident.
- Waiting for the normal required-check path would create more risk than the bypass.
- The exact skipped check, commit SHA, reason, and reviewer/operator are recorded on the PR or incident issue.
- A follow-up PR or issue exists to restore normal CI/branch-protection health.

Emergency bypass is not acceptable for convenience, routine release speed, flaky checks without a
recorded root-cause plan, or changes that can wait for the normal required checks.

Preferred record format:

```markdown
Emergency bypass used on <YYYY-MM-DD>.

- Commit: <sha>
- Reason:
- Skipped/failed check:
- Risk:
- Approval:
- Follow-up:
```
