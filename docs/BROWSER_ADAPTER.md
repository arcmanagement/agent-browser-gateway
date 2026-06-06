# Browser adapter boundary

ABG's extension currently ships as a Chrome extension, but browser-specific calls now enter through
`extension/src/browserAdapter.ts`. New desktop-browser ports should implement the same `BrowserAdapter`
surface before changing feature code.

## Current interface

| Namespace | Used for | Porting notes |
|---|---|---|
| `runtime` | Extension ID, internal messages, lifecycle listeners, extension URLs | Firefox/Edge/Brave support similar WebExtension APIs; Safari needs URL/message checks. |
| `storage.local` / `storage.session` | Persistent settings and restart-cleared permitted-tab state | Session storage availability is the main portability check. |
| `tabs` | Active-tab discovery, share/revoke lifecycle, navigation, sandbox tab create/close | Tab shape and URL permission behavior differ by browser. |
| `permissions` / `extension` | Optional all-tabs access and incognito checks | Safari optional host permission behavior needs separate verification. |
| `action` / `alarms` / `windows` | Badge state, service-worker heartbeat, approval window lifecycle | Mostly WebExtension-compatible, but service-worker lifetime differs. |
| `scripting` | Content-script execution for annotation and DOM operations | Host permission errors differ; keep debugger fallback isolated. |
| `debugger` | CDP-backed screenshots, network, dialogs, PDF, input, and eval fallback | This is Chrome-family specific and the largest non-Chrome porting gap. |
| `downloads` | Download lifecycle metadata for shared tabs | Browser support and item fields vary. |

## Rules

- Feature modules should import `browserAdapter` instead of calling `chrome.*` directly.
- The adapter can still use Chrome types while Chrome is the only runtime implementation.
- Browser-family differences should be captured in the adapter or a small browser-specific helper,
  not scattered through command handlers.
- CDP/debugger features must stay explicit. A future non-Chrome port can initially report unsupported
  commands instead of emulating Chrome debugger behavior.
