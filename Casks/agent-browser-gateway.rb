cask "agent-browser-gateway" do
  version "0.4.2"
  sha256 "b833ebfe795276ffb1c56c7f44488fdcd3900b89fa1c0930720d06757ee133ee"

  url "https://agent-browser-gateway.com/downloads/agent-browser-gateway-#{version}-macos-arm64.zip"
  name "Agent Browser Gateway"
  desc "Share authorized Chrome tabs with AI coding agents"
  homepage "https://agent-browser-gateway.com/"

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
    Install the Chrome extension from the Chrome Web Store:
      https://chromewebstore.google.com/detail/agent-browser-gateway/ojgedfcgebjchckaagjkmlpgonpjggpi
  EOS
end
