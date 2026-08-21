# iOS Companion and Gateway Pairing Design

This document defines the smallest safe pairing shape for an iOS companion and a desktop Gateway.
It is a design contract for a later prototype. It does not introduce an ABG-operated relay.

## Goals

- Pair an iOS companion with a desktop Gateway by QR code or manual code.
- Keep the desktop Gateway as the authority for grants, revocation, and audit.
- Make revocation immediate for all companion capabilities created by that pairing.
- Record pairing creation, revocation, and failure in the desktop audit log without storing secrets.

## Non-goals

- ABG-operated cloud relay.
- Pairing that works when the desktop Gateway is offline or unreachable from the user's private
  Tailnet or LAN.
- Granting browser tab visibility to the phone by default.
- Silent approval of browser operations from a phone.

## Minimal pairing model

The desktop Gateway creates a short-lived pairing offer. The offer can be encoded as a QR code or
shown as a manual code. Both forms represent the same data:

| Field | Purpose |
| --- | --- |
| `gatewayBaseUrl` | Private Tailnet or LAN address selected by the desktop Gateway. |
| `pairingId` | Random offer identifier stored by the Gateway until expiry or completion. |
| `pairingNonce` | One-time secret used to claim the offer. Never written to audit logs. |
| `desktopPublicKey` | Key used by the companion to encrypt its first claim payload. |
| `expiresAt` | Short expiry, recommended maximum 5 minutes. |
| `displayCode` | Human-checkable code shown on both devices before confirmation. |
| `requestedScopes` | Initial companion capabilities requested by this offer. |

The manual code form uses the same values with a shorter transport:

```text
ABG-PAIR-<pairingId>-<displayCode>-<nonce-fragment>
```

The QR form may include the full `gatewayBaseUrl` and public key. Manual entry can require the user
to enter the desktop address separately when the iOS app cannot infer it.

## Desktop Gateway receiving side

The desktop Gateway owns a `PairingManager` and an on-demand private pairing listener. The listener
is disabled by default and starts only while a pairing offer is active.

Minimum receive surface:

| Endpoint | Caller | Purpose |
| --- | --- | --- |
| `POST /pairings/offers` | Desktop UI or CLI | Create a short-lived offer and render QR/manual code locally. |
| `POST /pairings/{pairingId}/claim` | iOS companion | Submit the nonce proof, companion public key, device label, and requested scope confirmation. |
| `POST /pairings/{pairingId}/confirm` | Desktop UI | Confirm the displayed code after the user checks both devices. |
| `GET /pairings` | Desktop UI or CLI | List paired companions and revoked entries. |
| `DELETE /pairings/{deviceId}` | Desktop UI or CLI | Revoke a paired companion. |
| `WS /companion` | iOS companion | Use an active paired session for future approval-forwarding messages. |

The listener must bind only to an explicit private interface or Tailnet address chosen by the user.
It must not replace the existing loopback-only browser extension WebSocket or CLI IPC. Normal browser
tab operations still flow through the desktop Gateway, existing consent state, operation approval,
and audit log.

## Pairing state machine

| State | Entry condition | Exit condition |
| --- | --- | --- |
| `idle` | No active offer. | User chooses Pair iOS Companion on desktop. |
| `offer_created` | Gateway stores offer, expiry, scopes, and display code. | Companion claims, offer expires, or user cancels. |
| `claimed` | Companion proves the nonce and submits its public key. | Desktop user confirms or rejects displayed code. |
| `paired` | Desktop confirms the claim and stores a device grant. | User revokes, key rotation fails, or stored grant expires. |
| `revoked` | Gateway marks device grant revoked and closes sessions. | Terminal state for that grant. |
| `failed` | Nonce mismatch, expiry, duplicate claim, network policy violation, or user rejection. | Terminal state for that offer attempt. |

Creation path:

1. Desktop user starts pairing from the Gateway UI or `abg companion pair`.
2. Gateway creates `pairingId`, `pairingNonce`, `displayCode`, `desktopPublicKey`, `expiresAt`, and
   `requestedScopes`.
3. Gateway renders QR and manual code locally.
4. iOS companion scans or receives the manual code and calls the Gateway claim endpoint.
5. Desktop shows the companion device label and matching `displayCode`.
6. Desktop user confirms. Gateway stores the device public key, grant scopes, creation time, and
   active session metadata.

Failure path:

1. Any expired, reused, mismatched, or rejected claim moves the offer to `failed`.
2. Gateway returns a structured error to the companion.
3. Gateway records a redacted audit entry with the failure reason and no nonce, token, or raw code.

## Initial scopes

The initial companion scope should be narrow:

| Scope | Allows |
| --- | --- |
| `approval_forwarding` | Receive pending operation approval summaries and submit approve or deny decisions. |
| `pairing_status` | Read this companion's paired, expired, or revoked state. |

The initial pairing must not grant:

- access to unshared tabs,
- direct tab reads, screenshots, console, network, cookies, or Web Storage,
- all-tabs profile access,
- plugin execution,
- eval,
- desktop file access.

Future scopes must be added explicitly and shown in the desktop confirmation screen before they are
stored in a grant.

## Revocation

The desktop Gateway is the revocation authority. Revocation can be triggered from the Gateway UI,
the CLI, or a future local settings file migration.

Minimum CLI shape:

```bash
abg companion list
abg companion revoke <device-id>
```

Revocation steps:

1. Mark the device grant as `revoked` with `revokedAt` and `revokedBy`.
2. Delete or invalidate active session tokens for that device.
3. Close active companion WebSocket sessions.
4. Reject future companion calls from that device with `pairing_revoked`.
5. Keep a redacted revoked-device row for audit and UI history.

