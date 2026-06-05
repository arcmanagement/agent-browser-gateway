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
