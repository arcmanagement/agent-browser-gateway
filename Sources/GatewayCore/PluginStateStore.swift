import Foundation
#if canImport(Darwin)
import Darwin
#elseif canImport(Glibc)
import Glibc
#endif

public struct ABGPluginEnablementResult: Sendable {
    public let name: String
    public let path: String
    public let enabled: Bool
    public let statePath: String

    public var dictionary: [String: Any] {
        [
            "ok": true,
            "name": name,
            "path": path,
            "enabled": enabled,
            "disabled": !enabled,
            "statePath": statePath,
        ]
    }
}

public enum ABGPluginStateStore {
    private struct ProfileState: Codable {
        var disabledPlugins: [String] = []
    }

    public static func stateFile(userDirectory: URL = ABGConstants.abgUserDir) -> URL {
        userDirectory.standardizedFileURL.appendingPathComponent("plugin-state.json")
    }

    public static func disabledPluginNames(userDirectory: URL = ABGConstants.abgUserDir) -> Set<String> {
        Set(loadState(userDirectory: userDirectory).disabledPlugins)
    }

    public static func isDisabled(
        installName: String,
        userDirectory: URL = ABGConstants.abgUserDir
    ) -> Bool {
        disabledPluginNames(userDirectory: userDirectory).contains(installName)
    }

    public static func forget(
        installName: String,
        userDirectory: URL = ABGConstants.abgUserDir
    ) throws {
        let userDirectory = userDirectory.standardizedFileURL
        var state = loadState(userDirectory: userDirectory)
        let disabled = Set(state.disabledPlugins).subtracting([installName])
        state.disabledPlugins = disabled.sorted()
        try saveStateOrRemoveIfEmpty(state, userDirectory: userDirectory)
    }

    public static func disable(
        name: String,
        pluginsDirectory: URL = ABGConstants.userPluginsDir,
        userDirectory: URL = ABGConstants.abgUserDir
    ) throws -> ABGPluginEnablementResult {
        let target = pluginsDirectory.appendingPathComponent(ABGPluginInstaller.sanitizePluginName(name), isDirectory: true)
        return try disable(at: target, pluginsDirectory: pluginsDirectory, userDirectory: userDirectory)
    }

    public static func disable(
        at pluginDirectory: URL,
        pluginsDirectory: URL = ABGConstants.userPluginsDir,
        userDirectory: URL = ABGConstants.abgUserDir
    ) throws -> ABGPluginEnablementResult {
        try setEnabled(false, at: pluginDirectory, pluginsDirectory: pluginsDirectory, userDirectory: userDirectory)
    }

    public static func enable(
        name: String,
        pluginsDirectory: URL = ABGConstants.userPluginsDir,
        userDirectory: URL = ABGConstants.abgUserDir
    ) throws -> ABGPluginEnablementResult {
        let target = pluginsDirectory.appendingPathComponent(ABGPluginInstaller.sanitizePluginName(name), isDirectory: true)
        return try enable(at: target, pluginsDirectory: pluginsDirectory, userDirectory: userDirectory)
    }

    public static func enable(
        at pluginDirectory: URL,
        pluginsDirectory: URL = ABGConstants.userPluginsDir,
        userDirectory: URL = ABGConstants.abgUserDir
    ) throws -> ABGPluginEnablementResult {
        try setEnabled(true, at: pluginDirectory, pluginsDirectory: pluginsDirectory, userDirectory: userDirectory)
    }

    private static func setEnabled(
        _ enabled: Bool,
        at pluginDirectory: URL,
        pluginsDirectory: URL,
        userDirectory: URL
    ) throws -> ABGPluginEnablementResult {
        let pluginsDirectory = pluginsDirectory.standardizedFileURL
        let userDirectory = userDirectory.standardizedFileURL
        let target = pluginDirectory.standardizedFileURL
        let name = target.lastPathComponent
        guard isPluginDirectory(target, under: pluginsDirectory) else {
            throw ABGPluginManagementError.unsafePluginPath(path: target.path, root: pluginsDirectory.path)
        }
        guard FileManager.default.fileExists(atPath: target.path) else {
            throw ABGPluginManagementError.pluginNotFound(name: name, root: pluginsDirectory.path)
        }

        var state = loadState(userDirectory: userDirectory)
        var disabled = Set(state.disabledPlugins)
        if enabled {
            disabled.remove(name)
        } else {
            disabled.insert(name)
        }
        state.disabledPlugins = disabled.sorted()
        try saveStateOrRemoveIfEmpty(state, userDirectory: userDirectory)

        return ABGPluginEnablementResult(
            name: name,
            path: target.path,
            enabled: enabled,
            statePath: stateFile(userDirectory: userDirectory).path
        )
    }

    private static func loadState(userDirectory: URL) -> ProfileState {
        let file = stateFile(userDirectory: userDirectory)
        guard let data = try? Data(contentsOf: file),
              let state = try? JSONDecoder().decode(ProfileState.self, from: data)
        else {
            return ProfileState()
        }
        return ProfileState(disabledPlugins: Array(Set(state.disabledPlugins)).sorted())
    }

    private static func saveState(_ state: ProfileState, userDirectory: URL) throws {
        let userDirectory = userDirectory.standardizedFileURL
        try FileManager.default.createDirectory(at: userDirectory, withIntermediateDirectories: true)
        chmod(userDirectory.path, 0o700)

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(state)
        try data.write(to: stateFile(userDirectory: userDirectory), options: .atomic)
    }

    private static func saveStateOrRemoveIfEmpty(_ state: ProfileState, userDirectory: URL) throws {
        if state.disabledPlugins.isEmpty {
            try? FileManager.default.removeItem(at: stateFile(userDirectory: userDirectory))
        } else {
            try saveState(state, userDirectory: userDirectory)
        }
    }

    private static func isPluginDirectory(_ pluginDirectory: URL, under pluginsDirectory: URL) -> Bool {
        let pluginURL = pluginDirectory.standardizedFileURL
        let rootURL = pluginsDirectory.standardizedFileURL
        return pluginURL.path != rootURL.path
            && pluginURL.deletingLastPathComponent().standardizedFileURL.path == rootURL.path
    }
}
