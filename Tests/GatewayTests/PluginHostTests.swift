import XCTest
@testable import Gateway

@MainActor
final class PluginHostTests: XCTestCase {
    func testLoadsPluginAndRunsRegisteredTransform() throws {
        let root = try makeTempPluginRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        try writePlugin(
            root: root,
            name: "upper-plugin",
            source: """
            abg.registerTransform("upper", function (input) {
              return String(input).toUpperCase();
            });
            """
        )

        let host = PluginHost(abgVersion: "test")
        host.loadAll(from: [root])

        XCTAssertEqual(host.plugins.map(\.name), ["upper-plugin"])
        XCTAssertEqual(host.transform(name: "upper", input: "abg"), "ABG")
    }

    func testMissingTransformReturnsNil() throws {
        let host = PluginHost(abgVersion: "test")

        XCTAssertNil(host.transform(name: "missing", input: "abg"))
    }

    func testPluginExceptionDoesNotCrashLoader() throws {
        let root = try makeTempPluginRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        try writePlugin(
            root: root,
            name: "broken-plugin",
            source: """
            throw new Error("boom");
            """
        )

        let host = PluginHost(abgVersion: "test")
        host.loadAll(from: [root])

        XCTAssertEqual(host.plugins.map(\.name), ["broken-plugin"])
        XCTAssertNil(host.transform(name: "anything", input: "abg"))
    }

    func testBundledMarkdownPluginCompressesImageUrlsByDefault() throws {
        let pluginsDir = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
            .appendingPathComponent("plugins", isDirectory: true)
        let host = PluginHost(abgVersion: "test")
        host.loadAll(from: [pluginsDir])

        let html = """
        <article><h1>Title</h1><p><img alt="Chart" src="https://cdn.example/chart.png"></p><p><img src="https://cdn.example/icon.png"></p><p><a href="https://example.com">Example</a></p></article>
        """

        XCTAssertEqual(
            host.transform(name: "html-to-markdown", input: html),
            """
            # Title

            ![Chart]

            [img]

            [Example](https://example.com)
            """
        )
        XCTAssertEqual(
            host.transform(name: "html-to-markdown-keep-images", input: html),
            """
            # Title

            ![Chart](https://cdn.example/chart.png)

            ![](https://cdn.example/icon.png)

            [Example](https://example.com)
            """
        )
    }

    private func makeTempPluginRoot() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("abg-plugin-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    private func writePlugin(root: URL, name: String, source: String) throws {
        let dir = root.appendingPathComponent(name, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try source.write(to: dir.appendingPathComponent("index.js"), atomically: true, encoding: .utf8)
    }
}
