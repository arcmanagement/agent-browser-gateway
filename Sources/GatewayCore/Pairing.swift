import Crypto
import Foundation

// Pairing model for the iOS companion, following docs/IOS_GATEWAY_PAIRING.md.
// The engine is a pure value type so the offer lifecycle, claim validation, and
// revocation semantics are unit-testable without a network listener.

public enum PairingScope: String, Codable, CaseIterable, Sendable {
    case approvalForwarding = "approval_forwarding"
    case pairingStatus = "pairing_status"
}

public enum PairingFailureReason: String, Sendable {
    case expiredOffer = "expired_offer"
    case nonceMismatch = "nonce_mismatch"
    case duplicateClaim = "duplicate_claim"
    case desktopRejected = "desktop_rejected"
    case scopeNotAllowed = "scope_not_allowed"
    case deviceKeyInvalid = "device_key_invalid"
    case offerNotFound = "offer_not_found"
    case notClaimed = "not_claimed"
    case pairingRevoked = "pairing_revoked"
    case sessionInvalid = "session_invalid"
}

public struct PairingError: Error, Sendable {
    public let reason: PairingFailureReason
    public init(_ reason: PairingFailureReason) { self.reason = reason }
}

/// Short-lived pairing offer. The nonce never leaves memory unhashed except in
/// the QR / manual-code payload rendered locally for the user.
public struct PairingOffer: Sendable {
    public enum State: String, Sendable {
        case active
        case claimed
        case paired
        case expired
        case rejected
    }

    public let pairingId: String
    public let nonce: String
    public let displayCode: String
    public let desktopPrivateKey: Curve25519.KeyAgreement.PrivateKey
    public let requestedScopes: [PairingScope]
    public let createdAt: Date
    public let expiresAt: Date
    public var state: State
    public var claim: PairingClaim?

    public var desktopPublicKeyBase64: String {
        desktopPrivateKey.publicKey.rawRepresentation.base64EncodedString()
    }
}

/// The companion's claim, held until the desktop user confirms the display code.
public struct PairingClaim: Sendable {
    public let deviceId: String
    public let deviceLabel: String
    public let devicePublicKeyBase64: String
    public let requestedScopes: [PairingScope]
    public let claimedAt: Date
}

/// A confirmed companion grant. Persisted; never contains the pairing nonce.
public struct CompanionGrant: Codable, Sendable {
    public let deviceId: String
    public let deviceLabel: String
    public let devicePublicKeyBase64: String
    public let scopes: [PairingScope]
    public let pairedAt: Date
    /// SHA-256 of the companion session token. The plain token exists only in
    /// memory until the companion fetches it once via the status endpoint.
    public var sessionTokenHash: String?
    public var sessionTokenDelivered: Bool?
    public var revokedAt: Date?
    public var revokedBy: String?

    public var isActive: Bool { revokedAt == nil }

    public func hasScope(_ scope: PairingScope) -> Bool { scopes.contains(scope) }
}

/// The QR and manual-code forms carry the same offer fields.
public struct PairingOfferPayload: Codable, Sendable {
    public let gatewayBaseUrl: String
    public let pairingId: String
    public let pairingNonce: String
    public let desktopPublicKey: String
    public let expiresAt: Date
    public let displayCode: String
    public let requestedScopes: [String]

    public var manualCode: String {
        "ABG-PAIR-\(pairingId)-\(displayCode)-\(String(pairingNonce.prefix(8)))"
    }
}

public struct PairingEngine: Sendable {
    /// Recommended maximum offer lifetime from the design doc.
    public static let maxOfferLifetime: TimeInterval = 5 * 60

    public private(set) var activeOffer: PairingOffer?
    public private(set) var grants: [CompanionGrant]
    /// pairingId → deviceId for offers that completed, so the status endpoint can
    /// answer the companion that just paired without leaking other grants.
    private var pairedOffers: [String: String] = [:]

    public init(grants: [CompanionGrant] = []) {
        self.activeOffer = nil
        self.grants = grants
    }

