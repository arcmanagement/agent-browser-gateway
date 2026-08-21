# Testing Inventory

Updated from `origin/main` on 2026-07-27 for the test integration work tracked by #25.

## Swift Package

The Swift package has one test target:

- `GatewayTests` in `Tests/GatewayTests`
- Dependencies: `Gateway`, `GatewayCore`
- Current count: 8 Swift test files, 8 `XCTestCase` classes, 79 XCTest methods

Current files:

| File | Coverage area |
| --- | --- |
| `AuditLogTests.swift` | Audit-log persistence, integrity, filtering, and redaction |
| `CLITransportTests.swift` | CLI transport discovery, endpoint authentication, and fallback behavior |
| `ExtensionProtocolTests.swift` | Extension protocol decoding |
| `GatewaySettingsStoreTests.swift` | Gateway settings persistence and validation |
| `PluginHostTests.swift` | Plugin loading, transforms, commands, bundled plugins, plugin reload behavior, and tab command dispatch |
| `PluginInstallerTests.swift` | GitHub/local plugin install, update, uninstall, disabled state, and path safety |
| `RuntimeEnvironmentTests.swift` | Production/dev profile defaults and directory override behavior |
| `WSServerSecurityTests.swift` | Extension-origin WebSocket origin policy |

The CI gate runs:

```bash
swift test --enable-code-coverage
scripts/swift-coverage-check.sh
```

The coverage script enforces 60% or higher line coverage for the selected Gateway service sources.
Inventory counts can be refreshed with:

```bash
find Tests/GatewayTests -name '*.swift' -type f | wc -l
rg -n 'final class .*Tests: XCTestCase' Tests/GatewayTests | wc -l
rg -n 'func test' Tests/GatewayTests | wc -l
swift test list
```

## Extension Package

The Chrome extension uses Vitest with the V8 coverage provider and checked-in Chrome API mocks.

Current test scripts:

- `pnpm run test` for a single Vitest run
- `pnpm run test:coverage` for the CI coverage run
- `pnpm run test:watch` for local watch mode

Current test framework usage:

- `extension/vitest.config.ts` sets the coverage scope and 60% thresholds.
- `extension/test/chromeMock.ts` provides deterministic Chrome API mocks.
- 6 `*.test.ts` files currently contain 26 tests.
- Unit-testable extension logic covers approval, annotation, background, browser adapter, Chrome
  mocks, and popup behavior.

The CI gate runs:

```bash
cd extension
pnpm install --frozen-lockfile
pnpm run test:coverage
```

## CI and Branch Protection

The `CI` workflow runs the Swift suite in the `Swift tests` job on macOS and the extension suite
in the `Extension tests` job on Linux. GitHub exposes them as the `CI / Swift tests` and
`CI / Extension tests` checks. The branch-protection connection is tracked by #23;
the combined test integration and its Swift and extension child issues are tracked by #25, #89,
and #90.
