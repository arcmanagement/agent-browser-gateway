# Chrome extension 1.2.0

Agent Browser Gateway supports both a local desktop Gateway and an optional Cloud connection. The Cloud path does not require installing the desktop app or CLI.

## Install and connect

1. Download `agent-browser-gateway-extension-1.2.0.zip` and its checksum from the [extension release](https://github.com/arcmanagement/agent-browser-gateway/releases/tag/extension-v1.2.0).
2. Verify the checksum, extract the ZIP, enable Developer mode at `chrome://extensions`, and choose **Load unpacked** with the extracted directory. Keep that directory for as long as Chrome uses it.
3. Choose **Connect to → Cloud** in the extension, name the destination, and choose **Log in to register this connection**.
4. Sign in with email/password on the Web page and approve the browser. Return to the extension and apply the saved destination.
5. Share a tab. Connect the AI client through the Web authorization page at `https://app.agent-browser-gateway.com/oauth/authorize` and authorize browser access.

Saved destinations keep a browser credential in trusted extension storage, not the account password. Credentials expire and can be renewed or revoked in the Web dashboard. A manual code is an advanced, session-only alternative. Removing a saved destination deletes its local credential and stops its active shares; revoke server access in the dashboard as well when retiring a browser.

The GitHub ZIP is the direct distribution artifact. Chrome Web Store upload, review, and final publication have separate status; do not assume a Store-installed version already contains 1.2.0.

## Sharing and operations

Personal and mixed-use profiles use per-tab sharing. A manual share ends on close, origin change, or revoke. Isolated profiles may enable **Share all tabs (sandbox profiles only)**, accept Chrome's optional site access, and separately opt into **Resume Sandbox after restart or disconnect**. Resume is bound to the selected saved destination and credential and authenticates before announcing tabs. Switching destinations, revoking site access, disabling Sandbox, deleting the destination, rejected credentials, or replacement by another browser cancels resume.

AI clients use Cloud tools such as `tabs_list`, `tab_read`, and the plugin command surface. A browser ID and current generation identify the browser session; rediscover tabs after reconnecting. Cloud plugin registration and execution use the selected service, rather than the desktop `~/.abg/plugins` directory. Install only trusted plugins, and authorize only the browsers and operations the client needs.

Client file attachment uses ABG end to end. With an updated Cloud service and an extension advertising `file-transfer-v1`, send `tab_upload_chunk` with one UUID `transferId`, file `name`, `mime`, `totalBytes`, byte `offset`, and base64 `data` (at most 36 KiB decoded per call). Send consecutive chunks until `complete` is true, then call `tab_attach_files` with the same target, the file input `selector`, and `transferIds`. The extension assembles files in memory and attaches them without SSH, SCP, browser-host files, JavaScript eval, or Chrome's file-URL grant. Operation approval OFF means no transfer or attachment prompt; ON applies the existing attachment approval. Account-forced approval still applies. Attachments support one top-document file input and require `multiple` for more than one file. Transfers are limited to 16 MiB per file, 32 MiB total and 20 files; they expire after ten minutes and are discarded on revoke, reconnect, worker restart, or attachment dispatch. After a timeout, inspect the site before starting another transfer.

The existing `upload_file` path mode continues to accept absolute paths on the connected browser's host. Only this path mode requires **Allow access to file URLs**; it cannot read the AI client's filesystem. Download inspection returns shared-tab download status and browser-host paths, rather than transferring the downloaded file to the client. Recording always needs the browser's approval and capture permission; recording chunks are kept in extension IndexedDB for bounded retrieval. Runtime events are buffered for retrieval.

Changing between local and Cloud, changing the Cloud endpoint, or replacing its credential resets bookmark/Reading List access, personal-data mutations, JavaScript eval, and Trusted automation, and restores operation approval. Re-enable only the options intended for the new destination. Reapplying the same endpoint and credential preserves those choices. Bookmark and Reading List permissions cover browser-owned lists beyond the shared tab; if enabled for Cloud, requested list data passes through that service. Trusted automation can skip ordinary operation and eval prompts on shared tabs. Recording always retains approval.

When operation approval is off, Cloud reads including snapshots, element descriptions, find results, editable validation, input values, state values, and network response bodies skip the approval window on shared tabs. This applies to manual shares as well as Sandbox, without requiring AutoMode or automatic resume. Cloud account-forced approval still applies, and password and sign-in-code reads remain blocked. File attachments also follow the operation approval toggle on both manual shares and Sandbox. Turning it off skips the attachment approval window for both transferred bytes and browser-host file paths, without requiring AutoMode or automatic resume. Only browser-host path uploads require Chrome's file-URL permission. Recording retains its separate approval gate.

## Connection diagnostics

Open **Advanced → Connection history** in the extension popup (**詳細設定 → 接続履歴** in Japanese). Choose **Refresh** after a disconnect and **Save JSON** to export the timeline. Connection diagnostics are available starting with version 1.1.2.

The history shows the latest 200 events within seven days, persists in this browser across extension worker/browser restarts, and is not uploaded automatically. It records discovery results and HTTP status, authentication timeout/rejection, WebSocket errors and close codes, intentional disconnects, network online/offline signals, and worker starts. Close events include the connection attempt, elapsed time and time since the last sent/received frame. Each worker run has a new `runId`; attempts are numbered within that run. Exported timestamps are UTC milliseconds (`at`); the popup also shows ISO UTC timestamps.

| Evidence | What it means |
|---|---|
| `disconnect_requested` | The extension initiated the close; `reason` identifies configuration changes, no remaining shared tabs, or authentication failure. |
| `socket_closed`, code `4001`, `connection_replaced` | Another browser connection replaced this one on the selected Cloud route. |
| Code `4003` with a recognized `serverReason` | The service required authentication or rejected a message/credential. |
| `discovery_failed` | `failure` distinguishes missing site access, HTTP error, timeout, cancellation, and network/response failure; `httpStatus` is included when available. |
| `socket_error` followed by code `1006` / `wasClean: false` | No normal close handshake was received. This alone cannot distinguish a network interruption from a service failure; correlate the UTC time with service logs. |
| A new `worker_started` after a ready connection, without a close event | The worker restarted without recording a close. Browser shutdown, worker termination and extension reload/update remain possible; `browser_started` provides additional context when Chrome delivers it. |
| `active: false` on a close | A late event from an already replaced/closed socket. Its original `attempt` still identifies it; it does not disconnect the current socket. |

History excludes credentials, endpoints, page URLs/titles/content, message payloads and exception text. Only three fixed service close reasons are recognized (`connection_replaced`, `authentication_required`, `invalid_message_or_credential`); other close text is omitted. Online/offline is the browser's network signal and does not prove Internet reachability. Abrupt process termination can prevent the last event from being saved. A storage failure is reported in the popup and export (`storageFailed`); the history may then be incomplete. Recording diagnostics does not enable automatic reconnection or restore sharing consent.

## Data and endpoints

The official account UI uses `https://app.agent-browser-gateway.com`. Browser login and route discovery use `https://connect.agent-browser-gateway.com`, and authenticated browser traffic uses `wss://connect.agent-browser-gateway.com`. A custom destination uses the selected gateway's corresponding HTTPS and WebSocket endpoints. The service receives shared-tab metadata, requested page content, screenshots, operation inputs/results, and requested file or recording data, and relays them to authorized clients. Cloud processing is not limited to the browser's machine.

The browser credential is sent only to the selected gateway. The extension opens the account page for passwords; it never receives or stores the account password. Cloud authorization, expiry, revocation, and audit are service responsibilities. The desktop audit path applies only to local Gateway operation. No analytics or advertising collection is added.

## Release scope

Only the Chrome extension is 1.2.0. macOS remains 0.5.2 and Windows remains 0.5.3. The extension release uses `extension-v1.2.0` so it does not run the unified desktop release pipeline. Chrome Web Store signs Store packages; the direct ZIP is an unpacked extension distribution, not a separately signed `.crx` file.
