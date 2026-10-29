import { describe, expect, it } from "vitest";
import {
  matchesSandboxSharing,
  restoreSandboxSharing,
  sandboxConnectionKey,
  validateSandboxSharing,
} from "../src/sandboxSharing.js";

const config = validateSandboxSharing({
  scope: "domains",
  rules: [
    { kind: "domain", pattern: "EXAMPLE.test" },
    { kind: "domain", pattern: "*.preview.test" },
    { kind: "regex", pattern: "(localhost|127\\.0\\.0\\.1)" },
  ],
  httpsOnly: false,
  ports: [],
});

describe("domain sharing conditions", () => {
  it.each([
    ["https://example.test/page", true],
    ["https://EXAMPLE.test./", true],
    ["https://a.b.preview.test/", true],
    ["http://localhost:3000/", true],
    ["http://127.0.0.1:5173/", true],
    ["https://preview.test/", false],
    ["https://sub.example.test/", false],
    ["https://example.test.evil.test/", false],
    ["https://evil.test/example.test?next=https://localhost/", false],
    ["https://example.test@evil.test/", false],
    ["https://notlocalhost/", false],
    ["file:///localhost/test.html", false],
    ["chrome://settings/", false],
    ["invalid", false],
  ])("matches only allowed hostnames: %s", (url, expected) => {
    expect(matchesSandboxSharing(url, config)).toBe(expected);
  });

  it("applies HTTPS and effective ports to every condition", () => {
    const restricted = { ...config, httpsOnly: true, ports: [443, 8443] };
    expect(matchesSandboxSharing("https://example.test/", restricted)).toBe(true);
    expect(matchesSandboxSharing("https://localhost:8443/", restricted)).toBe(true);
    expect(matchesSandboxSharing("https://localhost:3000/", restricted)).toBe(false);
    expect(matchesSandboxSharing("http://example.test:443/", restricted)).toBe(false);
  });

  it.each([
    { rules: [] },
    { rules: [{ kind: "regex", pattern: "[" }] },
    { rules: [{ kind: "domain", pattern: "" }] },
    { rules: [{ kind: "domain", pattern: "https://example.test" }] },
    { rules: [{ kind: "domain", pattern: "example.test/path" }] },
    { rules: [{ kind: "domain", pattern: "example.test:3000" }] },
    { ports: [0] },
    { ports: [65536] },
    { ports: [3.5] },
    { httpsOnly: "false" },
  ])("rejects malformed configuration %j", (invalid) => {
    expect(() => validateSandboxSharing({ ...config, ...invalid })).toThrow();
  });

  it("restores invalid stored conditions with no automatic matches", () => {
    const restored = restoreSandboxSharing({ ...config, rules: [{ kind: "regex", pattern: "[" }] });
    expect(restored.scope).toBe("domains");
    expect(matchesSandboxSharing("https://example.test", restored)).toBe(false);
    expect(restoreSandboxSharing(undefined).scope).toBe("all");
  });

  it("keeps configurations separate for saved connections and local gateways", () => {
    expect(sandboxConnectionKey("cloud", "wss://gateway.test/ws", "one")).not.toBe(
      sandboxConnectionKey("cloud", "wss://gateway.test/ws", "two"),
    );
    expect(sandboxConnectionKey("local", "ws://127.0.0.1:8765/ws")).not.toBe(
      sandboxConnectionKey("local", "ws://127.0.0.1:8766/ws"),
    );
  });
});
