// Release facts shown on the landing pages. Keep these literal so release bumps can find them
// with `rg "0\.5\.1"` (see the bump-abg workflow). Values must match README.md and GitHub Releases.
export const release = {
  version: "0.5.1",
  dmgUrl:
    "https://github.com/arcmanagement/agent-browser-gateway/releases/download/v0.5.1/agent-browser-gateway-0.5.1-macos-arm64.dmg",
  dmgShaUrl:
    "https://github.com/arcmanagement/agent-browser-gateway/releases/download/v0.5.1/agent-browser-gateway-0.5.1-macos-arm64.dmg.sha256.txt",
  dmgSha256: "01ff3c7c72f0966448f2c4aa94c2b66ccb96850c4a410e2ca16c55ad695b1649",
  releasesUrl: "https://github.com/arcmanagement/agent-browser-gateway/releases",
  chromeStoreUrl:
    "https://chromewebstore.google.com/detail/agent-browser-gateway/ojgedfcgebjchckaagjkmlpgonpjggpi",
  chromeStoreVersion: "0.4.8",
  repoUrl: "https://github.com/arcmanagement/agent-browser-gateway",
  licenseUrl: "https://github.com/arcmanagement/agent-browser-gateway/blob/main/LICENSE",
  commercialUrl: "https://github.com/arcmanagement/agent-browser-gateway/blob/main/COMMERCIAL.md",
  brewCommands: [
    "brew tap arcmanagement/agent-browser-gateway https://github.com/arcmanagement/agent-browser-gateway",
    "brew trust --cask arcmanagement/agent-browser-gateway/agent-browser-gateway",
    "brew install --cask agent-browser-gateway",
  ],
  wingetCommand: "winget install --id ArcManagement.AgentBrowserGateway",
  skillsCommand: "npx skills add arcmanagement/agent-browser-gateway -g",
} as const;
