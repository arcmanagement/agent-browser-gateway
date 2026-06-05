import Foundation
import GatewayCore
import JavaScriptCore

@MainActor
final class PluginHost {
    struct CommandArgSpec: Codable {
        let name: String
        let type: String?
        let required: Bool?
        let `default`: AnyCodable?
    }

    struct CommandSpec: Codable {
        let name: String
        let description: String?
        let args: [CommandArgSpec]?

        init(name: String, description: String? = nil, args: [CommandArgSpec]? = nil) {
            self.name = name
            self.description = description
            self.args = args
        }

        init(from decoder: Decoder) throws {
            let single = try decoder.singleValueContainer()
            if let name = try? single.decode(String.self) {
                self.init(name: name)
                return
            }
            let keyed = try decoder.container(keyedBy: CodingKeys.self)
            self.init(
                name: try keyed.decode(String.self, forKey: .name),
                description: try keyed.decodeIfPresent(String.self, forKey: .description),
                args: try keyed.decodeIfPresent([CommandArgSpec].self, forKey: .args)
            )
        }
    }

    struct Manifest: Codable {
        let name: String?
        let version: String?
        let author: String?
        let description: String?
        let domains: [String]?
        let transforms: [String]?
        let commands: [CommandSpec]?
    }

    struct LoadedPlugin {
        let name: String
        let context: JSContext
        let sourceURL: URL
        let manifest: Manifest?
    }

    private(set) var plugins: [LoadedPlugin] = []
    private var transforms: [String: JSValue] = [:]
    private var commands: [String: [String: JSValue]] = [:]
    private let abgVersion: String
    private let tabDispatcher: @MainActor (String, [String: Any]) async throws -> AnyCodable

    init(
        abgVersion: String,
        tabDispatcher: @escaping @MainActor (String, [String: Any]) async throws -> AnyCodable = { _, _ in
            throw PluginTabAPIError.dispatcherUnavailable
        }
    ) {
        self.abgVersion = abgVersion
        self.tabDispatcher = tabDispatcher
    }

    func loadAll(from searchPaths: [URL]) {
        for dir in searchPaths {
            loadPluginsInDir(dir)
        }
    }

    /// Invoke a transformer registered by a plugin via `abg.registerTransform(name, fn)`.
    /// Returns nil if no transformer is registered or the call returns null/undefined.
    func transform(name: String, input: String) -> String? {
        guard let fn = transforms[name] else { return nil }
        guard let result = fn.call(withArguments: [input]) else { return nil }
        if result.isUndefined || result.isNull { return nil }
        return result.toString()
    }

    func domainTransform(url: String, kind: String, input: String) -> (name: String, output: String)? {
        for plugin in plugins {
            guard let manifest = plugin.manifest,
                  manifestMatches(url: url, manifest: manifest)
            else { continue }
            for transformName in manifest.transforms ?? [] {
                guard transformName.range(of: kind, options: .caseInsensitive) != nil,
                      let output = transform(name: transformName, input: input)
                else { continue }
                return (transformName, output)
            }
        }
        return nil
    }

    func commandList() -> [[String: Any]] {
        plugins.flatMap { plugin -> [[String: Any]] in
            let manifestCommands = Dictionary(
                uniqueKeysWithValues: (plugin.manifest?.commands ?? []).map { ($0.name, $0) }
            )
            return (commands[plugin.name] ?? [:]).keys.sorted().map { commandName in
                var dict: [String: Any] = [
                    "plugin": plugin.name,
                    "command": commandName,
                ]
                if let version = plugin.manifest?.version { dict["version"] = version }
                if let spec = manifestCommands[commandName] {
                    if let description = spec.description { dict["description"] = description }
                    if let args = spec.args {
                        dict["args"] = args.map { arg in
                            var argDict: [String: Any] = ["name": arg.name]
                            if let type = arg.type { argDict["type"] = type }
                            if let required = arg.required { argDict["required"] = required }
                            if let defaultValue = arg.default { argDict["default"] = defaultValue.value }
                            return argDict
                        }
                    }
                }
                return dict
            }
        }
    }

