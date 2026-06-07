import Foundation

public struct ABGPluginManifest: Codable, Sendable {
    public struct CommandArgSpec: Codable, Sendable {
        public let name: String
        public let type: String?
        public let required: Bool?
        public let `default`: AnyCodable?
    }

    public struct CommandSpec: Codable, Sendable {
        public let name: String
        public let description: String?
        public let args: [CommandArgSpec]?

        public init(from decoder: Decoder) throws {
            let single = try decoder.singleValueContainer()
            if let name = try? single.decode(String.self) {
                self.name = name
                description = nil
                args = nil
                return
            }
            let keyed = try decoder.container(keyedBy: CodingKeys.self)
            name = try keyed.decode(String.self, forKey: .name)
            description = try keyed.decodeIfPresent(String.self, forKey: .description)
            args = try keyed.decodeIfPresent([CommandArgSpec].self, forKey: .args)
        }
    }

    public let name: String?
    public let version: String?
    public let author: String?
    public let description: String?
    public let domains: [String]?
    public let transforms: [String]?
    public let commands: [CommandSpec]?
}

public struct ABGPluginInstallResult: Sendable {
    public let installName: String
    public let name: String
    public let path: String
    public let source: String
    public let version: String?
    public let author: String?
    public let description: String?
    public let domains: [String]
    public let transforms: [String]
    public let commands: [ABGPluginManifest.CommandSpec]

    public var dictionary: [String: Any] {
        var dict: [String: Any] = [
            "name": name,
            "installName": installName,
            "source": source,
            "path": path,
        ]
        if let version { dict["version"] = version }
        if let author { dict["author"] = author }
        if let description { dict["description"] = description }
        if !domains.isEmpty { dict["domains"] = domains }
        if !transforms.isEmpty { dict["transforms"] = transforms }
        if !commands.isEmpty {
            dict["commands"] = commands.map { command in
                var commandDict: [String: Any] = ["name": command.name]
                if let description = command.description { commandDict["description"] = description }
                if let args = command.args {
                    commandDict["args"] = args.map { arg in
                        var argDict: [String: Any] = ["name": arg.name]
                        if let type = arg.type { argDict["type"] = type }
                        if let required = arg.required { argDict["required"] = required }
                        if let defaultValue = arg.default { argDict["default"] = defaultValue.value }
                        return argDict
                    }
                }
                return commandDict
            }
        }
        return dict
    }
}

public struct ABGPluginUpdateResult: Sendable {
    public let name: String
    public let path: String
    public let status: String
    public let output: String?
    public let reason: String?
    public let error: String?

    public var dictionary: [String: Any] {
        var dict: [String: Any] = [
            "name": name,
            "path": path,
            "status": status,
        ]
        if let output, !output.isEmpty { dict["output"] = output }
        if let reason { dict["reason"] = reason }
        if let error { dict["error"] = error }
        return dict
    }
}

public struct ABGPluginUninstallResult: Sendable {
    public let name: String
    public let path: String

    public var dictionary: [String: Any] {
        [
            "ok": true,
            "name": name,
            "removed": path,
        ]
    }
}

public enum ABGPluginInstallError: Error, LocalizedError {
    case pluginExists(name: String)
    case invalidPlugin(path: String)
    case embeddedHTTPCredentials
    case processFailed(String)

    public var errorDescription: String? {
        switch self {
        case .pluginExists(let name):
            return "\(name) is already installed. Choose replace to overwrite it."
        case .invalidPlugin:
            return "Installed source does not contain index.js at the plugin root."
        case .embeddedHTTPCredentials:
            return "Credentials in plugin URLs are not supported. Use local git authentication instead."
        case .processFailed(let message):
            return message.isEmpty ? "git command failed" : message
        }
    }

    public var code: String {
        switch self {
        case .pluginExists:
            return "plugin_exists"
        case .invalidPlugin:
            return "invalid_plugin"
        case .embeddedHTTPCredentials:
            return "embedded_credentials_not_allowed"
        case .processFailed:
            return "git_failed"
        }
    }
}

public enum ABGPluginManagementError: Error, LocalizedError {
    case pluginNotFound(name: String, root: String)
    case unsafePluginPath(path: String, root: String)

    public var errorDescription: String? {
        switch self {
        case .pluginNotFound(let name, let root):
            return "\(name) is not installed in \(root)."
        case .unsafePluginPath(let path, let root):
            return "Refusing to manage \(path) because it is outside \(root)."
        }
    }

    public var code: String {
        switch self {
        case .pluginNotFound:
            return "plugin_not_found"
        case .unsafePluginPath:
            return "unsafe_plugin_path"
        }
    }
}

