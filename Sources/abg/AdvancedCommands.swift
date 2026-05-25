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
