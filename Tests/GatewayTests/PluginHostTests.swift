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

    func testDomainTransformUsesMatchingPluginManifest() throws {
        let root = try makeTempPluginRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        try writePlugin(
            root: root,
            name: "notion-lite",
            manifest: """
            {
              "name": "notion-lite",
              "domains": ["https://www.notion.so/*"],
              "transforms": ["notion-lite-markdown"]
            }
            """,
            source: """
            abg.registerTransform("notion-lite-markdown", function (input) {
              return "notion:" + String(input).trim();
            });
            """
        )

        let host = PluginHost(abgVersion: "test")
        host.loadAll(from: [root])

        let matched = host.domainTransform(
            url: "https://www.notion.so/acme/Launch-Plan-123",
            kind: "markdown",
            input: " page "
        )
        XCTAssertEqual(matched?.name, "notion-lite-markdown")
        XCTAssertEqual(matched?.output, "notion:page")
        XCTAssertNil(host.domainTransform(url: "https://example.com/page", kind: "markdown", input: "page"))
    }

    func testBundledNotionPluginStripsAppChrome() throws {
        let pluginsDir = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
            .appendingPathComponent("plugins", isDirectory: true)
        let host = PluginHost(abgVersion: "test")
        host.loadAll(from: [pluginsDir])

        let html = """
        <html><body>
          <div class="notion-sidebar">Workspace nav Private DB</div>
          <div class="notion-topbar">Share Updates Search</div>
          <main>
            <h1>Launch Plan</h1>
            <p>Ship ABG plugin docs.</p>
            <ul><li>Write benchmark</li><li>Publish tutorial</li></ul>
          </main>
          <div class="notion-help-button">?</div>
          <script>window.__notion = "noise";</script>
        </body></html>
        """

        let markdown = try XCTUnwrap(host.transform(name: "notion-to-markdown", input: html))
        XCTAssertTrue(markdown.contains("# Launch Plan"))
        XCTAssertTrue(markdown.contains("Ship ABG plugin docs."))
        XCTAssertTrue(markdown.contains("- Write benchmark"))
        XCTAssertFalse(markdown.contains("Workspace nav"))
        XCTAssertFalse(markdown.contains("Share Updates"))
        XCTAssertFalse(markdown.contains("window.__notion"))

        let domainResult = host.domainTransform(
            url: "https://www.notion.so/acme/Launch-Plan-123",
            kind: "markdown",
            input: html
        )
        XCTAssertEqual(domainResult?.name, "notion-to-markdown")
        XCTAssertEqual(
            host.domainTransform(url: "https://notion.so/acme/Launch-Plan-123", kind: "markdown", input: html)?.name,
            "notion-to-markdown"
        )
    }

    private func makeTempPluginRoot() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("abg-plugin-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    private func writePlugin(root: URL, name: String, manifest: String? = nil, source: String) throws {
        let dir = root.appendingPathComponent(name, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        if let manifest {
            try manifest.write(to: dir.appendingPathComponent("plugin.json"), atomically: true, encoding: .utf8)
        }
        try source.write(to: dir.appendingPathComponent("index.js"), atomically: true, encoding: .utf8)
    }
}
