import Foundation

enum SkillBundle {
    static let markdown: String = {
        guard let url = Bundle.module.url(forResource: "agent-browser-gateway", withExtension: "md"),
              let data = try? Data(contentsOf: url),
              let text = String(data: data, encoding: .utf8) else {
            preconditionFailure("agent-browser-gateway.md resource missing from abg bundle")
        }
        return text
    }()

    /// Parsed from the `version:` line in the markdown frontmatter so the
    /// resource file is the single source of truth.
    static let version: String = {
        for line in markdown.split(separator: "\n").prefix(20) {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("version:") {
                return String(trimmed.dropFirst("version:".count))
                    .trimmingCharacters(in: .whitespaces)
            }
        }
        preconditionFailure("version not found in agent-browser-gateway.md frontmatter")
    }()
}
