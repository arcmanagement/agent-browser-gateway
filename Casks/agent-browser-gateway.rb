cask "agent-browser-gateway" do
  version "0.5.2"
  sha256 "8f11fa4c8d7f8bfc772dd45ec09eaec6a45708f2ad6765386b41f2c4e1749536"

  url "https://github.com/arcmanagement/agent-browser-gateway/releases/download/v#{version}/agent-browser-gateway-#{version}-macos-arm64.zip"
  name "Agent Browser Gateway"
  desc "Share authorized Chrome tabs with AI coding agents"
  homepage "https://agent-browser-gateway.com/"

  depends_on macos: :sonoma
  depends_on arch: :arm64

  app "Agent Browser Gateway.app"
  binary "abg"

  uninstall quit: "jp.co.arcm.AgentBrowserGateway"

  zap trash: [
    "~/Library/Application Support/AgentBrowserGateway",
    "~/Library/Logs/AgentBrowserGateway",
  ]

  caveats <<~EOS
    Install the Chrome extension from the Chrome Web Store:
      https://chromewebstore.google.com/detail/agent-browser-gateway/ojgedfcgebjchckaagjkmlpgonpjggpi
  EOS
end
