import ArgumentParser
import Foundation

struct Keyboard: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "keyboard",
        abstract: "Keyboard primitives that mirror browser automation APIs",
        subcommands: [KeyboardInsertText.self]
    )
}

struct PDF: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "pdf",
        abstract: "Save the current page as a PDF"
    )
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "Output PDF path") var out: String

    func run() async throws {
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        let result = try client.call(method: "pdf_tab", params: ["tabId": tabId])
        let outPath = (out as NSString).expandingTildeInPath
        let saved = try savePDFResult(result, outPath: outPath)
        printJSON(saved)
    }
}

struct Get: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "get",
        abstract: "Small read-only getters for text, html, value, attr, title, url, count, box, and styles"
    )
    @OptionGroup var match: TabMatchOptions
    @Argument(help: "Getter kind: text/html/value/attr/title/url/count/box/styles") var kind: String
    @Argument(help: "tab ID/ref and optional selector, or selector only when --match-url/title is used") var args: [String] = []
    @Option(name: .long, help: "CSS selector (alternative to positional selector)") var selector: String?
    @Option(name: .long, help: "Attribute name for `get attr`") var name: String?
    @Option(name: .long, help: "Comma-separated computed style properties for `get styles`") var props: String?

    func run() async throws {
        let normalizedKind = kind.lowercased()
        guard ["text", "html", "value", "attr", "title", "url", "count", "box", "styles"].contains(normalizedKind) else {
            try failWithJSON([
                "error": "bad_getter",
                "message": "Getter must be one of text/html/value/attr/title/url/count/box/styles.",
            ])
        }
        if normalizedKind == "attr", name == nil {
            try failWithJSON(["error": "bad_params", "message": "`abg get attr` requires --name."])
        }
        let client = UDSClient()
        let hasMatch = match.matchUrl != nil || match.matchTitle != nil
        let tabToken = hasMatch ? nil : try requireArg(args, index: 0, error: [
            "error": "tab_required",
            "message": "Usage: abg get <kind> <tab> [selector]",
        ])
        let positionalSelectorIndex = hasMatch ? 0 : 1
        let resolvedSelector = selector ?? (args.indices.contains(positionalSelectorIndex) ? args[positionalSelectorIndex] : nil)
        let tabId = try resolveTabId(client: client, tabToken: tabToken, match: match)
        var params: [String: Any] = ["tabId": tabId, "kind": normalizedKind]
        if let resolvedSelector { params["selector"] = resolvedSelector }
        if let name { params["name"] = name }
        if let props {
            params["props"] = props.split(separator: ",").map { String($0).trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        }
        let result = try client.call(method: "get_tab", params: params)
        printJSON(result)
    }
}

struct Find: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "find",
        abstract: "Find elements by semantic locators and optionally act on them"
    )
    @OptionGroup var match: TabMatchOptions
    @Argument(help: "Locator kind: role/text/label/placeholder/alt/title/testid") var locator: String
    @Argument(help: "tab, query pieces, and optional action") var args: [String] = []
    @Option(name: .long, help: "Accessible name for role locators") var name: String?
    @Option(name: .long, help: "Value used by fill/type actions") var value: String?
    @Flag(name: .long, help: "Use exact text matching instead of case-insensitive contains") var exact: Bool = false
    @Option(name: .long, help: "Maximum matches to return") var limit: Int = 20

    func run() async throws {
        let normalizedLocator = locator.lowercased()
        guard ["role", "text", "label", "placeholder", "alt", "title", "testid"].contains(normalizedLocator) else {
            try failWithJSON([
                "error": "bad_locator",
                "message": "Locator must be one of role/text/label/placeholder/alt/title/testid.",
            ])
        }
        let client = UDSClient()
        let hasMatch = match.matchUrl != nil || match.matchTitle != nil
        let tabToken = hasMatch ? nil : try requireArg(args, index: 0, error: [
            "error": "tab_required",
            "message": "Usage: abg find <locator> <tab> <query> [action]",
        ])
        let offset = hasMatch ? 0 : 1
        let tabId = try resolveTabId(client: client, tabToken: tabToken, match: match)
        var params: [String: Any] = [
            "tabId": tabId,
            "locator": normalizedLocator,
            "exact": exact,
            "limit": max(1, min(limit, 100)),
        ]

        let action: String
        if normalizedLocator == "role" {
            let role = try requireArg(args, index: offset, error: [
                "error": "role_required",
                "message": "Usage: abg find role <tab> <role> [action] --name <accessible name>",
            ])
            params["role"] = role
            if let name { params["query"] = name }
            action = args.indices.contains(offset + 1) ? args[offset + 1].lowercased() : "inspect"
        } else {
            let query = try requireArg(args, index: offset, error: [
                "error": "query_required",
                "message": "Usage: abg find \(normalizedLocator) <tab> <query> [action]",
            ])
            params["query"] = query
            action = args.indices.contains(offset + 1) ? args[offset + 1].lowercased() : "inspect"
        }
        params["action"] = action
        if let value { params["value"] = value }
        let result = try client.call(method: "find_tab", params: params)
        if action != "inspect" && action != "text" {
            var step: [String: Any] = ["op": "find", "tabId": tabId, "locator": normalizedLocator, "action": action]
            if let query = params["query"] { step["query"] = query }
            if let role = params["role"] { step["role"] = role }
            if let value { step["value"] = value }
            if exact { step["exact"] = true }
            appendRecordedStep(step)
        }
        printJSON(result)
    }
}

