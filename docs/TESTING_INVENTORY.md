# Testing Inventory

Captured from `origin/main` on 2026-06-06 for the test foundation work tracked by #25.

## Swift Package

The Swift package has one test target:

- `GatewayTests` in `Tests/GatewayTests`
- Dependencies: `Gateway`, `GatewayCore`
- Current count: 5 Swift test files, 5 `XCTestCase` classes, 40 XCTest methods

Current files:

| File | Coverage area |
| --- | --- |
| `ExtensionProtocolTests.swift` | Extension protocol decoding |
| `PluginHostTests.swift` | Plugin loading, transforms, commands, bundled plugins, plugin reload behavior, and tab command dispatch |
| `PluginInstallerTests.swift` | GitHub/local plugin install, update, uninstall, disabled state, and path safety |
| `RuntimeEnvironmentTests.swift` | Production/dev profile defaults and directory override behavior |
| `WSServerSecurityTests.swift` | Extension-origin WebSocket origin policy |

Measured with:

```bash
find Tests/GatewayTests -name '*.swift' -type f | wc -l
rg -n 'final class .*Tests: XCTestCase' Tests/GatewayTests | wc -l
rg -n 'func test' Tests/GatewayTests | wc -l
swift test list
```

## Extension Package

The Chrome extension currently has build and static validation scripts, but no package-level test
runner on `origin/main`.

Current scripts:

- `pnpm run build`
- `pnpm run webstore:zip`
- `pnpm run watch`
- `pnpm run typecheck`
- `pnpm run lint`
- `pnpm run format`

Current test framework usage:

- No `test` or `test:watch` script in `extension/package.json`
- No Vitest, Jest, Mocha, or Chrome API mock dependency in `extension/pnpm-lock.yaml`
- No checked-in `extension/test/` directory on `origin/main`
- Extension validation currently depends on TypeScript, Biome, and esbuild only

Measured with:

```bash
cd extension
pnpm run typecheck
pnpm run lint
pnpm run build
```

## Gaps

- Add a Chrome extension test runner and package test script. Tracked by #51.
- Add unit tests for background, content, and popup logic once the Chrome API mock exists. Tracked by #52.
- Add XCTest coverage for Gateway core services beyond the existing plugin/runtime/security tests. Tracked by #50.
- Wire Swift and extension tests into CI/branch protection once both suites exist. Tracked by #53.
- Add CLI command-contract tests for JSON output and error stability before making those checks required. Tracked by #76.