After revocation, the companion can no longer:

- receive approval requests,
- approve or deny desktop operations,
- read pairing status except a redacted `revoked` response for its own last-known device id,
- refresh sessions,
- request new scopes under the old grant.

Revocation does not remove ordinary desktop tab shares, all-tabs profile settings, or audit log rows.
Those remain owned by the desktop Gateway and existing browser consent model.

## Approval forwarding

This section defines what a paired companion sees and can decide under the `approval_forwarding`
scope, and the MVP boundary for the first implementation
([#72](https://github.com/arcmanagement/agent-browser-gateway/issues/72)).

### Approval request payload

The desktop Gateway forwards a pending operation approval to paired companions as a summary, never
as the raw command:

| Field | Content |
| --- | --- |
| `approvalId` | The pending approval's identifier; approve/deny must echo it. |
| `method` | The operation kind shown to the desktop approval window (for example `record_start`, `eval_script`, `personal_data_mutation`). |
| `intent` | The same human-readable intent string the desktop approval window shows. |
| `target.origin` | Origin of the target tab. The full URL and title stay on the desktop. |
| `target.tabRef` | The stable tab ref, so the phone and desktop name the same tab. |
| `requester` | Which agent surface asked: `cli`, `mcp`, or a plugin name. |
| `gatewayLabel` | The desktop Gateway's profile label and hostname, so multiple desktops stay distinguishable. |
| `createdAt` / `expiresAt` | The approval window's own expiry; the phone shows the same countdown. |
| `scriptPreview` | Only for `eval_script`: the same truncated script block the desktop window shows. |

### Decision rules and misuse protections

- **Impersonation**: approval requests reach only companions whose grant carries
  `approval_forwarding`, over the pairing-authenticated session; the phone displays `gatewayLabel`
  from the stored grant, not from the message, so a spoofed payload cannot claim another desktop.
- **Stale approvals**: a decision carries `approvalId` and is rejected with `approval_expired` when
  the window already timed out, was decided elsewhere, or the underlying tab share was revoked.
  First decision wins across the desktop window and every paired phone; later decisions get
  `approval_already_decided`.
- **Accidental approval**: the phone UI defaults to Deny, requires a distinct confirm gesture for
  Allow, and uses the stronger destructive copy for the same operations the desktop window treats
  as destructive (deletes, recording with microphone).
- **Mismatched desktop sessions**: a companion paired with several Gateways shows the
  `gatewayLabel` on every request, and a decision is bound to the session that delivered the
  request, so an approval can never cross Gateways.
- Silent approval stays impossible: forwarding never bypasses the desktop approval flow — it is a
  second surface for the same pending approval, and the desktop audit log records which surface
  decided (`decidedBy: "desktop_window" | "companion:<deviceIdHash>"`).

### MVP boundary

The first implementation forwards read-only summaries and binary decisions only:

1. Forward pending approvals with the payload above; no tab content, screenshots, or DOM ever
   leave the desktop.
2. Accept `allow` / `deny` with `approvalId`; everything else stays desktop-only.
3. No push transport: the companion receives requests over the active `WS /companion` session when
   the app is open. Push notification delivery is a later scope with its own review because it
   moves approval metadata through third-party infrastructure.
4. Recording approvals are not forwardable in the MVP: minting the capture stream requires the
   desktop gesture (see the tabCapture constraint in #369), so the phone can only deny them early.

## Desktop audit log policy

Pairing uses the existing desktop audit JSONL shape:

```json
{
  "ts": "2026-07-08T00:00:00Z",
  "action": "pairing_offer_created",
  "agent": "gateway",
  "details": {}
}
```

Do not log raw QR payloads, manual codes, nonces, access tokens, refresh tokens, private keys, or
full device identifiers. Store stable hashes where correlation is needed.

Minimum events:

| Event | When | Minimum details |
| --- | --- | --- |
| `pairing_offer_created` | Desktop creates a QR/manual offer. | `pairingIdHash`, `method`, `requestedScopes`, `expiresAt`, `networkMode`, `ok: true` |
| `pairing_claimed` | Companion submits a valid nonce proof before desktop confirmation. | `pairingIdHash`, `deviceIdHash`, `deviceLabel`, `requestedScopes`, `ok: true` |
| `pairing_confirmed` | Desktop user confirms the displayed code and grant is stored. | `pairingIdHash`, `deviceIdHash`, `grantedScopes`, `confirmedBy: "desktop_user"`, `ok: true` |
| `pairing_revoked` | Desktop revokes a stored grant. | `deviceIdHash`, `revokedScopes`, `revokedBy`, `activeSessionsClosed`, `ok: true` |
| `pairing_failed` | Offer creation, claim, confirmation, or session setup fails. | `pairingIdHash` when available, `deviceIdHash` when known, `stage`, `reason`, `ok: false` |

Recommended failure reasons:

- `expired_offer`
- `nonce_mismatch`
- `duplicate_claim`
- `desktop_rejected`
- `network_not_private`
- `scope_not_allowed`
- `device_key_invalid`
- `rate_limited`

## Validation checklist

- A reviewer can follow the state table from `idle` to `paired` and from `paired` to `revoked`.
- QR and manual code use the same pairing offer fields.
- The desktop Gateway has an explicit receiving surface for offer creation, claim, confirmation,
  listing, revocation, and companion sessions.
- Revocation states the exact companion permissions that stop working.
- Audit events cover creation, confirmation, revocation, and failure with redacted fields only.