struct IsVisible: AsyncParsableCommand {
    static let configuration = CommandConfiguration(commandName: "is-visible", abstract: "Return whether a selector is visible")
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "CSS selector") var selector: String
    func run() async throws {
        try runPredicate(kind: "visible", target: target, selector: selector)
    }
}

struct IsEnabled: AsyncParsableCommand {
    static let configuration = CommandConfiguration(commandName: "is-enabled", abstract: "Return whether a selector is enabled")
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "CSS selector") var selector: String
    func run() async throws {
        try runPredicate(kind: "enabled", target: target, selector: selector)
    }
}

struct IsChecked: AsyncParsableCommand {
    static let configuration = CommandConfiguration(commandName: "is-checked", abstract: "Return whether a checkbox is checked")
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "CSS selector") var selector: String
    func run() async throws {
        try runPredicate(kind: "checked", target: target, selector: selector)
    }
}

func runPredicate(kind: String, target: TabTarget, selector: String) throws {
    let client = UDSClient()
    let tabId = try resolveTabId(client: client, target: target)
    let result = try client.call(method: "predicate_tab", params: [
        "tabId": tabId,
        "kind": kind,
        "selector": selector,
    ])
    printJSON(result)
}

struct KeyboardInsertText: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "inserttext",
        abstract: "Insert text into the currently focused target through CDP Input.insertText"
    )
    @OptionGroup var match: TabMatchOptions
    @Argument(help: "tab ID/ref and text, or just text when --match-url/title is used") var args: [String] = []

    func run() async throws {
        let client = UDSClient()
        let hasMatch = match.matchUrl != nil || match.matchTitle != nil
        let tabToken = hasMatch ? nil : try requireArg(args, index: 0, error: [
            "error": "tab_required",
            "message": "Usage: abg keyboard inserttext <tab> <text> or abg keyboard inserttext --match-url <glob> <text>",
        ])
        let textStart = hasMatch ? 0 : 1
        guard args.count > textStart else {
            try failWithJSON(["error": "text_required", "message": "text is required"])
        }
        let text = args[textStart...].joined(separator: " ")
        let tabId = try resolveTabId(client: client, tabToken: tabToken, match: match)
        let result = try client.call(method: "keyboard_insert_text_tab", params: [
            "tabId": tabId,
            "text": text,
        ])
        appendRecordedStep(["op": "keyboard_insert_text", "tabId": tabId, "text": text])
        printJSON(result)
    }
}

struct KeyDown: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "keydown",
        abstract: "Dispatch a keyDown event without a matching keyUp"
    )
    @OptionGroup var match: TabMatchOptions
    @Argument(help: "tab ID/ref and key, or just key when --match-url/title is used") var args: [String] = []
    @Option(name: .long, help: "modifiers をカンマ区切り (alt,ctrl,cmd,shift)") var modifiers: String?

    func run() async throws {
        try runKeyEdge(method: "key_down_tab", op: "keydown", match: match, args: args, modifiers: modifiers)
    }
}

struct KeyUp: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "keyup",
        abstract: "Dispatch a keyUp event without a preceding keyDown"
    )
    @OptionGroup var match: TabMatchOptions
    @Argument(help: "tab ID/ref and key, or just key when --match-url/title is used") var args: [String] = []
    @Option(name: .long, help: "modifiers をカンマ区切り (alt,ctrl,cmd,shift)") var modifiers: String?

    func run() async throws {
        try runKeyEdge(method: "key_up_tab", op: "keyup", match: match, args: args, modifiers: modifiers)
    }
}

