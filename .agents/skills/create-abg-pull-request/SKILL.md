---
name: create-abg-pull-request
description: Use in the Agent Browser Gateway repository when creating, publishing, updating, or metadata-fixing Pull Requests so linked Issues, close/reference semantics, labels, milestones, assignees, draft/open state, base/head branches, validation, and ABG English wording are handled accurately.
metadata:
  internal: true
---

# Create ABG Pull Request

Use this skill only in the Agent Browser Gateway repository for Pull Request creation, publication, update, or metadata cleanup.

Before applying metadata, read `../_shared/abg-issue-pr-metadata.md`.

## Workflow

1. Inspect the working tree and intended diff before staging.
2. Identify the linked Issue, if any, and read its acceptance criteria.
3. Preserve the user-requested base branch; otherwise use the repository default branch.
4. Keep commits intentionally scoped. If the user asks for topic-based commits, split them before pushing.
5. Default to Draft PR unless the user asks for Open or Ready for review.
6. Use `Closes #...` only when the PR fully satisfies the Issue; otherwise use `Related to #...` or a plain reference.
7. Write the PR title/body in English unless the user explicitly asks otherwise.
8. Include summary, impact, validation, and the Issue link or closing reference in the PR body.
9. Assign `ringomax` when the PR is user-owned or follows an Issue assigned to `ringomax`.
10. Apply labels and milestone consistently with the linked Issue, excluding stale state labels that no longer apply.
11. Add the PR to a project only if the repository tracks PRs in that project for this work; otherwise ensure the linked Issue is in the project and has the right status.
12. When an active PR implements an Issue, set the linked Issue project status to `In Progress`.
13. Verify the PR metadata and linked Issue state after creation or update.

## Verification

Use these commands as needed:

```bash
git diff --check
git status --short --branch
gh pr view <pr> --json labels,milestone,assignees,closingIssuesReferences,isDraft,baseRefName,headRefName
gh issue view <issue> --json closedByPullRequestsReferences,projectItems
```

If a PR started as partial but later satisfies the Issue, update the PR body from a non-closing reference to `Closes #...` and verify `closingIssuesReferences`.
