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

When required checks are enabled, keep the required set small and tied to stable PR-triggered jobs:

- macOS Swift build and `swift test`
- extension dependency install with frozen lockfile
- extension `pnpm run typecheck`
- extension `pnpm run lint`
- extension `pnpm run build`
- extension `pnpm run test` after the Vitest test script lands

Do not require release-only, tag-only, notarization, Pages deployment, or manual `workflow_dispatch`
jobs. Those are release gates, not ordinary PR merge gates.

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
