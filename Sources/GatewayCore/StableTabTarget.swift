import Foundation

public struct StableTabIdentity: Hashable, Sendable {
    public let extensionId: String
    public let tabId: Int

    public init(extensionId: String, tabId: Int) {
        self.extensionId = extensionId
        self.tabId = tabId
    }
}

public struct StableTabTarget: Equatable, Sendable {
    public let ref: String
    public let targetId: Int

    public init(ref: String, targetId: Int) {
        self.ref = ref
        self.targetId = targetId
    }
}

/// Keeps a tab's CLI ref stable while the Gateway is running.
///
/// Chrome tab IDs are scoped to a browser profile, so two connected extensions
/// can report the same positive tab ID. Negative target IDs are Gateway-local
/// routing handles and cannot collide with Chrome's positive tab IDs.
public struct StableTabTargetRegistry: Sendable {
    private var targetByIdentity: [StableTabIdentity: StableTabTarget] = [:]
    private var identityByTargetId: [Int: StableTabIdentity] = [:]
    private var nextReference = 1
    private var nextTargetId = -1

    public init() {}

    public mutating func target(for identity: StableTabIdentity) -> StableTabTarget {
        if let target = targetByIdentity[identity] {
            return target
        }

        let target = StableTabTarget(ref: "t\(nextReference)", targetId: nextTargetId)
        targetByIdentity[identity] = target
        identityByTargetId[target.targetId] = identity
        nextReference += 1
        nextTargetId -= 1
        return target
    }

    public func identity(forTargetId targetId: Int) -> StableTabIdentity? {
        identityByTargetId[targetId]
    }

    public mutating func remove(_ identity: StableTabIdentity) {
        guard let target = targetByIdentity.removeValue(forKey: identity) else { return }
        identityByTargetId.removeValue(forKey: target.targetId)
    }

    public mutating func remove(extensionId: String) {
        let identities = targetByIdentity.keys.filter { $0.extensionId == extensionId }
        for identity in identities {
            remove(identity)
        }
    }

    public static func targetId(
        forRef ref: String,
        in targets: [StableTabTarget]
    ) -> Int? {
        targets.first {
            $0.ref.caseInsensitiveCompare(ref) == .orderedSame
        }?.targetId
    }
}

public enum EvalScriptLimits {
    /// Scripts at or below this size are the supported fast path.
    public static let recommendedBytes = 65_536
    /// Larger scripts must be split or replaced with a named primitive/plugin.
    public static let maximumBytes = 262_144
    /// Covers the extension's local approval window as well as script execution.
    public static let defaultTimeoutMs = 75_000
}
