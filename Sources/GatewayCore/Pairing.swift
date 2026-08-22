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
    public var revokedAt: Date?
    public var revokedBy: String?

    public var isActive: Bool { revokedAt == nil }
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

    /// Desktop user confirmed the display code: the claim becomes a grant.
    public mutating func confirm(pairingId: String, now: Date = Date()) throws -> CompanionGrant {
        guard var offer = activeOffer, offer.pairingId == pairingId else {
            throw PairingError(.offerNotFound)
        }
        guard now < offer.expiresAt else {
            expireActiveOffer(now: now)
            throw PairingError(.expiredOffer)
        }
        guard let claim = offer.claim else { throw PairingError(.notClaimed) }
        let grant = CompanionGrant(
            deviceId: claim.deviceId,
            deviceLabel: claim.deviceLabel,
            devicePublicKeyBase64: claim.devicePublicKeyBase64,
            scopes: claim.requestedScopes,
            pairedAt: now,
            revokedAt: nil,
            revokedBy: nil
        )
        grants.append(grant)
        offer.state = .paired
        activeOffer = nil
        return grant
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
