import ArgumentParser
import CoreImage
import Foundation

// Desktop side of the iOS companion pairing flow (docs/IOS_GATEWAY_PAIRING.md).
// The offer is rendered locally: the QR code is drawn in the terminal from the
// offer payload, so the pairing nonce never leaves this machine except as the
// code the user points their phone at.

struct Companion: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "companion",
        abstract: "Pair an iOS companion and manage paired devices",
        discussion: """
        A paired iPhone can receive operation approval summaries and decide them, within the
        scopes granted at pairing time. Tab contents never leave the desktop. Pairing offers
        expire after five minutes, and revocation closes the companion's session immediately.
        """,
        subcommands: [
            CompanionOffer.self,
            CompanionConfirm.self,
            CompanionReject.self,
            CompanionList.self,
            CompanionRevoke.self,
        ]
    )
}

struct CompanionOffer: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "offer",
        abstract: "Create a pairing offer and show its QR code and manual code"
    )
    @Flag(name: .long, help: "Print the manual pairing fields instead of the QR code") var manual: Bool = false
    @Flag(name: .long, help: "Print the raw offer JSON without waiting for the claim") var json: Bool = false
    @Option(name: .long, help: "Seconds to wait for the phone's claim before giving up (default 300)") var timeout: Int = 300

    func run() async throws {
        let client = UDSClient()
        guard let offer = try client.call(method: "pairing_offer_create") as? [String: Any],
              let pairingId = offer["pairingId"] as? String else {
            try failWithJSON(["error": "bad_response", "message": "gateway did not return a pairing offer"])
        }
        if json {
            printJSON(offer)
            return
        }

        let payload = qrPayload(from: offer)
        if manual {
            printManualFields(offer)
        } else {
            print(QRCodeRenderer.render(payload))
            print("Scan with ABG on your iPhone, or run `abg companion offer --manual` for the typed form.")
        }
        if let displayCode = offer["displayCode"] as? String {
            print("\nDisplay code: \(displayCode)")
        }
        if let expiresAt = offer["expiresAt"] as? String {
            print("Offer expires: \(expiresAt)")
        }

        print("\nWaiting for the phone to claim this offer…  (Ctrl-C to cancel)")
        // stdout is fully buffered when redirected to a file or pipe; the offer
        // must be visible before this command starts waiting.
        fflush(stdout)
        let deadline = Date().addingTimeInterval(TimeInterval(timeout))
        while Date() < deadline {
            if let pending = try? UDSClient().call(method: "pairing_pending") as? [String: Any],
               pending["pending"] as? Bool == true,
               let code = pending["displayCode"] as? String,
               let label = pending["deviceLabel"] as? String {
                print("\n\(label) is asking to pair.")
                print("Confirm only if that device shows the same code: \(code)")
                print("\n  abg companion confirm \(pairingId)     # finish pairing")
                print("  abg companion reject \(pairingId)      # codes do not match")
                return
            }
            try await Task.sleep(nanoseconds: 1_500_000_000)
        }
        try failWithJSON([
            "error": "expired_offer",
            "message": "No device claimed the pairing offer in time.",
            "userMessage": "端末からの pairing 要求が時間内に届きませんでした。`abg companion offer` をやり直してください。",
        ])
    }

    private func qrPayload(from offer: [String: Any]) -> String {
        let fields = ["gatewayBaseUrl", "pairingId", "pairingNonce", "desktopPublicKey", "expiresAt", "displayCode"]
        var payload: [String: Any] = [:]
        for field in fields {
            if let value = offer[field] { payload[field] = value }
        }
        payload["requestedScopes"] = offer["requestedScopes"] ?? ["approval_forwarding", "pairing_status"]
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]),
              let text = String(data: data, encoding: .utf8) else {
            return ""
        }
        return text
    }

    private func printManualFields(_ offer: [String: Any]) {
        print("Enter these on the phone (ABG → Enter code manually):\n")
        let rows: [(String, String)] = [
            ("Gateway address", offer["gatewayBaseUrl"] as? String ?? ""),
            ("Pairing code", offer["manualCode"] as? String ?? ""),
            ("Nonce", offer["pairingNonce"] as? String ?? ""),
            ("Desktop public key", offer["desktopPublicKey"] as? String ?? ""),
        ]
        for (label, value) in rows {
            print("  \(label.padding(toLength: 20, withPad: " ", startingAt: 0)) \(value)")
        }
    }
}