    /// Creates a new offer, replacing any previous one: a single active offer
    /// keeps the confirmation screen unambiguous about what is being approved.
    public mutating func createOffer(
        scopes: [PairingScope] = [.approvalForwarding, .pairingStatus],
        lifetime: TimeInterval = PairingEngine.maxOfferLifetime,
        now: Date = Date()
    ) -> PairingOffer {
        let offer = PairingOffer(
            pairingId: Self.randomToken(bytes: 8),
            nonce: Self.randomToken(bytes: 32),
            displayCode: Self.displayCode(),
            desktopPrivateKey: Curve25519.KeyAgreement.PrivateKey(),
            requestedScopes: scopes,
            createdAt: now,
            expiresAt: now.addingTimeInterval(min(lifetime, Self.maxOfferLifetime)),
            state: .active,
            claim: nil
        )
        activeOffer = offer
        return offer
    }

    /// Applies a companion claim. First valid claim wins; later ones fail as
    /// duplicates so an attacker cannot displace the device the user is holding.
    public mutating func applyClaim(
        pairingId: String,
        nonce: String,
        devicePublicKeyBase64: String,
        deviceLabel: String,
        requestedScopes: [PairingScope],
        now: Date = Date()
    ) throws -> PairingClaim {
        guard var offer = activeOffer, offer.pairingId == pairingId else {
            throw PairingError(.offerNotFound)
        }
        guard now < offer.expiresAt, offer.state == .active || offer.state == .claimed else {
            expireActiveOffer(now: now)
            throw PairingError(.expiredOffer)
        }
        guard offer.claim == nil else { throw PairingError(.duplicateClaim) }
        guard constantTimeEquals(nonce, offer.nonce) else { throw PairingError(.nonceMismatch) }
        guard let keyData = Data(base64Encoded: devicePublicKeyBase64),
              (try? Curve25519.KeyAgreement.PublicKey(rawRepresentation: keyData)) != nil else {
            throw PairingError(.deviceKeyInvalid)
        }
        guard Set(requestedScopes).isSubset(of: Set(offer.requestedScopes)) else {
            throw PairingError(.scopeNotAllowed)
        }
        let claim = PairingClaim(
            deviceId: Self.randomToken(bytes: 16),
            deviceLabel: String(deviceLabel.prefix(64)),
            devicePublicKeyBase64: devicePublicKeyBase64,
            requestedScopes: requestedScopes,
            claimedAt: now
        )
        offer.state = .claimed
        offer.claim = claim
        activeOffer = offer
        return claim
    }

    /// Desktop user confirmed the display code: the claim becomes a grant with a
    /// fresh session token. Only the token's hash is stored; the plain value is
    /// returned once for delivery to the companion.
    public mutating func confirm(pairingId: String, now: Date = Date()) throws -> (grant: CompanionGrant, sessionToken: String, offer: PairingOffer) {
        guard var offer = activeOffer, offer.pairingId == pairingId else {
            throw PairingError(.offerNotFound)
        }
        guard now < offer.expiresAt else {
            expireActiveOffer(now: now)
            throw PairingError(.expiredOffer)
        }
        guard let claim = offer.claim else { throw PairingError(.notClaimed) }
        let sessionToken = Self.randomToken(bytes: 32)
        let grant = CompanionGrant(
            deviceId: claim.deviceId,
            deviceLabel: claim.deviceLabel,
            devicePublicKeyBase64: claim.devicePublicKeyBase64,
            scopes: claim.requestedScopes,
            pairedAt: now,
            sessionTokenHash: Self.tokenHash(sessionToken),
            sessionTokenDelivered: false,
            revokedAt: nil,
            revokedBy: nil
        )
        grants.append(grant)
        offer.state = .paired
        activeOffer = nil
        pairedOffers[offer.pairingId] = grant.deviceId
        return (grant, sessionToken, offer)
    }

    /// Companion-facing pairing state for GET /pairings/:id/status.
    public enum PairingStatus: Sendable, Equatable {
        case offerActive
        case claimed
        case paired(deviceId: String)
        case revoked
        case unknown
    }

