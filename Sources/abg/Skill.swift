import Foundation

enum SkillBundle {
    static let markdown: String = loadMarkdownResource("agent-browser-gateway")
    static let pluginCreatorMarkdown: String = loadMarkdownResource("abg-plugin-creator")

    private static func loadMarkdownResource(_ name: String) -> String {
        guard let url = Bundle.module.url(forResource: name, withExtension: "md"),
              let data = try? Data(contentsOf: url),
              let text = String(data: data, encoding: .utf8) else {
            preconditionFailure("\(name).md resource missing from abg bundle")
        }
        return text
    }

    /// Parsed from the `version:` line in the markdown frontmatter so the
    /// resource file is the single source of truth.
    static let version: String = version(from: markdown, resourceName: "agent-browser-gateway.md")
    static let pluginCreatorVersion: String = version(from: pluginCreatorMarkdown, resourceName: "abg-plugin-creator.md")

    private static func version(from markdown: String, resourceName: String) -> String {
        for line in markdown.split(separator: "\n").prefix(20) {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("version:") {
                return String(trimmed.dropFirst("version:".count))
                    .trimmingCharacters(in: .whitespaces)
            }
        }
        preconditionFailure("version not found in \(resourceName) frontmatter")
    }
}