struct CompanionConfirm: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "confirm",
        abstract: "Confirm a claimed pairing offer after checking the display code on both devices"
    )
    @Argument(help: "Pairing id from `abg companion offer`") var pairingId: String

    func run() async throws {
        printJSON(try UDSClient().call(method: "pairing_confirm", params: ["pairingId": pairingId]))
    }
}

struct CompanionReject: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "reject",
        abstract: "Reject a claimed pairing offer when the display codes do not match"
    )
    @Argument(help: "Pairing id from `abg companion offer`") var pairingId: String

    func run() async throws {
        printJSON(try UDSClient().call(method: "pairing_reject", params: ["pairingId": pairingId]))
    }
}

struct CompanionList: AsyncParsableCommand {
    static let configuration = CommandConfiguration(commandName: "list", abstract: "List paired companions")

    func run() async throws {
        printJSON(try UDSClient().call(method: "companion_list"))
    }
}

struct CompanionRevoke: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "revoke",
        abstract: "Revoke a paired companion and close its session immediately"
    )
    @Argument(help: "Device id from `abg companion list`") var deviceId: String

    func run() async throws {
        printJSON(try UDSClient().call(method: "companion_revoke", params: ["deviceId": deviceId]))
    }
}

/// Renders the pairing offer as a terminal QR code. CoreImage does the encoding,
/// so there is no hand-rolled encoder and no runtime dependency; the payload
/// never leaves this machine.
enum QRCodeRenderer {
    static func render(_ text: String) -> String {
        guard let matrix = matrix(for: text) else {
            return "(could not render a QR code here — use `abg companion offer --manual`)"
        }
        return draw(matrix)
    }

    static func matrix(for text: String) -> [[Bool]]? {
        guard let filter = CIFilter(name: "CIQRCodeGenerator") else { return nil }
        filter.setValue(Data(text.utf8), forKey: "inputMessage")
        // L is enough: the code is read from a screen at close range, and a
        // smaller matrix keeps the terminal rendering legible.
        filter.setValue("L", forKey: "inputCorrectionLevel")
        guard let image = filter.outputImage else { return nil }

        let extent = image.extent
        let width = Int(extent.width.rounded())
        let height = Int(extent.height.rounded())
        guard width > 0, height > 0 else { return nil }

        var pixels = [UInt8](repeating: 0, count: width * height)
        guard let colorSpace = CGColorSpace(name: CGColorSpace.linearGray),
              let context = CGContext(
                data: &pixels,
                width: width,
                height: height,
                bitsPerComponent: 8,
                bytesPerRow: width,
                space: colorSpace,
                bitmapInfo: CGImageAlphaInfo.none.rawValue
              ),
              let cgImage = CIContext(options: nil).createCGImage(image, from: extent) else {
            return nil
        }
        context.interpolationQuality = .none
        context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))

        // CoreImage draws dark modules as black; flip to "true means dark" and
        // to top-down row order.
        var rows: [[Bool]] = []
        for y in stride(from: height - 1, through: 0, by: -1) {
            var row: [Bool] = []
            for x in 0..<width {
                row.append(pixels[y * width + x] < 128)
            }
            rows.append(row)
        }
        return rows
    }

    /// Two matrix rows per text line keeps the code square in a terminal.
    static func draw(_ matrix: [[Bool]]) -> String {
        let quiet = 2
        let size = matrix.count
        let width = matrix.first?.count ?? size
        func isDark(_ row: Int, _ col: Int) -> Bool {
            let r = row - quiet, c = col - quiet
            guard r >= 0, r < size, c >= 0, c < width else { return false }
            return matrix[r][c]
        }
        var out: [String] = []
        var row = 0
        let totalRows = size + quiet * 2
        let totalCols = width + quiet * 2
        while row < totalRows {
            var line = ""
            for col in 0..<totalCols {
                let top = isDark(row, col)
                let bottom = row + 1 < totalRows ? isDark(row + 1, col) : false
                switch (top, bottom) {
                case (true, true): line += "\u{2588}"
                case (true, false): line += "\u{2580}"
                case (false, true): line += "\u{2584}"
                case (false, false): line += " "
                }
            }
            out.append(line)
            row += 2
        }
        return out.joined(separator: "\n")
    }
}
