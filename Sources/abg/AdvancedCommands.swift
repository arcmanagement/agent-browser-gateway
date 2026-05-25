import ArgumentParser
import Foundation

struct Keyboard: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "keyboard",
        abstract: "Keyboard primitives that mirror browser automation APIs",
        subcommands: [KeyboardInsertText.self]
    )
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
