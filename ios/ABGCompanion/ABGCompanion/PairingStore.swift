import CryptoKit
import Foundation
import Security

/// Device identity and the paired session, held in the Keychain. The private key
/// and the session token never leave the device; only the public key is sent to
/// the desktop during pairing.
struct PairedGateway: Codable, Equatable, Sendable {
    let deviceId: String
    let gatewayBaseUrl: String
    let gatewayLabel: String
    let pairedAt: Date
}

protocol SecretStoring: Sendable {
    func read(_ account: String) -> Data?
    func write(_ data: Data, account: String)
    func delete(_ account: String)
}

struct KeychainStore: SecretStoring {
    let service = "jp.co.arcm.AgentBrowserGateway.companion"

    func read(_ account: String) -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess else { return nil }
        return item as? Data
    }

    func write(_ data: Data, account: String) {
        delete(account)
        let attributes: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: data,
            // The companion only acts while the user is in the app, so the
            // strictest practical protection class applies.
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]
        SecItemAdd(attributes as CFDictionary, nil)
    }

    func delete(_ account: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }
}

/// In-memory store for previews and tests.
final class MemorySecretStore: SecretStoring, @unchecked Sendable {
    private let lock = NSLock()
    private var items: [String: Data] = [:]

    func read(_ account: String) -> Data? {
        lock.lock(); defer { lock.unlock() }
        return items[account]
    }

    func write(_ data: Data, account: String) {
        lock.lock(); defer { lock.unlock() }
        items[account] = data
    }

    func delete(_ account: String) {
        lock.lock(); defer { lock.unlock() }
        items.removeValue(forKey: account)
    }
}

struct PairingStore: Sendable {
    private enum Account {
        static let deviceKey = "device-private-key"
        static let sessionToken = "session-token"
        static let gateway = "paired-gateway"
    }

    let secrets: SecretStoring

    init(secrets: SecretStoring = KeychainStore()) {
        self.secrets = secrets
    }

    /// Stable per-install identity. Generated once, then reused so re-pairing the
    /// same device does not churn keys.
    func devicePrivateKey() -> Curve25519.KeyAgreement.PrivateKey {
        if let data = secrets.read(Account.deviceKey),
           let key = try? Curve25519.KeyAgreement.PrivateKey(rawRepresentation: data) {
            return key
        }
        let key = Curve25519.KeyAgreement.PrivateKey()
        secrets.write(key.rawRepresentation, account: Account.deviceKey)
        return key
    }

    var devicePublicKeyBase64: String {
        devicePrivateKey().publicKey.rawRepresentation.base64EncodedString()
    }

    func loadGateway() -> PairedGateway? {
        guard let data = secrets.read(Account.gateway) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try? decoder.decode(PairedGateway.self, from: data)
    }

    func saveGateway(_ gateway: PairedGateway, sessionToken: String) {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        if let data = try? encoder.encode(gateway) {
            secrets.write(data, account: Account.gateway)
        }
        secrets.write(Data(sessionToken.utf8), account: Account.sessionToken)
    }

    func sessionToken() -> String? {
        secrets.read(Account.sessionToken).flatMap { String(data: $0, encoding: .utf8) }
    }

    /// Forgets the pairing. The device key survives so the same identity is
    /// reused if the user pairs with the desktop again.
    func clearPairing() {
        secrets.delete(Account.gateway)
        secrets.delete(Account.sessionToken)
    }
}
