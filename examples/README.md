# Examples

Small shell snippets showing common ABG agent patterns. Agents can read these to learn idiom; humans can copy them.

| File | What it shows |
|---|---|
| [`first-shared-tab.sh`](first-shared-tab.sh) | Pick the first shared tab and pull its DOM as Markdown |
| [`screenshot-region.sh`](screenshot-region.sh) | Capture only a region of a tab (smaller payload) |
| [`wait-then-click.sh`](wait-then-click.sh) | Wait for an element to appear, then click it |
| [`safe-fill-form.sh`](safe-fill-form.sh) | Fill a form field with verification (read before/after) |
| [`audit-summary.sh`](audit-summary.sh) | Summarise the last hour of audit log |

Run any of these against a tab you've shared via the extension popup. None of them mutate state without verification — they're meant to be safe to read.

## Skill ergonomics

Claude Code's Skill loader (after `abg install-skill`) will reach these examples when relevant. If you build your own Skill for another agent, point it at this directory.
