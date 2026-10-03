cask "agent-browser-gateway" do
  version "0.5.0"
  sha256 "9eed195202d9da35e09f52dcb92ab5db24ffa72f7ad43b2e8999437f460f4e46"

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
