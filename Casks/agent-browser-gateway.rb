cask "agent-browser-gateway" do
  version "0.3.1"
  sha256 "918c2d6476673f776c8d73186a131e52a7f220f856113a2a4817a776e22ba804"

  url "https://github.com/arcmanagement/agent-browser-gateway/releases/download/v#{version}/agent-browser-gateway-#{version}-macos-arm64.zip"
  name "Agent Browser Gateway"
  desc "Share specific Chrome tabs with AI coding agents"
  homepage "https://github.com/arcmanagement/agent-browser-gateway"

  depends_on macos: ">= :sonoma"
  depends_on arch: :arm64

  app "Agent Browser Gateway.app"
  binary "abg"
  artifact "AgentBrowserGateway_abg.bundle", target: "#{HOMEBREW_PREFIX}/bin/AgentBrowserGateway_abg.bundle"

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
