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

private struct SharedPairingSession: Codable, Sendable {
    let gateway: PairedGateway
    let sessionToken: String
}

struct AppGroupPairingSessionStore: Sendable {
    private let sessionURL: URL?

    init(groupIdentifier: String? = AppGroupPairingSessionStore.configuredGroupIdentifier) {
        guard let groupIdentifier,
              let container = FileManager.default.containerURL(
                  forSecurityApplicationGroupIdentifier: groupIdentifier
              ) else {
            sessionURL = nil
            return
        }
        sessionURL = container.appendingPathComponent("pairing-session.json", isDirectory: false)
    }

    init(sessionURL: URL?) {
        self.sessionURL = sessionURL
    }

    private static var configuredGroupIdentifier: String? {
        let value = Bundle.main.object(forInfoDictionaryKey: "ABGAppGroupIdentifier") as? String
        return value?.isEmpty == false ? value : nil
    }

    func load() -> (gateway: PairedGateway, sessionToken: String)? {
        guard let sessionURL,
              let data = try? Data(contentsOf: sessionURL),
              let session = try? JSONDecoder.iso8601.decode(SharedPairingSession.self, from: data) else {
            return nil
        }
        return (session.gateway, session.sessionToken)
    }

    func save(gateway: PairedGateway, sessionToken: String) {
        guard let sessionURL,
              let data = try? JSONEncoder.iso8601.encode(
                  SharedPairingSession(gateway: gateway, sessionToken: sessionToken)
              ) else {
            return
        }
        do {
            try data.write(to: sessionURL, options: [.atomic, .completeFileProtection])
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            var mutableURL = sessionURL
            try mutableURL.setResourceValues(values)
        } catch {
            try? FileManager.default.removeItem(at: sessionURL)
        }
    }

    func clear() {
        guard let sessionURL else { return }
        try? FileManager.default.removeItem(at: sessionURL)
    }
}

private extension JSONEncoder {
    static var iso8601: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }
}

private extension JSONDecoder {
    static var iso8601: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}

protocol SecretStoring: Sendable {
    func read(_ account: String) -> Data?
    func write(_ data: Data, account: String)
    func delete(_ account: String)
}

struct KeychainStore: SecretStoring {
    let service = "jp.co.arcm.AgentBrowserGateway.companion"
    let accessGroup: String?

    init(accessGroup: String? = KeychainStore.configuredAccessGroup) {
        self.accessGroup = accessGroup
    }

    private static var configuredAccessGroup: String? {
        let value = Bundle.main.object(forInfoDictionaryKey: "ABGKeychainAccessGroup") as? String
        return value?.isEmpty == false ? value : nil
    }

    func read(_ account: String) -> Data? {
        if let data = read(account, accessGroup: accessGroup) {
            return data
        }
        guard accessGroup != nil, let legacyData = read(account, accessGroup: nil) else {
            return nil
        }
        write(legacyData, account: account)
        return legacyData
    }

    private func read(_ account: String, accessGroup: String?) -> Data? {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        if let accessGroup {
            query[kSecAttrAccessGroup as String] = accessGroup
        }
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess else { return nil }
        return item as? Data
    }

    func write(_ data: Data, account: String) {
        delete(account)
        var attributes: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: data,
            // The companion only acts while the user is in the app, so the
            // strictest practical protection class applies.
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]
        if let accessGroup {
            attributes[kSecAttrAccessGroup as String] = accessGroup
        }
        SecItemAdd(attributes as CFDictionary, nil)
    }

    func delete(_ account: String) {
        delete(account, accessGroup: accessGroup)
        if accessGroup != nil {
            delete(account, accessGroup: nil)
        }
    }

    private func delete(_ account: String, accessGroup: String?) {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        if let accessGroup {
            query[kSecAttrAccessGroup as String] = accessGroup
        }
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
    let sharedSession: AppGroupPairingSessionStore

    init(
        secrets: SecretStoring = KeychainStore(),
        sharedSession: AppGroupPairingSessionStore = AppGroupPairingSessionStore()
    ) {
        self.secrets = secrets
        self.sharedSession = sharedSession
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
        if let shared = sharedSession.load() {
            return shared.gateway
        }
        guard let data = secrets.read(Account.gateway) else { return nil }
        guard let gateway = try? JSONDecoder.iso8601.decode(PairedGateway.self, from: data) else {
            return nil
        }
        if let tokenData = secrets.read(Account.sessionToken),
           let sessionToken = String(data: tokenData, encoding: .utf8) {
            sharedSession.save(gateway: gateway, sessionToken: sessionToken)
        }
        return gateway
    }

    func saveGateway(_ gateway: PairedGateway, sessionToken: String) {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        if let data = try? encoder.encode(gateway) {
            secrets.write(data, account: Account.gateway)
        }
        secrets.write(Data(sessionToken.utf8), account: Account.sessionToken)
        sharedSession.save(gateway: gateway, sessionToken: sessionToken)
    }

    func sessionToken() -> String? {
        if let shared = sharedSession.load() {
            return shared.sessionToken
        }
        return secrets.read(Account.sessionToken).flatMap { String(data: $0, encoding: .utf8) }
    }

    /// Forgets the pairing. The device key survives so the same identity is
    /// reused if the user pairs with the desktop again.
    func clearPairing() {
        sharedSession.clear()
        secrets.delete(Account.gateway)
        secrets.delete(Account.sessionToken)
    }
}
