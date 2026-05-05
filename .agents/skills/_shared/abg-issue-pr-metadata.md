# ABG Issue and PR Metadata Reference

This reference is shared by the `create-abg-issue` and `create-abg-pull-request` skills.

## Repository Defaults

- Write Issue titles, Issue bodies, PR titles, and PR bodies in English unless the user explicitly asks otherwise.
- Default assignee is `ringomax` when work is owned by the user or no other owner is specified.
- Use the `Agent Browser Gateway Roadmap` project for roadmap or workflow-governance work.
- Keep `.agents/skills/` as the canonical skill location. `.claude/skills` is a symlink to `.agents/skills`, so Claude Code and Codex read the same resources.

## Issue Types

Use the existing repository Issue Types:

- `Epic`: parent issue for a roadmap theme.
- `Feature`: user-facing capability or product feature.
- `Task`: bounded implementation, documentation, or workflow-rule work.
- `Decision`: owner or architecture decision required before implementation.
- `Spike`: research or feasibility investigation.
- `Bug`: unexpected broken behavior.

## Project Fields

For `Agent Browser Gateway Roadmap`, keep labels and project custom fields aligned:

- `Status`: `Todo`, `In Progress`, or `Done`.
- `Track`: `Launch`, `Legal`, `Governance`, `Desktop OS`, `Desktop Browser`, `Mobile WebView`, `Agent Protocol`, `Gateway UX`, or `Reproducibility`.
- `Phase`: `Now`, `Next`, `Later`, `Phase 3`, `Phase 4`, or `v1.0`.
- `Priority`: `P0`, `P1`, `P2`, or `P3`.
- `Size`: `S`, `M`, `L`, or `XL`.

## Metadata Checklist

Set or verify these fields whenever the repository supports them:

- Assignees
- Labels
- Issue Type
- Project
- Project Status
- Project custom fields
- Milestone
- Relationships, including parent/sub-issue links
- Development links, including branch or PR links
- PR draft/open state
- PR base and head branches
- Linked Issue or closing reference

## Close vs Reference

Use a closing keyword only when the PR fully satisfies the linked Issue:

```markdown
Closes #92
```

Use a non-closing reference when the PR is partial, adjacent, or preparatory:

```markdown
Related to #92
```

If scope changes and the PR becomes complete, update the PR body and verify the platform reports the Issue in `closingIssuesReferences`.

## Examples

- PR #91 fully satisfied Issue #35 after the README and website CTA work were both included, so the PR body used `Closes #35`.
- Issue #92 is a bounded workflow-rule task, so it uses Issue Type `Task`, project `Agent Browser Gateway Roadmap`, status `In Progress` while PR #93 is active, track `Governance`, phase `Next`, priority `P1`, size `M`, and parent Issue #23.
