import GatewayCore
import XCTest

final class PluginInstallerTests: XCTestCase {
    func testNormalizesGitHubRepoShorthand() {
        XCTAssertEqual(
            ABGPluginInstaller.normalizedGitSource("arcmanagement/example-plugin"),
            "https://github.com/arcmanagement/example-plugin.git"
        )
        XCTAssertEqual(
            ABGPluginInstaller.normalizedGitSource("git@github.com:arcmanagement/example-plugin.git"),
            "git@github.com:arcmanagement/example-plugin.git"
        )
        XCTAssertEqual(
            ABGPluginInstaller.inferredPluginName(from: "https://github.com/arcmanagement/example-plugin.git"),
            "example-plugin"
        )
    }

    func testInstallsLocalPluginIntoUserRoot() throws {
        let source = try makeTempDirectory("abg-source-plugin")
        let destinationRoot = try makeTempDirectory("abg-user-plugins")
        defer {
            try? FileManager.default.removeItem(at: source)
            try? FileManager.default.removeItem(at: destinationRoot)
        }
        try writePlugin(
            at: source,
            manifest: """
            {
              "name": "example",
              "version": "0.1.0",
              "author": "arcmanagement",
              "description": "Example plugin.",
              "domains": ["https://example.com/*"],
              "transforms": ["example-markdown"],
              "commands": [{"name": "ping", "description": "Ping."}]
            }
            """
        )

        let result = try ABGPluginInstaller.install(
            source: source.path,
            pluginsDirectory: destinationRoot
        )

        XCTAssertEqual(result.installName, source.lastPathComponent)
        XCTAssertEqual(result.name, "example")
        XCTAssertEqual(result.version, "0.1.0")
        XCTAssertEqual(result.author, "arcmanagement")
        XCTAssertEqual(result.domains, ["https://example.com/*"])
        XCTAssertEqual(result.transforms, ["example-markdown"])
        XCTAssertEqual(result.commands.map(\.name), ["ping"])
        XCTAssertTrue(FileManager.default.fileExists(atPath: URL(fileURLWithPath: result.path).appendingPathComponent("index.js").path))
    }

    func testRejectsEmbeddedHTTPAuth() throws {
        let destinationRoot = try makeTempDirectory("abg-user-plugins")
        defer { try? FileManager.default.removeItem(at: destinationRoot) }

        XCTAssertThrowsError(
            try ABGPluginInstaller.install(
                source: "https://token@github.com/arcmanagement/private-plugin.git",
                pluginsDirectory: destinationRoot,
                runProcess: { _, _, _ in
                    XCTFail("git should not run when credentials are embedded in the URL")
                    return ""
                }
            )
        ) { error in
            XCTAssertEqual((error as? ABGPluginInstallError)?.code, "embedded_credentials_not_allowed")
        }
    }

    func testGitInstallUsesLocalGitEnvironment() throws {
        let destinationRoot = try makeTempDirectory("abg-user-plugins")
        defer { try? FileManager.default.removeItem(at: destinationRoot) }

        var capturedExecutable: String?
        var capturedArguments: [String]?
        var capturedEnvironment: [String: String]?
        let result = try ABGPluginInstaller.install(
            source: "arcmanagement/example-plugin",
            pluginsDirectory: destinationRoot,
            runProcess: { executable, arguments, environment in
                capturedExecutable = executable
                capturedArguments = arguments
                capturedEnvironment = environment
                let destination = URL(fileURLWithPath: try XCTUnwrap(arguments.last), isDirectory: true)
                try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
                try self.writePlugin(at: destination)
                return "cloned"
            }
        )

        XCTAssertEqual(result.installName, "example-plugin")
        XCTAssertEqual(capturedExecutable, "/usr/bin/env")
        XCTAssertEqual(capturedArguments?.prefix(5), ["git", "clone", "--depth", "1", "https://github.com/arcmanagement/example-plugin.git"])
        XCTAssertEqual(capturedEnvironment?["GIT_TERMINAL_PROMPT"], "0")
    }

    func testUpdateGitBackedPluginUsesLocalGitEnvironment() throws {
        let destinationRoot = try makeTempDirectory("abg-user-plugins")
        let plugin = destinationRoot.appendingPathComponent("git-plugin", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: destinationRoot) }
        try writePlugin(at: plugin)
        try FileManager.default.createDirectory(at: plugin.appendingPathComponent(".git"), withIntermediateDirectories: true)

        var capturedArguments: [String]?
        var capturedEnvironment: [String: String]?
        let result = ABGPluginInstaller.updatePlugin(
            at: plugin,
            pluginsDirectory: destinationRoot,
            runProcess: { _, arguments, environment in
                capturedArguments = arguments
                capturedEnvironment = environment
                return "Already up to date."
            }
        )

