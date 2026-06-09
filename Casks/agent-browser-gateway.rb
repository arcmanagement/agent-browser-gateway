cask "agent-browser-gateway" do
  version "0.4.0"
  sha256 "2bb2ebd6b88d1d59d8070869badf2ea927cb0b2317d78d9e3af7a35a4344595e"

  url "https://github.com/arcmanagement/agent-browser-gateway/releases/download/v#{version}/agent-browser-gateway-#{version}-macos-arm64.zip"
  name "Agent Browser Gateway"
  desc "Share authorized Chrome tabs with AI coding agents"
  homepage "https://github.com/arcmanagement/agent-browser-gateway"

  depends_on macos: :sonoma
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
