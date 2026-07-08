# Remote Pairing over Tailnet or LAN

This document defines the planned ABG remote-pairing flow for a user-controlled Tailnet or LAN. It is
an architecture contract for implementation work: the flow must not require, contact, or depend on an
ABG-operated cloud relay.

## Goals

- Let a CLI or MCP client on one trusted device connect to a Gateway on another trusted device.
- Use only user-controlled network paths, such as a Tailnet hostname, LAN address, or user-operated
  reverse proxy.
- Make pairing explicit, short-lived, revocable, and visible in the local audit log.
- Preserve the existing consent model: remote transport must not grant access to unshared tabs or
  bypass approval prompts.

## Non-Goals

- ABG-operated relay, rendezvous, account, push-notification, or telemetry service.
- Internet-wide discovery of Gateways.
- Long-lived bearer tokens in QR codes.
- Silent remote access to a personal browser profile.
- Any weakening of local extension-to-Gateway origin checks.

## Roles

- **Gateway device**: the machine running the ABG Gateway and browser extension.
- **Client device**: the machine running `abg`, an MCP wrapper, or another local client.
- **Local user**: the person physically controlling the Gateway device and approving pairing.

## Transport Boundary

The default Gateway remains loopback-only. Remote pairing requires an explicit user setting that binds
a separate remote listener to a user-selected private interface or hostname.

Allowed listener targets:

- `100.64.0.0/10` Tailnet addresses or a user-provided Tailnet DNS name.
- RFC1918 LAN addresses.
- A user-operated endpoint that terminates to the Gateway device and is documented as self-hosted.

Disallowed listener targets:

- Any ABG-operated relay or rendezvous endpoint.
- A default public `0.0.0.0` listener.
- Any listener that starts before the user enables remote pairing.

The remote listener must use TLS. On Tailnet, the implementation may rely on the Tailnet transport
identity and still use application-layer pairing tokens. On LAN, the QR payload must include a
certificate fingerprint or equivalent trust-on-first-use pin so the client can detect a different
endpoint before sending the pairing secret.

## Pairing Flow

1. The local user opens the Gateway pairing view and chooses `Create pairing code`.
2. The Gateway creates a random one-time pairing secret with at least 128 bits of entropy.
3. The Gateway stores only a hash of the secret, the intended remote endpoint, the scope, the expiry
   time, and a `pending` state.
4. The Gateway shows a QR code and a copyable text code. The QR payload uses an `abg-pair:` URI:

   ```text
   abg-pair://v1?endpoint=https%3A%2F%2Fgateway.tailnet.example%3A8766&code=<secret>&expires=<unix-time>&fingerprint=<tls-pin>&scope=remote-cli
   ```

5. The client scans or pastes the payload and connects directly to the endpoint over the private
   network path.
6. The client sends the one-time secret over TLS with a client-generated public key.
7. The Gateway verifies that the secret hash matches one pending token and that the token has not
   expired or been revoked.
8. The Gateway marks the token as consumed, stores the client public-key fingerprint as a paired
   device record, and returns a short capability credential bound to that client key.
9. Future requests use the paired device credential and proof of possession of the client private key.
10. The local user can revoke the paired device from the Gateway UI or CLI at any time.

The QR code is an invitation, not a durable credential. After first use, expiry, or revocation, the
same QR payload must fail.

## Token Expiry

- Default expiry: 10 minutes.
- Maximum expiry: 30 minutes.
- Pairing tokens are single-use.
- Expired tokens are rejected before any client device record is created.
- Expired pending tokens may be removed during startup or periodic cleanup.

The implementation must compare expiry using Gateway-local time and include the expiry timestamp in
the QR payload so the client can show useful feedback before attempting to pair.

## Revocation

The Gateway must support two revocation levels:

- **Pending token revocation**: cancels an unused QR/text code.
- **Paired device revocation**: removes an already paired client credential.

Revocation must take effect before the next command from the revoked client is authorized. A revoked
client may receive an authentication error, but must not be allowed to read tabs, issue browser
commands, or create new pairing tokens.

## Audit Log

Remote pairing and revocation are local security events and must be recorded in the Gateway audit log.
Audit entries must avoid writing raw pairing secrets, full client credentials, or private keys.

Required audit actions:

| Action | When | Required details |
|---|---|---|
| `remote_pairing_token_created` | A QR/text code is created | token id, endpoint host, scope, expiry, listener kind |
| `remote_pairing_token_consumed` | A pending token becomes a paired device | token id, paired device id, client key fingerprint |
| `remote_pairing_token_expired` | A client attempts to use an expired token | token id when known, endpoint host |
| `remote_pairing_token_revoked` | The local user cancels an unused token | token id, reason |
| `remote_device_revoked` | The local user revokes a paired client | paired device id, client key fingerprint, reason |
| `remote_client_rejected` | A revoked or invalid client attempts access | paired device id or fingerprint when known, reason |

Normal browser operations from a remote client still use the existing operation audit actions, with
the `agent` or `details` field identifying the paired device id.

## Consent and Approval

Pairing a client does not share tabs. It only authorizes the remote client to use the same Gateway
surface that a local CLI could use after normal consent checks.

- Per-tab sharing still controls which tabs are visible.
- Origin-change auto-revocation still applies.
- Operation approval prompts still apply unless the local user has explicitly enabled a policy such
  as Trusted automation / AutoMode for that environment.
- General JavaScript eval remains disabled by default.
- A remote client must not enable all-tabs mode, Trusted automation, or eval without a local user
  action on the Gateway device.

## Storage

Remote pairing state should live under the Gateway support directory with owner-only permissions.
Stored records must contain hashes or public identifiers, not raw one-time secrets.

Minimum paired-device fields:

- paired device id,
- client public-key fingerprint,
- display name supplied by the client or local user,
- created timestamp,
- last seen timestamp,
- revoked timestamp when applicable,
- scope.

## Failure Handling

- Unknown, expired, consumed, or revoked tokens return a generic pairing failure to avoid revealing
  token validity.
- The audit log records the specific local reason.
- Repeated failed pairing attempts may trigger local rate limiting on the remote listener.
- If the remote listener cannot bind to the selected private interface, pairing fails closed and the
  Gateway logs a local configuration error.

## Validation Checklist

An implementation PR for this design must show:

- no ABG-operated cloud relay or rendezvous endpoint,
- QR or text token exchange over a direct Tailnet/LAN endpoint,
- hashed, single-use tokens with enforced expiry,
- pending-token and paired-device revocation,
- audit entries for token creation, consumption, expiry, revocation, and rejected revoked clients,
- remote browser operations still passing through existing tab consent and approval gates.