    public func status(pairingId: String, now: Date = Date()) -> PairingStatus {
        if let offer = activeOffer, offer.pairingId == pairingId, now < offer.expiresAt {
            return offer.claim == nil ? .offerActive : .claimed
        }
        if let deviceId = pairedOffers[pairingId] {
            if let grant = grants.first(where: { $0.deviceId == deviceId }) {
                return grant.isActive ? .paired(deviceId: deviceId) : .revoked
            }
        }
        return .unknown
    }

    public mutating func markSessionTokenDelivered(deviceId: String) {
        guard let index = grants.firstIndex(where: { $0.deviceId == deviceId }) else { return }
        grants[index].sessionTokenDelivered = true
    }

    /// Verifies a companion session credential with a constant-time comparison
    /// against the stored hash. Revoked grants never verify.
    public func verifySession(deviceId: String, sessionToken: String) -> Bool {
        guard let grant = activeGrant(deviceId: deviceId), let expected = grant.sessionTokenHash else {
            return false
        }
        return constantTimeEquals(Self.tokenHash(sessionToken), expected)
    }

    static func tokenHash(_ token: String) -> String {
        SHA256.hash(data: Data(token.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    /// Desktop user rejected the claim (display codes did not match).
    public mutating func reject(pairingId: String) throws {
        guard let offer = activeOffer, offer.pairingId == pairingId else {
            throw PairingError(.offerNotFound)
        }
        _ = offer
        activeOffer = nil
    }

    @discardableResult
    public mutating func revoke(deviceId: String, by: String, now: Date = Date()) -> CompanionGrant? {
        guard let index = grants.firstIndex(where: { $0.deviceId == deviceId && $0.isActive }) else {
            return nil
        }
        grants[index].revokedAt = now
        grants[index].revokedBy = by
        grants[index].sessionTokenHash = nil
        return grants[index]
    }

    public func activeGrant(deviceId: String) -> CompanionGrant? {
        grants.first(where: { $0.deviceId == deviceId && $0.isActive })
    }

    /// True while a listener accepting claims should be running.
    public func listenerShouldRun(now: Date = Date()) -> Bool {
        guard let offer = activeOffer else { return false }
        return now < offer.expiresAt && (offer.state == .active || offer.state == .claimed)
    }

    public mutating func expireActiveOffer(now: Date = Date()) {
        guard var offer = activeOffer else { return }
        if now >= offer.expiresAt {
            offer.state = .expired
            activeOffer = nil
        }
    }

    public func offerPayload(gatewayBaseUrl: String) -> PairingOfferPayload? {
        guard let offer = activeOffer, offer.state == .active else { return nil }
        return PairingOfferPayload(
            gatewayBaseUrl: gatewayBaseUrl,
            pairingId: offer.pairingId,
            pairingNonce: offer.nonce,
            desktopPublicKey: offer.desktopPublicKeyBase64,
            expiresAt: offer.expiresAt,
            displayCode: offer.displayCode,
            requestedScopes: offer.requestedScopes.map(\.rawValue)
        )
    }

    static func randomToken(bytes count: Int) -> String {
        var bytes = [UInt8](repeating: 0, count: count)
        for i in bytes.indices { bytes[i] = UInt8.random(in: .min ... .max) }
        return bytes.map { String(format: "%02x", $0) }.joined()
    }

    /// Six digits, shown on both devices for the human check before confirmation.
    static func displayCode() -> String {
        String(format: "%06d", Int.random(in: 0...999_999))
    }

    private func constantTimeEquals(_ a: String, _ b: String) -> Bool {
        let lhs = Array(a.utf8)
        let rhs = Array(b.utf8)
        guard lhs.count == rhs.count else { return false }
        var diff: UInt8 = 0
        for i in lhs.indices { diff |= lhs[i] ^ rhs[i] }
        return diff == 0
    }
}

/// SHA-256 based redaction for audit rows: pairing and device identifiers are
/// logged only as stable hashes, never as the raw values.
public enum PairingAudit {
    public static func hashed(_ value: String) -> String {
        let digest = SHA256.hash(data: Data(value.utf8))
        return digest.map { String(format: "%02x", $0) }.joined().prefix(16).lowercased()
    }
}

/// Persistence for confirmed grants. Offers and nonces are never written to disk.
public enum CompanionGrantStore {
    public static func load(from url: URL) -> [CompanionGrant] {
        guard let data = try? Data(contentsOf: url) else { return [] }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return (try? decoder.decode([CompanionGrant].self, from: data)) ?? []
    }

    public static func save(_ grants: [CompanionGrant], to url: URL) throws {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(grants)
        try data.write(to: url, options: .atomic)
        chmod(url.path, 0o600)
    }
}

/// Seals small payloads (the session token) to the companion's public key:
/// ephemeral Curve25519 ECDH → HKDF-SHA256 → ChaChaPoly. The companion opens it
/// with its private key and the returned ephemeral public key.
public enum PairingCrypto {
    public struct Sealed: Codable, Sendable {
        public let ephemeralPublicKey: String
        public let ciphertext: String
    }

    static let hkdfInfo = Data("abg-companion-session-v1".utf8)

    public static func seal(_ plaintext: String, toDevicePublicKeyBase64 device: String) throws -> Sealed {
        guard let deviceKeyData = Data(base64Encoded: device),
              let devicePublicKey = try? Curve25519.KeyAgreement.PublicKey(rawRepresentation: deviceKeyData) else {
            throw PairingError(.deviceKeyInvalid)
        }
        let ephemeral = Curve25519.KeyAgreement.PrivateKey()
        let shared = try ephemeral.sharedSecretFromKeyAgreement(with: devicePublicKey)
        let key = shared.hkdfDerivedSymmetricKey(
            using: SHA256.self,
            salt: Data(),
            sharedInfo: hkdfInfo,
            outputByteCount: 32
        )
        let box = try ChaChaPoly.seal(Data(plaintext.utf8), using: key)
        return Sealed(
            ephemeralPublicKey: ephemeral.publicKey.rawRepresentation.base64EncodedString(),
            ciphertext: box.combined.base64EncodedString()
        )
    }

    public static func open(_ sealed: Sealed, devicePrivateKey: Curve25519.KeyAgreement.PrivateKey) throws -> String {
        guard let ephemeralData = Data(base64Encoded: sealed.ephemeralPublicKey),
              let ephemeralKey = try? Curve25519.KeyAgreement.PublicKey(rawRepresentation: ephemeralData),
              let combined = Data(base64Encoded: sealed.ciphertext) else {
            throw PairingError(.sessionInvalid)
        }
        let shared = try devicePrivateKey.sharedSecretFromKeyAgreement(with: ephemeralKey)
        let key = shared.hkdfDerivedSymmetricKey(
            using: SHA256.self,
            salt: Data(),
            sharedInfo: hkdfInfo,
            outputByteCount: 32
        )
        let box = try ChaChaPoly.SealedBox(combined: combined)
        let plain = try ChaChaPoly.open(box, using: key)
        guard let text = String(data: plain, encoding: .utf8) else {
            throw PairingError(.sessionInvalid)
        }
        return text
    }
}

/// The approval summary forwarded to companions, per the approval-forwarding
/// design in docs/IOS_GATEWAY_PAIRING.md. Never contains tab content.
public struct CompanionApprovalSummary: Codable, Sendable {
    public let approvalId: String
    public let method: String
    public let intent: String
    public let targetOrigin: String
    public let targetTabRef: String
    public let requester: String
    public let gatewayLabel: String
    public let createdAt: Date
    public let expiresAt: Date
    public let scriptPreview: String?
    /// False for operations the phone can only deny (recording in the MVP).
    public let canAllow: Bool

    public init(approvalId: String, method: String, intent: String, targetOrigin: String, targetTabRef: String, requester: String, gatewayLabel: String, createdAt: Date, expiresAt: Date, scriptPreview: String?, canAllow: Bool) {
        self.approvalId = approvalId
        self.method = method
        self.intent = intent
        self.targetOrigin = targetOrigin
        self.targetTabRef = targetTabRef
        self.requester = requester
        self.gatewayLabel = gatewayLabel
        self.createdAt = createdAt
        self.expiresAt = expiresAt
        self.scriptPreview = scriptPreview
        self.canAllow = canAllow
    }
}
