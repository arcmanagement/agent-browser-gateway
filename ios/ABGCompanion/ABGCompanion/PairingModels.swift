import CryptoKit
import Foundation

// Wire types shared with the desktop Gateway, mirroring docs/IOS_GATEWAY_PAIRING.md.
// The companion never receives tab content: approvals arrive as summaries only.

struct PairingOfferPayload: Codable, Equatable, Sendable {
    let gatewayBaseUrl: String
    let pairingId: String
    let pairingNonce: String
    let desktopPublicKey: String
    let expiresAt: Date
    let displayCode: String
    let requestedScopes: [String]

    /// Parses the QR payload (JSON) produced by `abg companion offer --qr`.
    static func parse(qrPayload: String) throws -> PairingOfferPayload {
        guard let data = qrPayload.data(using: .utf8) else { throw PairingClientError.malformedOffer }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        do {
            return try decoder.decode(PairingOfferPayload.self, from: data)
        } catch {
            throw PairingClientError.malformedOffer
        }
    }
}

/// Manual-entry form: `ABG-PAIR-<pairingId>-<displayCode>-<nonceFragment>`.
/// The fragment alone cannot claim an offer, so manual entry also asks for the
/// gateway address and the full nonce shown on the desktop.
struct ManualPairingCode: Equatable, Sendable {
    let pairingId: String
    let displayCode: String
    let nonceFragment: String

    static func parse(_ raw: String) throws -> ManualPairingCode {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        let parts = trimmed.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 5, parts[0] == "ABG", parts[1] == "PAIR",
              !parts[2].isEmpty, parts[3].count == 6, !parts[4].isEmpty else {
            throw PairingClientError.malformedOffer
        }
        return ManualPairingCode(
            pairingId: String(parts[2]).lowercased(),
            displayCode: String(parts[3]),
            nonceFragment: String(parts[4]).lowercased()
        )
    }
}

struct ClaimResponse: Codable, Sendable {
    let ok: Bool
    let deviceId: String?
    let state: String?
    let error: String?
    let message: String?
}

struct SealedSession: Codable, Sendable {
    let ephemeralPublicKey: String
    let ciphertext: String
}

struct PairingStatusResponse: Codable, Sendable {
    let state: String
    let deviceId: String?
    let session: SealedSession?
}

/// Approval summary forwarded from the desktop. Mirrors CompanionApprovalSummary.
struct ApprovalSummary: Codable, Identifiable, Equatable, Sendable {
    let approvalId: String
    let method: String
    let intent: String
    let targetOrigin: String
    let targetTabRef: String
    let requester: String
    let gatewayLabel: String
    let createdAt: Date
    let expiresAt: Date
    let scriptPreview: String?
    let requestId: String?
    let nativeAction: NativeAction?
    let canAllow: Bool

    var id: String { approvalId }

    /// Operations whose approval window uses stronger confirmation copy: the
    /// phone must not make these one-tap decisions.
    var isDestructive: Bool {
        switch method {
        case "personal_data_mutation", "record_start", "eval_script":
            return true
        default:
            return intent.contains("PERMANENTLY DELETE")
        }
    }

    func isExpired(at date: Date = Date()) -> Bool { date >= expiresAt }
}

struct NativeAction: Codable, Equatable, Sendable {
    let kind: String
    let url: String
    let title: String?
}

struct NativeResult: Codable, Equatable, Sendable {
    let ok: Bool
    let url: String?
    let error: String?
}

enum CompanionEvent: Sendable {
    case pending(ApprovalSummary)
    case resolved(approvalId: String, decision: String, decidedBy: String)
    case decisionResult(approvalId: String, ok: Bool, error: String?)

    static func decode(_ text: String) -> CompanionEvent? {
        guard let data = text.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = object["type"] as? String else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        switch type {
        case "approval_pending":
            guard let approval = object["approval"],
                  let approvalData = try? JSONSerialization.data(withJSONObject: approval),
                  let summary = try? decoder.decode(ApprovalSummary.self, from: approvalData) else { return nil }
            return .pending(summary)
        case "approval_resolved":
            guard let approvalId = object["approvalId"] as? String,
                  let decision = object["decision"] as? String else { return nil }
            return .resolved(
                approvalId: approvalId,
                decision: decision,
                decidedBy: object["decidedBy"] as? String ?? "desktop_window"
            )
        case "decision_result":
            guard let approvalId = object["approvalId"] as? String,
                  let ok = object["ok"] as? Bool else { return nil }
            return .decisionResult(approvalId: approvalId, ok: ok, error: object["error"] as? String)
        default:
            return nil
        }
    }
}

enum PairingClientError: LocalizedError, Equatable {
    case malformedOffer
    case offerExpired
    case claimRejected(String)
    case notPaired
    case sessionUnavailable
    case transport(String)

    var errorDescription: String? {
        switch self {
        case .malformedOffer:
            return "That pairing code is not readable. Scan the QR code shown by your Gateway, or re-enter the manual code."
        case .offerExpired:
            return "The pairing offer expired. Create a new one on the desktop and try again."
        case .claimRejected(let reason):
            switch reason {
            case "duplicate_claim":
                return "Another device already claimed this pairing offer. Create a new offer on the desktop."
            case "nonce_mismatch":
                return "The pairing code did not match. Check the code on the desktop and try again."
            case "expired_offer":
                return "The pairing offer expired. Create a new one on the desktop."
            case "scope_not_allowed":
                return "The desktop offered fewer permissions than this app requested."
            default:
                return "The desktop rejected the pairing request (\(reason))."
            }
        case .notPaired:
            return "This device is not paired with a Gateway yet."
        case .sessionUnavailable:
            return "The pairing finished but the session key could not be read. Pair again from the desktop."
        case .transport(let message):
            return message
        }
    }
}

/// Opens the session token the desktop sealed to this device's public key.
enum SessionSealing {
    static let info = Data("abg-companion-session-v1".utf8)

    static func open(_ sealed: SealedSession, privateKey: Curve25519.KeyAgreement.PrivateKey) throws -> String {
        guard let ephemeralData = Data(base64Encoded: sealed.ephemeralPublicKey),
              let ephemeral = try? Curve25519.KeyAgreement.PublicKey(rawRepresentation: ephemeralData),
              let combined = Data(base64Encoded: sealed.ciphertext) else {
            throw PairingClientError.sessionUnavailable
        }
        let shared = try privateKey.sharedSecretFromKeyAgreement(with: ephemeral)
        let key = shared.hkdfDerivedSymmetricKey(
            using: SHA256.self,
            salt: Data(),
            sharedInfo: info,
            outputByteCount: 32
        )
        let box = try ChaChaPoly.SealedBox(combined: combined)
        let plain = try ChaChaPoly.open(box, using: key)
        guard let token = String(data: plain, encoding: .utf8) else {
            throw PairingClientError.sessionUnavailable
        }
        return token
    }
}