func runKeyEdge(
    method: String,
    op: String,
    match: TabMatchOptions,
    args: [String],
    modifiers: String?
) throws {
    let client = UDSClient()
    let hasMatch = match.matchUrl != nil || match.matchTitle != nil
    let tabToken = hasMatch ? nil : try requireArg(args, index: 0, error: [
        "error": "tab_required",
        "message": "Usage: abg \(op) <tab> <key> or abg \(op) --match-url <glob> <key>",
    ])
    let key = try requireArg(args, index: hasMatch ? 0 : 1, error: [
        "error": "key_required",
        "message": "key is required",
    ])
    let tabId = try resolveTabId(client: client, tabToken: tabToken, match: match)
    var params: [String: Any] = ["tabId": tabId, "key": key]
    if let modifiers {
        params["modifiers"] = modifiers.split(separator: ",").map { String($0).trimmingCharacters(in: .whitespaces) }
    }
    let result = try client.call(method: method, params: params)
    var step: [String: Any] = ["op": op, "tabId": tabId, "key": key]
    if let modifiers { step["modifiers"] = modifiers }
    appendRecordedStep(step)
    printJSON(result)
}

struct DblClick: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "dblclick",
        abstract: "Double-click an element selected by CSS"
    )
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "Double-click target CSS selector") var selector: String

    func run() async throws {
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        let result = try client.call(method: "dblclick_tab", params: [
            "tabId": tabId,
            "selector": selector,
        ])
        appendRecordedStep(["op": "dblclick", "tabId": tabId, "selector": selector])
        printJSON(result)
    }
}

struct Focus: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "focus",
        abstract: "Focus an element without clicking it"
    )
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "Focus target CSS selector") var selector: String

    func run() async throws {
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        let result = try client.call(method: "focus_tab", params: [
            "tabId": tabId,
            "selector": selector,
        ])
        appendRecordedStep(["op": "focus", "tabId": tabId, "selector": selector])
        printJSON(result)
    }
}

struct Hover: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "hover",
        abstract: "Move the mouse to the center of an element"
    )
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "Hover target CSS selector") var selector: String

    func run() async throws {
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        let result = try client.call(method: "hover_tab", params: [
            "tabId": tabId,
            "selector": selector,
        ])
        appendRecordedStep(["op": "hover", "tabId": tabId, "selector": selector])
        printJSON(result)
    }
}

struct SelectOption: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "select",
        abstract: "Select a native dropdown option by value or visible label"
    )
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "Target select element CSS selector") var selector: String
    @Option(name: .long, help: "Option value to select") var value: String?
    @Option(name: .long, help: "Visible option label to select") var label: String?

    func run() async throws {
        guard (value == nil) != (label == nil) else {
            try failWithJSON([
                "error": "bad_params",
                "message": "Pass exactly one of --value or --label.",
            ])
        }
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        var params: [String: Any] = ["tabId": tabId, "selector": selector]
        if let value { params["value"] = value }
        if let label { params["label"] = label }
        let result = try client.call(method: "select_tab", params: params)
        var step: [String: Any] = ["op": "select", "tabId": tabId, "selector": selector]
        if let value { step["value"] = value }
        if let label { step["label"] = label }
        appendRecordedStep(step)
        printJSON(result)
    }
}

struct Check: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "check",
        abstract: "Ensure a checkbox is checked"
    )
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "Target checkbox CSS selector") var selector: String

    func run() async throws {
        try runCheckedState(commandName: "check", checked: true, target: target, selector: selector)
    }
}

struct Uncheck: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "uncheck",
        abstract: "Ensure a checkbox is unchecked"
    )
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "Target checkbox CSS selector") var selector: String

    func run() async throws {
        try runCheckedState(commandName: "uncheck", checked: false, target: target, selector: selector)
    }
}

func runCheckedState(commandName: String, checked: Bool, target: TabTarget, selector: String) throws {
    let client = UDSClient()
    let tabId = try resolveTabId(client: client, target: target)
    let result = try client.call(method: "checked_state_tab", params: [
        "tabId": tabId,
        "selector": selector,
        "checked": checked,
    ])
    appendRecordedStep(["op": commandName, "tabId": tabId, "selector": selector])
    printJSON(result)
}

struct ScrollIntoView: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "scroll-into-view",
        abstract: "Scroll an element into the viewport"
    )
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "Target CSS selector") var selector: String

    func run() async throws {
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        let result = try client.call(method: "scroll_into_view_tab", params: [
            "tabId": tabId,
            "selector": selector,
        ])
        appendRecordedStep(["op": "scroll-into-view", "tabId": tabId, "selector": selector])
        printJSON(result)
    }
}
