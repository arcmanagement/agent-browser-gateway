// Release facts shown on the landing pages. Keep these literal so release bumps can find them
// with `rg "0\.5\.0"` (see the bump-abg workflow). Values must match README.md and GitHub Releases.
export const release = {
  version: "0.5.0",
  dmgUrl:
    "https://github.com/arcmanagement/agent-browser-gateway/releases/download/v0.5.0/agent-browser-gateway-0.5.0-macos-arm64.dmg",
  dmgShaUrl:
    "https://github.com/arcmanagement/agent-browser-gateway/releases/download/v0.5.0/agent-browser-gateway-0.5.0-macos-arm64.dmg.sha256.txt",
  dmgSha256: "16fd0ba3523023006adcfda66d94674dfcbc04cfb1f572fdfee4bbcddfe921ac",
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
