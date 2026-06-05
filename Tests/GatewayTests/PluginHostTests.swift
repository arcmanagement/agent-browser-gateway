import XCTest
import GatewayCore
@testable import Gateway

@MainActor
final class PluginHostTests: XCTestCase {
    struct TestError: Error, LocalizedError {
        let errorDescription: String?
    }

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

    func testLoadsPluginAndRunsRegisteredCommand() async throws {
        let root = try makeTempPluginRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        try writePlugin(
            root: root,
            name: "command-plugin",
            manifest: """
            {
              "name": "command-plugin",
              "version": "0.1.0",
              "commands": [
                {
                  "name": "ping",
                  "description": "Return a ping response.",
                  "args": [
                    { "name": "message", "type": "string", "required": false, "default": "pong" }
                  ]
                }
              ]
            }
            """,
            source: """
            abg.registerCommand("ping", async function (args, context) {
              return { ok: true, echo: args.message || "pong", plugin: context.plugin.name };
            });
            """
        )

        let host = PluginHost(abgVersion: "test")
        host.loadAll(from: [root])

        let commands = host.commandList()
        XCTAssertEqual(commands.first?["plugin"] as? String, "command-plugin")
        XCTAssertEqual(commands.first?["command"] as? String, "ping")

        let result = try await host.runCommand(
            plugin: "command-plugin",
            command: "ping",
            args: ["message": "hi"],
            tabId: nil
        ).value as? [String: Any]
        XCTAssertEqual(result?["ok"] as? Bool, true)
        XCTAssertEqual(result?["echo"] as? String, "hi")
        XCTAssertEqual(result?["plugin"] as? String, "command-plugin")
    }

    func testCommandContextTabPasteDispatchesAndResolves() async throws {
        let root = try makeTempPluginRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        try writePlugin(
            root: root,
            name: "tab-plugin",
            source: """
            abg.registerCommand("write", async function (args, context) {
              const result = await context.tab.paste({ selector: args.selector, value: args.value });
              return { ok: true, result };
            });
            """
        )

        var calls: [(method: String, params: [String: Any])] = []
        let host = PluginHost(abgVersion: "test") { method, params in
            calls.append((method, params))
            return AnyCodable(["ok": true, "fromDispatcher": true])
        }
        host.loadAll(from: [root])

        let result = try await host.runCommand(
            plugin: "tab-plugin",
            command: "write",
            args: ["selector": "#prompt", "value": "hello"],
            tabId: 42
        ).value as? [String: Any]

        XCTAssertEqual(calls.count, 1)
        XCTAssertEqual(calls.first?.method, "paste_tab")
        XCTAssertEqual(calls.first?.params["tabId"] as? Int, 42)
        XCTAssertEqual(calls.first?.params["selector"] as? String, "#prompt")
        XCTAssertEqual(calls.first?.params["value"] as? String, "hello")
        XCTAssertEqual(result?["ok"] as? Bool, true)
        let dispatchResult = result?["result"] as? [String: Any]
        XCTAssertEqual(dispatchResult?["ok"] as? Bool, true)
        XCTAssertEqual(dispatchResult?["fromDispatcher"] as? Bool, true)
    }

    func testCommandContextTabRejectsWhenDispatcherThrows() async throws {
        let root = try makeTempPluginRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        try writePlugin(
            root: root,
            name: "tab-plugin",
            source: """
            abg.registerCommand("write", async function (args, context) {
              return await context.tab.paste({ selector: args.selector, value: args.value });
            });
            """
        )

        let host = PluginHost(abgVersion: "test") { _, _ in
            throw TestError(errorDescription: "dispatcher failed")
        }
        host.loadAll(from: [root])

        do {
            _ = try await host.runCommand(
                plugin: "tab-plugin",
                command: "write",
                args: ["selector": "#prompt", "value": "hello"],
                tabId: 42
            )
            XCTFail("Expected dispatcher rejection")
        } catch let error as PluginCommandError {
            XCTAssertTrue(error.localizedDescription.contains("dispatcher failed"))
        }
    }

