# Contributing to Agent Browser Gateway

Thanks for considering a contribution. ABG is a small project with a sharp thesis (`Open source. No telemetry. Verifiable.`), so a few things up front:

## Before you start

- Open an issue first for anything non-trivial. We'd rather discuss the design than reject a finished PR.
- Read [SECURITY.md](SECURITY.md) — the design invariants there are non-negotiable.
- ABG is pre-1.0. APIs (CLI flags, WS protocol, on-disk file formats) may change. Don't add backwards-compatibility shims yet.

## Things we will probably reject

- Telemetry / analytics / crash reporting, even opt-in (we'll consider this carefully post-1.0; today the answer is no).
- An "execute arbitrary JavaScript on a permitted tab" tool exposed via CLI or MCP.
- Adding `<all_urls>` to `host_permissions`.
- Replacing the per-tab consent model with a per-origin or per-extension model.
- New runtime dependencies without a clear justification. Bundle size is less important than auditability — every dependency is something a future user has to trust.

## Development workflow

```bash
# One-time
mise trust && mise install

# Build
./build-app.sh                 # Agent Browser Gateway.app + .build/release/abg
cd extension && pnpm install && pnpm run build

# Iterate
swift run Gateway              # debug Gateway in foreground
cd extension && pnpm run watch # extension hot-rebuild

# Quality gates
cd extension && pnpm run lint && pnpm run typecheck
swift test
swift build -c release
```

## Commits

- Conventional Commits style is appreciated but not required. Use a clear English summary, 50-72 chars on the subject line.
- **Sign off every commit** with `git commit -s`. This appends a `Signed-off-by:` trailer and certifies that you agree to the [Developer Certificate of Origin v1.1](https://developercertificate.org/). PRs without DCO sign-off cannot be merged.

## Licensing (inbound = outbound)

By submitting a contribution, you agree that your contribution is licensed to the project under the **Business Source License 1.1** — the same license as the rest of the project. See [LICENSE](LICENSE). No separate Contributor License Agreement (CLA) is required; the DCO sign-off is your assertion that you have the right to submit the contribution under this license.

You retain copyright in your contribution. ArcManagement Co., Ltd. may, at its sole discretion, distribute the project (including your contribution) under a different license in the future, including the Apache License 2.0 as described in LICENSE (Change License after the Change Date), or under a commercial license for paying users.

For information on the project's licensing strategy and commercial licensing, see [COMMERCIAL.md](COMMERCIAL.md).

## Code style

- Swift: standard formatting (`swift-format` defaults). 4-space indent.
- TypeScript: Biome with the project's `biome.json`. Run `pnpm run format` before pushing.
- Markdown: hard-wrap at ~100 chars, prefer reference-style links for long URLs in body text.

## Testing

- Add focused tests for shared behavior, plugin loading, and protocol changes.
- Manual end-to-end verification (load extension, share a tab, run `abg ...`) is required before merging anything that touches the WS protocol or extension surface.

## Out of scope (for now)

- New browser support (Firefox, Safari) — we have a roadmap; please don't pre-emptively port.
- Mobile support — same.
- Remote / multi-machine pairing — same.
