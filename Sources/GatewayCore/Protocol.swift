import Foundation

// MARK: - Shared model

public struct PermittedTab: Codable, Hashable, Sendable {
    public let extensionId: String
    public let tabId: Int
    public var url: String
    public var title: String
    public var origin: String
    public var permittedAt: Date
    public var expiresAt: Date?

    public init(extensionId: String, tabId: Int, url: String, title: String, origin: String, permittedAt: Date, expiresAt: Date? = nil) {
        self.extensionId = extensionId
        self.tabId = tabId
        self.url = url
        self.title = title
        self.origin = origin
        self.permittedAt = permittedAt
        self.expiresAt = expiresAt
    }

    public var isExpired: Bool {
        if let expiresAt = expiresAt { return Date() >= expiresAt }
        return false
    }
}

// MARK: - Extension <-> Gateway protocol (over WebSocket)

public enum ExtensionMessage: Codable, Sendable {
    case hello(extensionId: String, version: String, profileLabel: String?, browserKind: String?)
    case tabPermitted(tabId: Int, url: String, title: String, origin: String, expiresAt: Date?)
    case tabRevoked(tabId: Int, reason: String)
    case tabUpdated(tabId: Int, url: String, title: String, origin: String)
    case tabClosed(tabId: Int)
    case response(id: String, result: AnyCodable?, error: ErrorPayload?)

    enum CodingKeys: String, CodingKey { case type, extensionId, version, profileLabel, browserKind, tabId, url, title, origin, expiresAt, reason, id, result, error }
    enum MsgType: String, Codable { case hello, tabPermitted = "tab_permitted", tabRevoked = "tab_revoked", tabUpdated = "tab_updated", tabClosed = "tab_closed", response }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let type = try c.decode(MsgType.self, forKey: .type)
        switch type {
        case .hello:
            self = .hello(
                extensionId: try c.decode(String.self, forKey: .extensionId),
                version: try c.decode(String.self, forKey: .version),
                profileLabel: try c.decodeIfPresent(String.self, forKey: .profileLabel),
                browserKind: try c.decodeIfPresent(String.self, forKey: .browserKind)
            )
        case .tabPermitted:
            self = .tabPermitted(
                tabId: try c.decode(Int.self, forKey: .tabId),
                url: try c.decode(String.self, forKey: .url),
                title: try c.decode(String.self, forKey: .title),
                origin: try c.decode(String.self, forKey: .origin),
                expiresAt: try c.decodeIfPresent(Date.self, forKey: .expiresAt)
            )
        case .tabRevoked:
            self = .tabRevoked(
                tabId: try c.decode(Int.self, forKey: .tabId),
                reason: try c.decodeIfPresent(String.self, forKey: .reason) ?? "unknown"
            )
        case .tabUpdated:
            self = .tabUpdated(
                tabId: try c.decode(Int.self, forKey: .tabId),
                url: try c.decode(String.self, forKey: .url),
                title: try c.decode(String.self, forKey: .title),
                origin: try c.decode(String.self, forKey: .origin)
            )
        case .tabClosed:
            self = .tabClosed(tabId: try c.decode(Int.self, forKey: .tabId))
        case .response:
            self = .response(
                id: try c.decode(String.self, forKey: .id),
                result: try c.decodeIfPresent(AnyCodable.self, forKey: .result),
                error: try c.decodeIfPresent(ErrorPayload.self, forKey: .error)
            )
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .hello(let extensionId, let version, let profileLabel, let browserKind):
            try c.encode(MsgType.hello, forKey: .type)
            try c.encode(extensionId, forKey: .extensionId)
            try c.encode(version, forKey: .version)
            try c.encodeIfPresent(profileLabel, forKey: .profileLabel)
            try c.encodeIfPresent(browserKind, forKey: .browserKind)
        case .tabPermitted(let tabId, let url, let title, let origin, let expiresAt):
            try c.encode(MsgType.tabPermitted, forKey: .type)
            try c.encode(tabId, forKey: .tabId)
            try c.encode(url, forKey: .url)
            try c.encode(title, forKey: .title)
            try c.encode(origin, forKey: .origin)
            try c.encodeIfPresent(expiresAt, forKey: .expiresAt)
        case .tabRevoked(let tabId, let reason):
            try c.encode(MsgType.tabRevoked, forKey: .type)
            try c.encode(tabId, forKey: .tabId)
            try c.encode(reason, forKey: .reason)
        case .tabUpdated(let tabId, let url, let title, let origin):
            try c.encode(MsgType.tabUpdated, forKey: .type)
            try c.encode(tabId, forKey: .tabId)
            try c.encode(url, forKey: .url)
            try c.encode(title, forKey: .title)
            try c.encode(origin, forKey: .origin)
        case .tabClosed(let tabId):
            try c.encode(MsgType.tabClosed, forKey: .type)
            try c.encode(tabId, forKey: .tabId)
        case .response(let id, let result, let error):
            try c.encode(MsgType.response, forKey: .type)
            try c.encode(id, forKey: .id)
            try c.encodeIfPresent(result, forKey: .result)
            try c.encodeIfPresent(error, forKey: .error)
        }
    }
}

public struct GatewayCommand: Codable, Sendable {
    public let id: String
    public let method: String
    public let params: AnyCodable?

    public init(id: String, method: String, params: AnyCodable? = nil) {
        self.id = id
        self.method = method
        self.params = params
    }
}

// MARK: - CLI <-> Gateway protocol (over Unix Domain Socket)
// Line-delimited JSON. Each line is one Request or Response.

public struct CLIRequest: Codable, Sendable {
    public let id: String
    public let method: String
    public let params: AnyCodable?

    public init(id: String, method: String, params: AnyCodable? = nil) {
        self.id = id
        self.method = method
        self.params = params
    }
}

public struct CLIResponse: Codable, Sendable {
    public let id: String
    public let result: AnyCodable?
    public let error: ErrorPayload?

    public init(id: String, result: AnyCodable? = nil, error: ErrorPayload? = nil) {
        self.id = id
        self.result = result
        self.error = error
    }
}

public struct ErrorPayload: Codable, Sendable {
    public let code: String
    public let message: String

    public init(code: String, message: String) {
        self.code = code
        self.message = message
    }
}

// MARK: - AnyCodable (lightweight type-erased Codable)

public struct AnyCodable: @unchecked Sendable, Codable {
    public let value: Any

    public init(_ value: Any) { self.value = value }

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { value = NSNull(); return }
        if let b = try? c.decode(Bool.self) { value = b; return }
        if let i = try? c.decode(Int.self) { value = i; return }
        if let d = try? c.decode(Double.self) { value = d; return }
        if let s = try? c.decode(String.self) { value = s; return }
        if let a = try? c.decode([AnyCodable].self) { value = a.map(\.value); return }
        if let o = try? c.decode([String: AnyCodable].self) { value = o.mapValues(\.value); return }
        throw DecodingError.dataCorruptedError(in: c, debugDescription: "Unsupported AnyCodable value")
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch value {
        case is NSNull: try c.encodeNil()
        case let v as Bool: try c.encode(v)
        case let v as Int: try c.encode(v)
        case let v as Double: try c.encode(v)
        case let v as String: try c.encode(v)
        case let v as [Any]: try c.encode(v.map { AnyCodable($0) })
        case let v as [String: Any]: try c.encode(v.mapValues { AnyCodable($0) })
        default:
            try c.encodeNil()
        }
    }
}
