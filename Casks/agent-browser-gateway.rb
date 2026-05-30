cask "agent-browser-gateway" do
  version "0.3.11"
  sha256 "55913f54278298f0526b5edaf2e09459b371d5d69e689ff14165b99f1a25199a"

  url "https://github.com/arcmanagement/agent-browser-gateway/releases/download/v#{version}/agent-browser-gateway-#{version}-macos-arm64.zip"
  name "Agent Browser Gateway"
  desc "Share authorized Chrome tabs with AI coding agents"
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