    func hasPlugin(named pluginName: String) -> Bool {
        plugins.contains { $0.name == pluginName }
    }

    func domainPatterns(for pluginName: String) -> [String]? {
        plugins.first { $0.name == pluginName }?.manifest?.domains
    }

    func matchesManifestDomain(plugin pluginName: String, url: String) -> Bool {
        guard let manifest = plugins.first(where: { $0.name == pluginName })?.manifest else {
            return false
        }
        return manifestMatches(url: url, manifest: manifest)
    }

    func runCommand(plugin pluginName: String, command commandName: String, args: [String: Any], tabId: Int?) async throws -> AnyCodable {
        guard let plugin = plugins.first(where: { $0.name == pluginName }) else {
            throw PluginCommandError.pluginNotFound(pluginName)
        }
        guard let fn = commands[pluginName]?[commandName] else {
            throw PluginCommandError.commandNotFound(pluginName, commandName)
        }
        let contextObject = JSValue(newObjectIn: plugin.context)!
        if let tabId { contextObject.setObject(tabId, forKeyedSubscript: "tabId" as NSString) }
        let pluginObject = JSValue(newObjectIn: plugin.context)!
        pluginObject.setObject(plugin.name, forKeyedSubscript: "name" as NSString)
        if let version = plugin.manifest?.version {
            pluginObject.setObject(version, forKeyedSubscript: "version" as NSString)
        }
        contextObject.setObject(pluginObject, forKeyedSubscript: "plugin" as NSString)
        contextObject.setObject(makeTabObject(context: plugin.context, tabId: tabId), forKeyedSubscript: "tab" as NSString)

        guard let result = fn.call(withArguments: [args, contextObject]) else { return AnyCodable(NSNull()) }
        return try await resolveJSResult(result, context: plugin.context)
    }

    private func makeTabObject(context: JSContext, tabId: Int?) -> JSValue {
        let tabObject = JSValue(newObjectIn: context)!
        let methods: [(jsName: String, cliMethod: String)] = [
            ("paste", "paste_tab"),
            ("clear", "clear_tab"),
            ("fill", "fill_tab"),
            ("click", "click_tab"),
            ("key", "key_tab"),
            ("read", "read_tab"),
            ("describe", "describe_tab"),
            ("wait", "wait_tab"),
            ("screenshot", "screenshot_tab"),
        ]
        for method in methods {
            let fn: @convention(block) (JSValue?) -> JSValue = { [weak self] options in
                guard let self else {
                    return PluginHost.rejectedPromise(
                        context: context,
                        code: "plugin_host_tab_api_missing",
                        message: "Plugin tab API is not available."
                    )
                }
                return JSValue(newPromiseIn: context, fromExecutor: { resolve, reject in
                    Task { @MainActor in
                        guard let tabId else {
                            reject?.call(withArguments: [
                                PluginHost.makeJSError(
                                    context: context,
                                    code: "no_tab_context",
                                    message: "context.tab.\(method.jsName) requires the command to run with a tab context."
                                ),
                            ])
                            return
                        }
                        do {
                            var params = self.optionsDictionary(options, context: context)
                            params["tabId"] = tabId
                            params = self.normalizeTabParams(method: method.jsName, params: params)
                            let result = try await self.tabDispatcher(method.cliMethod, params)
                            resolve?.call(withArguments: [result.value])
                        } catch {
                            reject?.call(withArguments: [PluginHost.makeJSError(context: context, error: error)])
                        }
                    }
                })!
            }
            tabObject.setObject(fn, forKeyedSubscript: method.jsName as NSString)
        }
        return tabObject
    }

    private func optionsDictionary(_ value: JSValue?, context: JSContext) -> [String: Any] {
        guard let value, !value.isUndefined, !value.isNull else { return [:] }
        return jsValueToJSON(value, context: context) as? [String: Any] ?? [:]
    }