public enum ABGPluginInstaller {
    public typealias ProcessRunner = (_ executable: String, _ arguments: [String], _ environment: [String: String]) throws -> String

    public static func install(
        source: String,
        name: String? = nil,
        force: Bool = false,
        pluginsDirectory: URL = ABGConstants.userPluginsDir,
        runProcess: ProcessRunner = Self.runProcess
    ) throws -> ABGPluginInstallResult {
        let pluginsDirectory = pluginsDirectory.standardizedFileURL
        try FileManager.default.createDirectory(at: pluginsDirectory, withIntermediateDirectories: true)

        let installName = sanitizePluginName(name ?? inferredPluginName(from: source))
        let destination = pluginsDirectory.appendingPathComponent(installName, isDirectory: true)
        let fm = FileManager.default
        if fm.fileExists(atPath: destination.path) {
            guard force else {
                throw ABGPluginInstallError.pluginExists(name: installName)
            }
            try fm.removeItem(at: destination)
        }

        do {
            if localPluginSourceExists(source) {
                try fm.copyItem(at: localPluginSourceURL(source), to: destination)
            } else {
                let cloneSource = normalizedGitSource(source)
                guard !hasEmbeddedHTTPCredentials(cloneSource) else {
                    throw ABGPluginInstallError.embeddedHTTPCredentials
                }
                _ = try runProcess(
                    "/usr/bin/env",
                    ["git", "clone", "--depth", "1", cloneSource, destination.path],
                    gitEnvironment()
                )
            }

            guard fm.fileExists(atPath: destination.appendingPathComponent("index.js").path) else {
                try? fm.removeItem(at: destination)
                throw ABGPluginInstallError.invalidPlugin(path: destination.path)
            }

            return pluginInfo(at: destination, installName: installName)
        } catch {
            try? fm.removeItem(at: destination)
            throw error
        }
    }

    public static func normalizedGitSource(_ source: String) -> String {
        if source.contains("://") || source.hasPrefix("git@") { return source }
        if source.split(separator: "/").count == 2 { return "https://github.com/\(source).git" }
        return source
    }

    public static func inferredPluginName(from source: String) -> String {
        let trimmed = source.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let last = trimmed.split(separator: "/").last.map(String.init) ?? "plugin"
        return last.hasSuffix(".git") ? String(last.dropLast(4)) : last
    }

