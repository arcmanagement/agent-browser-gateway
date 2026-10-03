// Release facts shown on the landing pages. Keep these literal so release bumps can find them
// with `rg "0\.4\.8"` (see the bump-abg workflow). Values must match README.md and GitHub Releases.
export const release = {
  version: "0.4.8",
  dmgUrl:
    "https://github.com/arcmanagement/agent-browser-gateway/releases/download/v0.4.8/agent-browser-gateway-0.4.8-macos-arm64.dmg",
  dmgShaUrl:
    "https://github.com/arcmanagement/agent-browser-gateway/releases/download/v0.4.8/agent-browser-gateway-0.4.8-macos-arm64.dmg.sha256.txt",
  dmgSha256: "98194172cf1047efd784acc98b4c5d31d8575dab9a174e36b71fa88ae510feda",
  releasesUrl: "https://github.com/arcmanagement/agent-browser-gateway/releases",
  chromeStoreUrl:
    "https://chromewebstore.google.com/detail/agent-browser-gateway/ojgedfcgebjchckaagjkmlpgonpjggpi",
  chromeStoreVersion: "0.4.4",
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