    private func normalizeTabParams(method: String, params: [String: Any]) -> [String: Any] {
        var normalized = params
        switch method {
        case "read":
            if let format = normalized["format"] as? String, format == "markdown" {
                normalized["asMarkdown"] = true
            }
        case "screenshot":
            if normalized["clip"] == nil,
               let x = normalized["x"],
               let y = normalized["y"],
               let width = normalized["width"],
               let height = normalized["height"] {
                normalized["clip"] = ["x": x, "y": y, "width": width, "height": height]
                normalized.removeValue(forKey: "x")
                normalized.removeValue(forKey: "y")
                normalized.removeValue(forKey: "width")
                normalized.removeValue(forKey: "height")
            }
        case "wait":
            if normalized["sleepMs"] == nil, let ms = normalized["ms"] {
                normalized["sleepMs"] = ms
                normalized.removeValue(forKey: "ms")
            }
        default:
            break
        }
        return normalized
    }

    private static func rejectedPromise(context: JSContext, code: String, message: String) -> JSValue {
        JSValue(newPromiseIn: context, fromExecutor: { _, reject in
            reject?.call(withArguments: [makeJSError(context: context, code: code, message: message)])
        })!
    }

    private static func makeJSError(context: JSContext, error: Error) -> JSValue {
        if let tabError = error as? PluginTabAPIError {
            return makeJSError(context: context, code: tabError.code, message: tabError.errorDescription ?? tabError.code)
        }
        return makeJSError(context: context, code: "tab_command_failed", message: error.localizedDescription)
    }

    private static func makeJSError(context: JSContext, code: String, message: String) -> JSValue {
        let error = JSValue(newObjectIn: context)!
        error.setObject(code, forKeyedSubscript: "error" as NSString)
        error.setObject(message, forKeyedSubscript: "message" as NSString)
        return error
    }

