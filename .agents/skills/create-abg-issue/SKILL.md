---
name: create-abg-issue
description: Use in the Agent Browser Gateway repository when creating, updating, triaging, or linking Issues so ABG-specific assignees, labels, Issue Type, project fields, milestones, parent/sub-issue relationships, development links, and English wording are set accurately.
metadata:
  internal: true
---

# Create ABG Issue

Use this skill only in the Agent Browser Gateway repository for Issue creation, update, triage, or metadata cleanup.

Before applying metadata, read `../_shared/abg-issue-pr-metadata.md`.

## Workflow

1. Confirm the target repository and Issue scope.
2. Search for existing Issues before creating a new one.
3. Write or update the Issue title/body in English unless the user explicitly asks otherwise.
4. Set the right Issue Type, usually `Task` for bounded implementation or workflow-rule work.
5. Apply labels from the existing ABG taxonomy for kind, type, area, track, phase, priority, size, and relevant domain labels.
6. Assign `ringomax` unless a different owner is clearly specified.
7. Add the Issue to `Agent Browser Gateway Roadmap` when it belongs to roadmap, governance, release, docs, agent, or project-management work.
8. Set project fields to match labels: `Status`, `Track`, `Phase`, `Priority`, and `Size`.
9. Set the milestone that matches the schedule and track.
10. Add parent/sub-issue relationships when the Issue belongs under an epic, checklist, or governance baseline.
11. Link a branch or PR in Development when implementation already exists or is being created.
12. Verify the resulting metadata instead of assuming the platform accepted every update.

## Verification

Use these commands as needed:

```bash
gh issue view <issue> --json labels,milestone,assignees,projectItems
gh api graphql -f query='<query issueType, parent, and project field values>'
```

If a metadata field cannot be set from the available tools, say which field is missing and why.
