export type SandboxSharingRule = { kind: "domain" | "regex"; pattern: string };
export type SandboxSharing = {
  scope: "all" | "domains";
  rules: SandboxSharingRule[];
  httpsOnly: boolean;
  ports: number[];
};

export const DEFAULT_SANDBOX_SHARING: SandboxSharing = {
  scope: "all",
  rules: [],
  httpsOnly: false,
  ports: [],
};

export function validateSandboxSharing(value: unknown): SandboxSharing {
  if (!value || typeof value !== "object") throw new Error("Invalid sharing settings.");
  const input = value as Record<string, unknown>;
  if (
    (input.scope !== "all" && input.scope !== "domains") ||
    typeof input.httpsOnly !== "boolean" ||
    !Array.isArray(input.ports) ||
    input.ports.length > 100 ||
    input.ports.some((p) => !Number.isInteger(p) || p < 1 || p > 65535) ||
    !Array.isArray(input.rules) ||
    input.rules.length > 50
  )
    throw new Error("Invalid sharing settings.");
  const rules = input.rules.map((raw): SandboxSharingRule => {
    if (!raw || typeof raw !== "object") throw new Error("Invalid sharing rule.");
    const rule = raw as Record<string, unknown>;
    if ((rule.kind !== "domain" && rule.kind !== "regex") || typeof rule.pattern !== "string")
      throw new Error("Invalid sharing rule.");
    let pattern = rule.pattern.trim();
    if (!pattern || pattern.length > 256)
      throw new Error("Enter a hostname or regular expression.");
    if (rule.kind === "regex") {
      try {
        new RegExp(`^(?:${pattern})$`, "i");
      } catch {
        throw new Error("Invalid hostname regular expression.");
      }
      return { kind: "regex", pattern };
    }
    const subdomains = pattern.startsWith("*.");
    const host = subdomains ? pattern.slice(2) : pattern;
    const parsed = new URL(`https://${host}`);
    if (
      !host ||
      /[\s/@?#:*]/.test(host.replace(/^\[[a-fA-F0-9:]+\]$/, "ipv6")) ||
      parsed.pathname !== "/" ||
      parsed.port ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password
    )
      throw new Error("Enter a hostname, such as example.test or *.example.test.");
    pattern = `${subdomains ? "*." : ""}${parsed.hostname.toLowerCase().replace(/\.$/, "")}`;
    return { kind: "domain", pattern };
  });
  if (input.scope === "domains" && rules.length === 0)
    throw new Error("Add at least one sharing rule.");
  return {
    scope: input.scope,
    rules,
    httpsOnly: input.httpsOnly,
    ports: [...new Set(input.ports as number[])],
  };
}

export function restoreSandboxSharing(value: unknown): SandboxSharing {
  if (value === undefined) return { ...DEFAULT_SANDBOX_SHARING, rules: [], ports: [] };
  try {
    return validateSandboxSharing(value);
  } catch {
    return { scope: "domains", rules: [], httpsOnly: true, ports: [] };
  }
}

export function matchesSandboxSharing(url: string | undefined, config: SandboxSharing): boolean {
  if (config.scope === "all") return true;
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      (config.httpsOnly && parsed.protocol !== "https:")
    )
      return false;
    const port = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
    if (config.ports.length && !config.ports.includes(port)) return false;
    const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
    return config.rules.some((rule) => {
      if (rule.kind === "regex") return new RegExp(`^(?:${rule.pattern})$`, "i").test(host);
      if (rule.pattern.startsWith("*."))
        return host.endsWith(rule.pattern.slice(1)) && host !== rule.pattern.slice(2);
      return host === rule.pattern;
    });
  } catch {
    return false;
  }
}

export function sandboxConnectionKey(destination: string, url: string, savedId?: string): string {
  return JSON.stringify([destination, url, savedId ?? ""]);
}