    public static func sanitizePluginName(_ name: String) -> String {
        let sanitized = name.replacingOccurrences(of: #"[^A-Za-z0-9_.-]"#, with: "-", options: .regularExpression)
        return sanitized.isEmpty ? "plugin" : sanitized
    }

    public static func localPluginSourceExists(_ source: String) -> Bool {
        var isDir: ObjCBool = false
        return FileManager.default.fileExists(
            atPath: localPluginSourceURL(source).path,
            isDirectory: &isDir
        ) && isDir.boolValue
    }

    public static func pluginInfo(at dir: URL, installName: String? = nil, source: String = "user") -> ABGPluginInstallResult {
        let manifest = readPluginManifest(at: dir)
        let installName = installName ?? dir.lastPathComponent
        return ABGPluginInstallResult(
            installName: installName,
            name: manifest?.name ?? installName,
            path: dir.path,
            source: source,
            version: manifest?.version,
            author: manifest?.author,
            description: manifest?.description,
            domains: manifest?.domains ?? [],
            transforms: manifest?.transforms ?? [],
            commands: manifest?.commands ?? []
        )
    }

    public static func updatePlugins(
        name: String? = nil,
        pluginsDirectory: URL = ABGConstants.userPluginsDir,
        runProcess: ProcessRunner = Self.runProcess
    ) throws -> [ABGPluginUpdateResult] {
        let pluginsDirectory = pluginsDirectory.standardizedFileURL
        let targets: [URL]
        if let name {
            targets = [pluginsDirectory.appendingPathComponent(sanitizePluginName(name), isDirectory: true)]
        } else {
            targets = (try? FileManager.default.contentsOfDirectory(
                at: pluginsDirectory,
                includingPropertiesForKeys: [.isDirectoryKey]
            )) ?? []
        }

        return targets.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }).map { target in
            updatePlugin(at: target, pluginsDirectory: pluginsDirectory, runProcess: runProcess)
        }
    }

    public static func updatePlugin(
        at pluginDirectory: URL,
        pluginsDirectory: URL = ABGConstants.userPluginsDir,
        runProcess: ProcessRunner = Self.runProcess
    ) -> ABGPluginUpdateResult {
        let pluginsDirectory = pluginsDirectory.standardizedFileURL
        let target = pluginDirectory.standardizedFileURL
        let name = target.lastPathComponent
        guard isPluginDirectory(target, under: pluginsDirectory) else {
            return ABGPluginUpdateResult(
                name: name,
                path: target.path,
                status: "failed",
                output: nil,
                reason: nil,
                error: ABGPluginManagementError.unsafePluginPath(path: target.path, root: pluginsDirectory.path).localizedDescription
            )
        }
        guard FileManager.default.fileExists(atPath: target.appendingPathComponent(".git").path) else {
            return ABGPluginUpdateResult(
                name: name,
                path: target.path,
                status: "skipped",
                output: nil,
                reason: "not a git checkout",
                error: nil
            )
        }
        do {
            let output = try runProcess(
                "/usr/bin/env",
                ["git", "-C", target.path, "pull", "--ff-only"],
                gitEnvironment()
            )
            return ABGPluginUpdateResult(
                name: name,
                path: target.path,
                status: "updated",
                output: output,
                reason: nil,
                error: nil
            )
        } catch {
            return ABGPluginUpdateResult(
                name: name,
                path: target.path,
                status: "failed",
                output: nil,
                reason: nil,
                error: error.localizedDescription
            )
        }
    }

    public static func uninstall(
        name: String,
        pluginsDirectory: URL = ABGConstants.userPluginsDir
    ) throws -> ABGPluginUninstallResult {
        let pluginsDirectory = pluginsDirectory.standardizedFileURL
        let target = pluginsDirectory.appendingPathComponent(sanitizePluginName(name), isDirectory: true)
        return try uninstall(at: target, pluginsDirectory: pluginsDirectory)
    }

    public static func uninstall(
        at pluginDirectory: URL,
        pluginsDirectory: URL = ABGConstants.userPluginsDir
    ) throws -> ABGPluginUninstallResult {
        let pluginsDirectory = pluginsDirectory.standardizedFileURL
        let target = pluginDirectory.standardizedFileURL
        let name = target.lastPathComponent
        guard isPluginDirectory(target, under: pluginsDirectory) else {
            throw ABGPluginManagementError.unsafePluginPath(path: target.path, root: pluginsDirectory.path)
        }
        guard FileManager.default.fileExists(atPath: target.path) else {
            throw ABGPluginManagementError.pluginNotFound(name: name, root: pluginsDirectory.path)
        }
        try FileManager.default.removeItem(at: target)
        try? ABGPluginStateStore.forget(
            installName: name,
            userDirectory: pluginsDirectory.deletingLastPathComponent()
        )
        return ABGPluginUninstallResult(name: name, path: target.path)
    }

    public static func readPluginManifest(at dir: URL) -> ABGPluginManifest? {
        let url = dir.appendingPathComponent("plugin.json")
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(ABGPluginManifest.self, from: data)
    }

    @discardableResult
    public static func runProcess(_ executable: String, _ arguments: [String], _ environment: [String: String]) throws -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        process.environment = environment
        let output = Pipe()
        process.standardOutput = output
        process.standardError = output
        try process.run()
        process.waitUntilExit()
        let data = output.fileHandleForReading.readDataToEndOfFile()
        let text = String(data: data, encoding: .utf8) ?? ""
        guard process.terminationStatus == 0 else {
            throw ABGPluginInstallError.processFailed(text.trimmingCharacters(in: .whitespacesAndNewlines))
        }
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func localPluginSourceURL(_ source: String) -> URL {
        URL(fileURLWithPath: (source as NSString).expandingTildeInPath, isDirectory: true).standardizedFileURL
    }

    private static func hasEmbeddedHTTPCredentials(_ source: String) -> Bool {
        guard let components = URLComponents(string: source),
              let scheme = components.scheme?.lowercased(),
              ["http", "https"].contains(scheme)
        else { return false }
        return components.user != nil || components.password != nil
    }

    private static func gitEnvironment() -> [String: String] {
        var environment = ProcessInfo.processInfo.environment
        environment["GIT_TERMINAL_PROMPT"] = "0"
        return environment
    }

    private static func isPluginDirectory(_ pluginDirectory: URL, under pluginsDirectory: URL) -> Bool {
        let pluginURL = pluginDirectory.standardizedFileURL
        let rootURL = pluginsDirectory.standardizedFileURL
        return pluginURL.path != rootURL.path
            && pluginURL.deletingLastPathComponent().standardizedFileURL.path == rootURL.path
    }
}
