import Foundation
import JavaScriptCore

@MainActor
final class PluginHost {
    struct Manifest: Codable {
        let name: String?
        let version: String?
        let author: String?
        let description: String?
        let domains: [String]?
        let transforms: [String]?
        let commands: [String]?
    }

    struct LoadedPlugin {
        let name: String
        let context: JSContext
        let sourceURL: URL
        let manifest: Manifest?
    }

    private(set) var plugins: [LoadedPlugin] = []
    private var transforms: [String: JSValue] = [:]
    private let abgVersion: String

    init(abgVersion: String) {
        self.abgVersion = abgVersion
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
        let abg = JSValue(newObjectIn: context)!
        abg.setObject(logFn, forKeyedSubscript: "log" as NSString)
        abg.setObject(registerFn, forKeyedSubscript: "registerTransform" as NSString)
        abg.setObject(abgVersion, forKeyedSubscript: "version" as NSString)
        let pluginInfo = JSValue(newObjectIn: context)!
        pluginInfo.setObject(name, forKeyedSubscript: "name" as NSString)
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
            if let commands = plugin.manifest?.commands { dict["commands"] = commands }
            return dict
        }
    }

    private func readManifest(from dir: URL) -> Manifest? {
        let url = dir.appendingPathComponent("plugin.json")
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(Manifest.self, from: data)
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
