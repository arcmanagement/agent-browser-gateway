import Foundation
import JavaScriptCore

@MainActor
final class PluginHost {
    struct LoadedPlugin {
        let name: String
        let context: JSContext
        let sourceURL: URL
    }

    private(set) var plugins: [LoadedPlugin] = []
    private let abgVersion: String

    init(abgVersion: String) {
        self.abgVersion = abgVersion
    }

    func loadAll(from searchPaths: [URL]) {
        for dir in searchPaths {
            loadPluginsInDir(dir)
        }
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
            loadPlugin(at: indexJs, name: entry.lastPathComponent)
        }
    }

    private func loadPlugin(at url: URL, name: String) {
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
        let abg = JSValue(newObjectIn: context)!
        abg.setObject(logFn, forKeyedSubscript: "log" as NSString)
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
        plugins.append(LoadedPlugin(name: name, context: context, sourceURL: url))
        stderr("loaded plugin \(name)")
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
