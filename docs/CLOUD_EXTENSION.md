# Chrome extension 1.0.0

Agent Browser Gateway supports both a local desktop Gateway and an optional Cloud connection. The Cloud path does not require installing the desktop app or CLI.

## Install and connect

1. Download `agent-browser-gateway-extension-1.0.0.zip` and its checksum from the [extension release](https://github.com/arcmanagement/agent-browser-gateway/releases/tag/extension-v1.0.0).
2. Verify the checksum, extract the ZIP, enable Developer mode at `chrome://extensions`, and choose **Load unpacked** with the extracted directory. Keep that directory for as long as Chrome uses it.
3. Choose **Connect to → Cloud** in the extension, name the destination, and choose **Log in to register this connection**.
4. Sign in with email/password on the Web page and approve the browser. Return to the extension and apply the saved destination.
5. Share a tab. Connect the AI client through the Web authorization page at `https://app.agent-browser-gateway.com/oauth/authorize` and authorize browser access.

Saved destinations keep a browser credential in trusted extension storage, not the account password. Credentials expire and can be renewed or revoked in the Web dashboard. A manual code is an advanced, session-only alternative. Removing a saved destination deletes its local credential and stops its active shares; revoke server access in the dashboard as well when retiring a browser.

The GitHub ZIP is the direct distribution artifact. Chrome Web Store upload, review, and final publication have separate status; do not assume a Store-installed version already contains 1.0.0.

## Sharing and operations

Personal and mixed-use profiles use per-tab sharing. A manual share ends on close, origin change, or revoke. Isolated profiles may enable **Share all tabs (sandbox profiles only)**, accept Chrome's optional site access, and separately opt into **Resume Sandbox after restart or disconnect**. Resume is bound to the selected saved destination and credential and authenticates before announcing tabs. Switching destinations, revoking site access, disabling Sandbox, deleting the destination, rejected credentials, or replacement by another browser cancels resume.

AI clients use Cloud tools such as `tabs_list`, `tab_read`, and the plugin command surface. A browser ID and current generation identify the browser session; rediscover tabs after reconnecting. Cloud plugin registration and execution use the selected service, rather than the desktop `~/.abg/plugins` directory. Install only trusted plugins, and authorize only the browsers and operations the client needs.

File attachment accepts absolute paths on the connected browser's host, not paths on the AI client's machine. It always requires the browser's approval showing the paths and Chrome's **Allow access to file URLs** grant. An approved attachment can expose any readable file at those paths to the target website; approve only files you intend to share. The extension does not implement client-to-browser byte transfer. Download inspection returns shared-tab download status and browser-host paths, rather than transferring the downloaded file to the client. Recording always needs the browser's approval and capture permission; recording chunks are kept in extension IndexedDB for bounded retrieval. Runtime events are buffered for retrieval.

Changing between local and Cloud, changing the Cloud endpoint, or replacing its credential resets bookmark/Reading List access, personal-data mutations, JavaScript eval, and Trusted automation, and restores operation approval. Re-enable only the options intended for the new destination. Reapplying the same endpoint and credential preserves those choices. Bookmark and Reading List permissions cover browser-owned lists beyond the shared tab; if enabled for Cloud, requested list data passes through that service. Trusted automation can skip ordinary operation and eval prompts on shared tabs, but cannot skip recording or file-attachment approval.

## Data and endpoints

The official account UI uses `https://app.agent-browser-gateway.com`. Browser login and route discovery use `https://connect.agent-browser-gateway.com`, and authenticated browser traffic uses `wss://connect.agent-browser-gateway.com`. A custom destination uses the selected gateway's corresponding HTTPS and WebSocket endpoints. The service receives shared-tab metadata, requested page content, screenshots, operation inputs/results, and requested file or recording data, and relays them to authorized clients. Cloud processing is not limited to the browser's machine.

The browser credential is sent only to the selected gateway. The extension opens the account page for passwords; it never receives or stores the account password. Cloud authorization, expiry, revocation, and audit are service responsibilities. The desktop audit path applies only to local Gateway operation. No analytics or advertising collection is added.

## Release scope

Only the Chrome extension is 1.0.0. macOS remains 0.5.2 and Windows remains 0.5.3. The extension release uses `extension-v1.0.0` so it does not run the unified desktop release pipeline. Chrome Web Store signs Store packages; the direct ZIP is an unpacked extension distribution, not a separately signed `.crx` file.
