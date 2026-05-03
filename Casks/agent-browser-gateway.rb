cask "agent-browser-gateway" do
  version "0.2.3"
  sha256 "16f6123a5de51e745ad0b5724471d9a78c54ba47276ea0e9aec62ffc74554a0e"

  url "https://github.com/arcmanagement/agent-browser-gateway/releases/download/v#{version}/agent-browser-gateway-#{version}-macos-arm64.zip"
  name "Agent Browser Gateway"
  desc "Share specific Chrome tabs with AI coding agents"
  homepage "https://github.com/arcmanagement/agent-browser-gateway"

  depends_on macos: ">= :sonoma"
  depends_on arch: :arm64

  app "Agent Browser Gateway.app"
  binary "abg"

  uninstall quit: "co.arcm.AgentBrowserGateway"

  zap trash: [
    "~/Library/Application Support/AgentBrowserGateway",
    "~/Library/Logs/AgentBrowserGateway",
  ]

  caveats <<~EOS
    Install the Chrome extension separately from the release asset:
      https://github.com/arcmanagement/agent-browser-gateway/releases/download/v#{version}/agent-browser-gateway-extension-#{version}.zip
  EOS
end
