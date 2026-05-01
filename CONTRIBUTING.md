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
./build-app.sh                 # Gateway.app + .build/release/abg
cd extension && pnpm install && pnpm run build

# Iterate
swift run Gateway              # debug Gateway in foreground
cd extension && pnpm run watch # extension hot-rebuild

# Quality gates
cd extension && pnpm run lint && pnpm run typecheck
swift build                    # treats warnings as warnings; we want clean builds
```

## Commits

- Conventional-style is appreciated but not required. Reasonable English summary in 50-72 chars.
- Sign your commits if you can (`git commit -s`). DCO is the long-term plan; not enforced yet.

## CLA / Licensing

The license under which ABG will be released is not yet decided. While the license is undecided, external contributions are not yet being accepted. Once the license is published, prior contributors will be contacted before any retroactive change of terms.

## Code style

- Swift: standard formatting (`swift-format` defaults). 4-space indent.
- TypeScript: Biome with the project's `biome.json`. Run `pnpm run format` before pushing.
- Markdown: hard-wrap at ~100 chars, prefer reference-style links for long URLs in body text.

## Testing

- Add tests where it's natural (the codebase is small enough that we don't yet enforce coverage).
- Manual end-to-end verification (load extension, share a tab, run `abg ...`) is required before merging anything that touches the WS protocol or extension surface.

## Out of scope (for now)

- New browser support (Firefox, Safari) — we have a roadmap; please don't pre-emptively port.
- Mobile support — same.
- Remote / multi-machine pairing — same.