    private func loadPluginsInDir(_ dir: URL) {
        let fm = FileManager.default
        var isDir: ObjCBool = false
        guard fm.fileExists(atPath: dir.path, isDirectory: &isDir), isDir.boolValue else { return }
        guard let entries = try? fm.contentsOfDirectory(
            at: dir,
            includingPropertiesForKeys: [.isDirectoryKey]
        ) else { return }
        for entry in entries.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
            var entryIsDir: ObjCBool = false
            guard fm.fileExists(atPath: entry.path, isDirectory: &entryIsDir), entryIsDir.boolValue
            else { continue }
            let indexJs = entry.appendingPathComponent("index.js")
            guard fm.fileExists(atPath: indexJs.path) else { continue }
            let manifest = readManifest(from: entry)
            loadPlugin(at: indexJs, name: manifest?.name ?? entry.lastPathComponent, manifest: manifest)
        }
    }

    private func loadPlugin(at url: URL, name: String, manifest: Manifest?) {
        guard let context = JSContext() else {
            stderr("JSContext init failed for \(name)")
            return
        }
        context.exceptionHandler = { _, exception in
            let msg = exception?.toString() ?? "unknown"
            FileHandle.standardError.write(Data("[abg-plugin:\(name)] error: \(msg)\n".utf8))
        }

        let logFn: @convention(block) (String) -> Void = { msg in
            FileHandle.standardError.write(Data("[abg-plugin:\(name)] \(msg)\n".utf8))
        }
        let registerFn: @convention(block) (String, JSValue) -> Void = { [weak self] transformName, fn in
            // JSContext invokes blocks on the thread that owns the context (main, since
            // PluginHost is @MainActor and the context was created there).
            MainActor.assumeIsolated {
                self?.transforms[transformName] = fn
            }
        }
        let registerCommandFn: @convention(block) (String, JSValue) -> Void = { [weak self] commandName, fn in
            MainActor.assumeIsolated {
                self?.registerCommand(plugin: name, commandName: commandName, fn: fn)
            }
        }
        let abg = JSValue(newObjectIn: context)!
        abg.setObject(logFn, forKeyedSubscript: "log" as NSString)
        abg.setObject(registerFn, forKeyedSubscript: "registerTransform" as NSString)
        abg.setObject(registerCommandFn, forKeyedSubscript: "registerCommand" as NSString)
        abg.setObject(abgVersion, forKeyedSubscript: "version" as NSString)
        let pluginInfo = JSValue(newObjectIn: context)!
        pluginInfo.setObject(name, forKeyedSubscript: "name" as NSString)
        if let version = manifest?.version {
            pluginInfo.setObject(version, forKeyedSubscript: "version" as NSString)
        }
        abg.setObject(pluginInfo, forKeyedSubscript: "plugin" as NSString)
        context.setObject(abg, forKeyedSubscript: "abg" as NSString)

        let source: String
        do {
            source = try String(contentsOf: url, encoding: .utf8)
        } catch {
            stderr("read failed for \(name): \(error.localizedDescription)")
            return
        }
        context.evaluateScript(source, withSourceURL: url)
        plugins.append(LoadedPlugin(name: name, context: context, sourceURL: url, manifest: manifest))
        warnForUnregisteredManifestCommands(plugin: name, manifest: manifest)
        stderr("loaded plugin \(name)")
    }

    func loadedPluginSummaries() -> [[String: Any]] {
        plugins.map { plugin in
            var dict: [String: Any] = [
                "name": plugin.name,
                "path": plugin.sourceURL.deletingLastPathComponent().path,
            ]
            if let version = plugin.manifest?.version { dict["version"] = version }
            if let author = plugin.manifest?.author { dict["author"] = author }
            if let description = plugin.manifest?.description { dict["description"] = description }
            if let domains = plugin.manifest?.domains { dict["domains"] = domains }
            if let transforms = plugin.manifest?.transforms { dict["transforms"] = transforms }
            let registeredCommands = (commands[plugin.name] ?? [:]).keys.sorted()
            if !registeredCommands.isEmpty { dict["registeredCommands"] = registeredCommands }
            if let commands = plugin.manifest?.commands {
                dict["commands"] = commands.map { commandSpecDictionary($0) }
            }
            return dict
        }
    }

    private func readManifest(from dir: URL) -> Manifest? {
        let url = dir.appendingPathComponent("plugin.json")
        guard let data = try? Data(contentsOf: url) else { return nil }
        do {
            return try JSONDecoder().decode(Manifest.self, from: data)
        } catch {
            stderr("manifest decode failed for \(dir.lastPathComponent): \(error.localizedDescription)")
            return nil
        }
    }

    private func registerCommand(plugin: String, commandName: String, fn: JSValue) {
        let normalized = commandName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty else {
            stderr("\(plugin) ignored command with empty name")
            return
        }
        guard fn.isObject else {
            stderr("\(plugin) ignored command \(normalized): handler must be a function")
            return
        }
        if commands[plugin]?[normalized] != nil {
            stderr("\(plugin) ignored duplicate command \(normalized)")
            return
        }
        var pluginCommands = commands[plugin] ?? [:]
        pluginCommands[normalized] = fn
        commands[plugin] = pluginCommands
    }

    private func warnForUnregisteredManifestCommands(plugin: String, manifest: Manifest?) {
        let registered = Set((commands[plugin] ?? [:]).keys)
        for spec in manifest?.commands ?? [] where !registered.contains(spec.name) {
            stderr("\(plugin) manifest declares command \(spec.name) but index.js did not register it")
        }
    }

    private func commandSpecDictionary(_ spec: CommandSpec) -> [String: Any] {
        var dict: [String: Any] = ["name": spec.name]
        if let description = spec.description { dict["description"] = description }
        if let args = spec.args {
            dict["args"] = args.map { arg in
                var argDict: [String: Any] = ["name": arg.name]
                if let type = arg.type { argDict["type"] = type }
                if let required = arg.required { argDict["required"] = required }
                if let defaultValue = arg.default { argDict["default"] = defaultValue.value }
                return argDict
            }
        }
        return dict
    }

    private func resolveJSResult(_ value: JSValue, context: JSContext) async throws -> AnyCodable {
        if value.isUndefined || value.isNull { return AnyCodable(NSNull()) }
        if let then = value.forProperty("then"), !then.isUndefined, then.isObject {
            return try await withCheckedThrowingContinuation { continuation in
                final class Box {
                    var done = false
                }
                let box = Box()
                let resolve: @convention(block) (JSValue) -> Void = { resolved in
                    guard !box.done else { return }
                    box.done = true
                    continuation.resume(returning: AnyCodable(self.jsValueToJSON(resolved, context: context)))
                }
                let reject: @convention(block) (JSValue) -> Void = { rejected in
                    guard !box.done else { return }
                    box.done = true
                    let message = rejected.forProperty("message")?.toString() ?? rejected.toString() ?? "Plugin command failed"
                    continuation.resume(throwing: PluginCommandError.handlerFailed(message))
                }
                _ = value.invokeMethod("then", withArguments: [resolve, reject])
            }
        }
        return AnyCodable(jsValueToJSON(value, context: context))
    }

    private func jsValueToJSON(_ value: JSValue, context: JSContext) -> Any {
        if value.isUndefined || value.isNull { return NSNull() }
        guard let json = context.objectForKeyedSubscript("JSON"),
              let stringified = json.invokeMethod("stringify", withArguments: [value]),
              !stringified.isUndefined,
              !stringified.isNull,
              let jsonString = stringified.toString(),
              let data = jsonString.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data)
        else {
            return value.toString() ?? NSNull()
        }
        return object
    }

    private func manifestMatches(url: String, manifest: Manifest) -> Bool {
        guard let domains = manifest.domains, !domains.isEmpty else { return false }
        return domains.contains { globMatches(pattern: $0, text: url) }
    }

    private func globMatches(pattern: String, text: String) -> Bool {
        let escaped = NSRegularExpression.escapedPattern(for: pattern)
            .replacingOccurrences(of: "\\*", with: ".*")
            .replacingOccurrences(of: "\\?", with: ".")
        let regex = "^\(escaped)$"
        return text.range(of: regex, options: [.regularExpression, .caseInsensitive]) != nil
    }

    private func stderr(_ msg: String) {
        FileHandle.standardError.write(Data("[abg-plugin] \(msg)\n".utf8))
    }

    static func defaultSearchPaths() -> [URL] {
        var paths: [URL] = []
        if let res = Bundle.main.resourceURL {
            paths.append(res.appendingPathComponent("plugins"))
        }
        let home = FileManager.default.homeDirectoryForCurrentUser
        paths.append(home.appendingPathComponent(".abg/plugins"))
        return paths
    }
}

enum PluginCommandError: Error, LocalizedError {
    case pluginNotFound(String)
    case commandNotFound(String, String)
    case handlerFailed(String)

    var errorDescription: String? {
        switch self {
        case .pluginNotFound(let plugin):
            return "Plugin not found: \(plugin)"
        case .commandNotFound(let plugin, let command):
            return "Plugin command not found: \(plugin) \(command)"
        case .handlerFailed(let message):
            return message
        }
    }
}

enum PluginTabAPIError: Error, LocalizedError {
    case dispatcherUnavailable
    case dispatchFailed(code: String, message: String)

    var code: String {
        switch self {
        case .dispatcherUnavailable:
            return "plugin_host_tab_api_missing"
        case .dispatchFailed(let code, _):
            return code
        }
    }

    var errorDescription: String? {
        switch self {
        case .dispatcherUnavailable:
            return "Plugin tab API dispatcher is not configured."
        case .dispatchFailed(let code, let message):
            return "\(code): \(message)"
        }
    }
}