    func testCommandContextTabRejectsWithoutTabId() async throws {
        let root = try makeTempPluginRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        try writePlugin(
            root: root,
            name: "tab-plugin",
            source: """
            abg.registerCommand("write", async function (args, context) {
              try {
                await context.tab.paste({ selector: args.selector, value: args.value });
                return { ok: true };
              } catch (error) {
                return { ok: false, error: error.error, message: error.message };
              }
            });
            """
        )

        var dispatchCount = 0
        let host = PluginHost(abgVersion: "test") { _, _ in
            dispatchCount += 1
            return AnyCodable(["ok": true])
        }
        host.loadAll(from: [root])

        let result = try await host.runCommand(
            plugin: "tab-plugin",
            command: "write",
            args: ["selector": "#prompt", "value": "hello"],
            tabId: nil
        ).value as? [String: Any]

        XCTAssertEqual(dispatchCount, 0)
        XCTAssertEqual(result?["ok"] as? Bool, false)
        XCTAssertEqual(result?["error"] as? String, "no_tab_context")
        XCTAssertTrue((result?["message"] as? String)?.contains("context.tab.paste") == true)
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

    func testBundledMarkdownPluginNormalizesSlackSenderName() throws {
        let pluginsDir = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
            .appendingPathComponent("plugins", isDirectory: true)
        let host = PluginHost(abgVersion: "test")
        host.loadAll(from: [pluginsDir])

        let html =
            #"<div><img src="https://cdn.example/avatar.png">"# +
            #"<span data-qa="message_sender_name"><span aria-label="Ada Lovelace">Ada Lovelace</span><span>Ada Lovelace</span></span>"# +
            #"<span aria-hidden="true"> : </span>"# +
            #"<a href="https://example.slack.com/archives/C0EXAMPLE0/p1710000000000000">12:19</a></div>"#
        let markdown = try XCTUnwrap(host.transform(name: "html-to-markdown", input: html))

        XCTAssertEqual(
            markdown,
            "[img]Ada Lovelace [12:19](https://example.slack.com/archives/C0EXAMPLE0/p1710000000000000)"
        )
        XCTAssertFalse(markdown.contains("Ada LovelaceAda Lovelace"))
        XCTAssertFalse(markdown.contains("Ada Lovelace :"))
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

    func testManifestDomainHelpersExposePluginCommandBindingPatterns() throws {
        let root = try makeTempPluginRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        try writePlugin(
            root: root,
            name: "gemini-plugin",
            manifest: """
            {
              "name": "gemini-plugin",
              "domains": ["https://gemini.google.com/*"],
              "commands": ["summarize"]
            }
            """,
            source: """
            abg.registerCommand("summarize", function () {
              return { ok: true };
            });
            """
        )

        let host = PluginHost(abgVersion: "test")
        host.loadAll(from: [root])

        XCTAssertEqual(host.domainPatterns(for: "gemini-plugin"), ["https://gemini.google.com/*"])
        XCTAssertTrue(host.matchesManifestDomain(plugin: "gemini-plugin", url: "https://gemini.google.com/app"))
        XCTAssertFalse(host.matchesManifestDomain(plugin: "gemini-plugin", url: "https://example.com/app"))
        XCTAssertNil(host.domainPatterns(for: "missing-plugin"))
    }

    func testPluginReloadKeepsPreviousVersionWhenReloadFails() throws {
        let root = try makeTempPluginRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        try writePlugin(
            root: root,
            name: "reload-plugin",
            manifest: """
            {
              "name": "reload-plugin",
              "transforms": ["reload-demo-markdown"]
            }
            """,
            source: """
            abg.registerTransform("reload-demo-markdown", function () { return "v1"; });
            """
        )

        let host = PluginHost(abgVersion: "test")
        host.loadAll(from: [root])
        XCTAssertEqual(host.transform(name: "reload-demo-markdown", input: "x"), "v1")

        try writePlugin(
            root: root,
            name: "reload-plugin",
            manifest: """
            {
              "name": "reload-plugin",
              "transforms": ["reload-demo-markdown"]
            }
            """,
            source: """
            throw new Error("reload failed");
            """
        )
        let failed = host.reload(plugin: "reload-plugin")
        XCTAssertEqual(failed.first?["status"] as? String, "failed")
        XCTAssertEqual(failed.first?["previousVersionKept"] as? Bool, true)
        XCTAssertEqual(host.transform(name: "reload-demo-markdown", input: "x"), "v1")

        try writePlugin(
            root: root,
            name: "reload-plugin",
            manifest: """
            {
              "name": "reload-plugin",
              "transforms": ["reload-demo-markdown"]
            }
            """,
            source: """
            abg.registerTransform("reload-demo-markdown", function () { return "v2"; });
            """
        )
        let reloaded = host.reload(plugin: "reload-plugin")
        XCTAssertEqual(reloaded.first?["status"] as? String, "reloaded")
        XCTAssertEqual(host.transform(name: "reload-demo-markdown", input: "x"), "v2")
    }

    func testBundledRedactionPluginMasksSensitivePatternsAndCustomRegexes() throws {
        let pluginsDir = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
            .appendingPathComponent("plugins", isDirectory: true)
        let host = PluginHost(abgVersion: "test")
        host.loadAll(from: [pluginsDir])

        let input = "Email ada@example.com, phone +1 (415) 555-0123, card 4242 4242 4242 4242, ticket ACME-123."
        let redaction = try XCTUnwrap(host.redact(kind: "markdown", input: input, customRegexes: ["ACME-[0-9]+"]))

        XCTAssertEqual(redaction.names, ["local-redact-markdown", "custom-regex-1"])
        XCTAssertTrue(redaction.output.contains("[redacted:email]"))
        XCTAssertTrue(redaction.output.contains("[redacted:phone]"))
        XCTAssertTrue(redaction.output.contains("[redacted:card]"))
        XCTAssertTrue(redaction.output.contains("[redacted:custom-1]"))
        XCTAssertFalse(redaction.output.contains("ada@example.com"))
        XCTAssertFalse(redaction.output.contains("ACME-123"))
    }

    func testBundledWorkflowCommandUsesTabAPI() async throws {
        let pluginsDir = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
            .appendingPathComponent("plugins", isDirectory: true)
        var calls: [(method: String, params: [String: Any])] = []
        let host = PluginHost(abgVersion: "test") { method, params in
            calls.append((method, params))
            return AnyCodable(["ok": true, "method": method])
        }
        host.loadAll(from: [pluginsDir])

        let result = try await host.runCommand(
            plugin: "workflow",
            command: "clear-and-paste",
            args: ["selector": "#prompt", "value": "Ship it"],
            tabId: 99
        ).value as? [String: Any]

        XCTAssertEqual(result?["ok"] as? Bool, true)
        XCTAssertEqual(calls.map(\.method), ["clear_tab", "paste_tab"])
        XCTAssertEqual(calls.first?.params["tabId"] as? Int, 99)
        XCTAssertEqual(calls.last?.params["selector"] as? String, "#prompt")
        XCTAssertEqual(calls.last?.params["value"] as? String, "Ship it")
    }

    func testBundledSlackCatchUpWaitsForSettledChannelDom() async throws {
        let pluginsDir = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
            .appendingPathComponent("plugins", isDirectory: true)
        let fixture = try readFixture("slack-channel.html")
        let staleFixture = fixture.replacingOccurrences(of: "/archives/C123/", with: "/archives/C999/")
        var readCount = 0
        var calls: [String] = []
        let host = PluginHost(abgVersion: "test") { method, _ in
            calls.append(method)
            if method == "read_tab" {
                readCount += 1
                return AnyCodable([
                    "url": "https://app.slack.com/client/T123/C123",
                    "title": "Slack",
                    "html": readCount == 1 ? staleFixture : fixture,
                    "text": "Slack fixture",
                ])
            }
            return AnyCodable(["ok": true])
        }
        host.loadAll(from: [pluginsDir])

        let result = try await host.runCommand(
            plugin: "slack",
            command: "catch-up",
            args: ["limit": 5, "timeoutMs": 1000],
            tabId: 1
        ).value as? [String: Any]

        XCTAssertEqual(result?["ok"] as? Bool, true)
        XCTAssertEqual(result?["channel_id"] as? String, "C123")
        XCTAssertEqual(result?["count"] as? Int, 2)
        XCTAssertTrue((result?["markdown"] as? String)?.contains("open-channel helper") == true)
        XCTAssertEqual(calls, ["read_tab", "wait_tab", "read_tab"])
    }

    func testBundledSlackOpenChannelNavigatesByName() async throws {
        let pluginsDir = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
            .appendingPathComponent("plugins", isDirectory: true)
        let sidebar = """
        <html><body>
          <a href="https://app.slack.com/client/T123/C123">#general</a>
        </body></html>
        """
        var calls: [(method: String, params: [String: Any])] = []
        var navigatedURL: String?
        let host = PluginHost(abgVersion: "test") { method, params in
            calls.append((method, params))
            if method == "navigate_tab" {
                navigatedURL = params["url"] as? String
                return AnyCodable(["ok": true])
            }
            if method == "read_tab" {
                return AnyCodable([
                    "url": navigatedURL ?? "https://app.slack.com/client/T123/C111",
                    "title": "Slack",
                    "html": sidebar,
                    "text": "Slack sidebar",
                ])
            }
            return AnyCodable(["ok": true])
        }
        host.loadAll(from: [pluginsDir])

        let result = try await host.runCommand(
            plugin: "slack",
            command: "open-channel",
            args: ["name": "general", "timeoutMs": 1000],
            tabId: 1
        ).value as? [String: Any]

        XCTAssertEqual(result?["ok"] as? Bool, true)
        XCTAssertEqual(result?["channel_id"] as? String, "C123")
        XCTAssertEqual(result?["before"] as? String, "C111")
        XCTAssertEqual(result?["after"] as? String, "C123")
        XCTAssertEqual(navigatedURL, "https://app.slack.com/client/T123/C123")
        XCTAssertEqual(calls.map(\.method), ["read_tab", "navigate_tab", "read_tab"])
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

    func testBundledGmailSlackLinearPluginsStripAppChrome() throws {
        let pluginsDir = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
            .appendingPathComponent("plugins", isDirectory: true)
        let host = PluginHost(abgVersion: "test")
        host.loadAll(from: [pluginsDir])

        let gmail = try XCTUnwrap(host.transform(name: "gmail-to-markdown", input: readFixture("gmail-thread.html")))
        XCTAssertTrue(gmail.contains("Plugin launch notes"))
        XCTAssertTrue(gmail.contains("Please review the ABG plugin plan."))
        XCTAssertFalse(gmail.contains("Inbox Starred"))
        XCTAssertFalse(gmail.contains("Search mail"))

        let slack = try XCTUnwrap(host.transform(name: "slack-to-markdown", input: readFixture("slack-channel.html")))
        XCTAssertTrue(slack.contains("Ship the plugin auto-bind fix."))
        XCTAssertTrue(slack.contains("Add the open-channel helper."))
        XCTAssertFalse(slack.contains("channels random general"))

        let linear = try XCTUnwrap(host.transform(name: "linear-to-markdown", input: readFixture("linear-issue.html")))
        XCTAssertTrue(linear.contains("# Plugin commands should auto-bind tabs"))
        XCTAssertTrue(linear.contains("Issue: ABG-42"))
        XCTAssertTrue(linear.contains("Status: In Progress"))
        XCTAssertFalse(linear.contains("Workspace Projects Views"))
    }

    private func makeTempPluginRoot() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("abg-plugin-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    private func readFixture(_ name: String) throws -> String {
        let url = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
            .appendingPathComponent("examples/fixtures", isDirectory: true)
            .appendingPathComponent(name)
        return try String(contentsOf: url, encoding: .utf8)
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
