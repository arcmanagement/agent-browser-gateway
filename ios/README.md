# ABG Companion (iOS)

SwiftUI companion app for approving desktop Gateway operations from an iPhone,
implementing the pairing and approval-forwarding designs in
[`docs/IOS_GATEWAY_PAIRING.md`](../docs/IOS_GATEWAY_PAIRING.md).

## What it does

- Pairs with a desktop Gateway over the user's private network by scanning the
  QR code from `abg companion offer`, or by manual code entry.
- Receives approval **summaries** — operation kind, intent, target origin and tab
  ref, requester, gateway label, expiry. Page contents never leave the desktop.
- Sends allow / deny decisions. Deny is the default action; Allow needs a second
  deliberate tap, with stronger copy for destructive operations.
- Bundles the Safari Web Extension used to share selected iPhone tabs with the
  paired Mac Gateway. Sharing one tab never grants access to other Safari tabs.
- Performs approved native Reading List additions. The Safari popup toggle and
  the companion approval are both required.
- Keeps the Safari extension session in the shared App Group so suspended tabs
  can reconnect to the same Mac-side reference after Safari returns.

## Build

The Xcode project is generated so the checked-in source stays the single truth:

```bash
cd ios/ABGCompanion
xcodegen generate
xcodebuild -scheme ABGCompanion -destination 'platform=iOS Simulator,name=iPhone 16' test
```

## Security notes

- The device keypair (Curve25519) and the session token live in the Keychain with
  `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`. Only the public key is sent to
  the desktop.
- The session token arrives sealed to the device public key and is delivered once.
- Unpairing forgets the gateway and token but keeps the device identity, so
  re-pairing the same phone does not churn keys.
- Recording approvals are deny-only from the phone: the capture stream must be
  minted inside the desktop approval window's own gesture.
- File attachments arrive as AES-256-GCM ciphertext and are decrypted in the
  paired Safari extension. The Mac file path is never sent to the phone.
