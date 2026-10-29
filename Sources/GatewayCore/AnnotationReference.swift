import Foundation

/// Annotation references are globally unique; resolving one still requires a shared tab.
public enum AnnotationReference {
    public static let prefix = "abg-annotation:"

    public static func uid(from token: String?) throws -> String? {
        guard let token, token.hasPrefix(prefix) else { return nil }
        let uid = String(token.dropFirst(prefix.count))
        guard !uid.isEmpty, uid.utf8.count <= 128,
              uid.unicodeScalars.allSatisfy({ CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-").contains($0) }) else {
            throw ReferenceError.invalid
        }
        return uid
    }

    public enum ReferenceError: Error { case invalid }
}