        XCTAssertEqual(result.name, "git-plugin")
        XCTAssertEqual(result.status, "updated")
        XCTAssertEqual(result.output, "Already up to date.")
        XCTAssertEqual(capturedArguments, ["git", "-C", plugin.standardizedFileURL.path, "pull", "--ff-only"])
        XCTAssertEqual(capturedEnvironment?["GIT_TERMINAL_PROMPT"], "0")
    }

    func testUpdateSkipsNonGitPlugin() throws {
        let destinationRoot = try makeTempDirectory("abg-user-plugins")
        let plugin = destinationRoot.appendingPathComponent("plain-plugin", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: destinationRoot) }
        try writePlugin(at: plugin)

        let result = ABGPluginInstaller.updatePlugin(at: plugin, pluginsDirectory: destinationRoot)

        XCTAssertEqual(result.name, "plain-plugin")
        XCTAssertEqual(result.status, "skipped")
        XCTAssertEqual(result.reason, "not a git checkout")
    }

    func testUninstallRemovesOnlyUserPluginDirectory() throws {
        let destinationRoot = try makeTempDirectory("abg-user-plugins")
        let plugin = destinationRoot.appendingPathComponent("remove-me", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: destinationRoot) }
        try writePlugin(at: plugin)

        let result = try ABGPluginInstaller.uninstall(name: "remove-me", pluginsDirectory: destinationRoot)

        XCTAssertEqual(result.name, "remove-me")
        XCTAssertFalse(FileManager.default.fileExists(atPath: plugin.path))
    }

    func testUninstallRejectsPathOutsideUserRoot() throws {
        let destinationRoot = try makeTempDirectory("abg-user-plugins")
        let outside = try makeTempDirectory("abg-outside-plugin")
        defer {
            try? FileManager.default.removeItem(at: destinationRoot)
            try? FileManager.default.removeItem(at: outside)
        }
        try writePlugin(at: outside)

        XCTAssertThrowsError(
            try ABGPluginInstaller.uninstall(at: outside, pluginsDirectory: destinationRoot)
        ) { error in
            XCTAssertEqual((error as? ABGPluginManagementError)?.code, "unsafe_plugin_path")
            XCTAssertTrue(FileManager.default.fileExists(atPath: outside.path))
        }
    }

    func testUninstallRejectsUserPluginRootAndNestedPaths() throws {
        let destinationRoot = try makeTempDirectory("abg-user-plugins")
        let plugin = destinationRoot.appendingPathComponent("nested-plugin", isDirectory: true)
        let nested = plugin.appendingPathComponent("nested", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: destinationRoot) }
        try writePlugin(at: plugin)
        try FileManager.default.createDirectory(at: nested, withIntermediateDirectories: true)

        XCTAssertThrowsError(
            try ABGPluginInstaller.uninstall(at: destinationRoot, pluginsDirectory: destinationRoot)
        ) { error in
            XCTAssertEqual((error as? ABGPluginManagementError)?.code, "unsafe_plugin_path")
            XCTAssertTrue(FileManager.default.fileExists(atPath: destinationRoot.path))
        }

        XCTAssertThrowsError(
            try ABGPluginInstaller.uninstall(at: nested, pluginsDirectory: destinationRoot)
        ) { error in
            XCTAssertEqual((error as? ABGPluginManagementError)?.code, "unsafe_plugin_path")
            XCTAssertTrue(FileManager.default.fileExists(atPath: nested.path))
        }
    }

    func testDisableAndEnablePersistProfileState() throws {
        let userDir = try makeTempDirectory("abg-user-dir")
        let pluginsRoot = userDir.appendingPathComponent("plugins", isDirectory: true)
        let plugin = pluginsRoot.appendingPathComponent("toggle-me", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: userDir) }
        try writePlugin(at: plugin)

        let disabled = try ABGPluginStateStore.disable(
            name: "toggle-me",
            pluginsDirectory: pluginsRoot,
            userDirectory: userDir
        )

        XCTAssertEqual(disabled.name, "toggle-me")
        XCTAssertFalse(disabled.enabled)
        XCTAssertEqual(
            ABGPluginStateStore.disabledPluginNames(userDirectory: userDir),
            Set(["toggle-me"])
        )
        XCTAssertTrue(FileManager.default.fileExists(atPath: ABGPluginStateStore.stateFile(userDirectory: userDir).path))

        let enabled = try ABGPluginStateStore.enable(
            name: "toggle-me",
            pluginsDirectory: pluginsRoot,
            userDirectory: userDir
        )

        XCTAssertTrue(enabled.enabled)
        XCTAssertTrue(ABGPluginStateStore.disabledPluginNames(userDirectory: userDir).isEmpty)
    }

    func testUninstallClearsDisabledProfileState() throws {
        let userDir = try makeTempDirectory("abg-user-dir")
        let pluginsRoot = userDir.appendingPathComponent("plugins", isDirectory: true)
        let plugin = pluginsRoot.appendingPathComponent("remove-disabled", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: userDir) }
        try writePlugin(at: plugin)
        _ = try ABGPluginStateStore.disable(
            name: "remove-disabled",
            pluginsDirectory: pluginsRoot,
            userDirectory: userDir
        )

        _ = try ABGPluginInstaller.uninstall(name: "remove-disabled", pluginsDirectory: pluginsRoot)

        XCTAssertTrue(ABGPluginStateStore.disabledPluginNames(userDirectory: userDir).isEmpty)
    }

    private func makeTempDirectory(_ prefix: String) throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("\(prefix)-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    private func writePlugin(at directory: URL, manifest: String? = nil) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try "abg.log('loaded test plugin');\n".write(
            to: directory.appendingPathComponent("index.js"),
            atomically: true,
            encoding: .utf8
        )
        if let manifest {
            try manifest.write(
                to: directory.appendingPathComponent("plugin.json"),
                atomically: true,
                encoding: .utf8
            )
        }
    }
}
