import SwiftUI

/// Manual fallback when the camera cannot be used. The desktop shows the same
/// values next to the QR code.
struct ManualPairingView: View {
    let onOffer: (PairingOfferPayload) -> Void

    @State private var address = ""
    @State private var code = ""
    @State private var nonce = ""
    @State private var desktopKey = ""
    @State private var error: String?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Gateway address") {
                    TextField("http://100.64.0.5:8767", text: $address)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                }
                Section("Pairing code") {
                    TextField("ABG-PAIR-…", text: $code)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                }
                Section {
                    TextField("Nonce", text: $nonce)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField("Desktop public key", text: $desktopKey)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } header: {
                    Text("Pairing key")
                } footer: {
                    Text("Run `abg companion offer --manual` on the desktop to see these values.")
                }
                if let error {
                    Section { Text(error).foregroundStyle(.red) }
                }
            }
            .navigationTitle("Enter pairing code")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Pair") { submit() }.disabled(!isComplete)
                }
            }
        }
    }

    private var isComplete: Bool {
        !address.isEmpty && !code.isEmpty && !nonce.isEmpty && !desktopKey.isEmpty
    }

    private func submit() {
        do {
            let parsed = try ManualPairingCode.parse(code)
            let base = address.trimmingCharacters(in: .whitespacesAndNewlines)
            let offer = PairingOfferPayload(
                gatewayBaseUrl: base.hasSuffix("/") ? String(base.dropLast()) : base,
                pairingId: parsed.pairingId,
                pairingNonce: nonce.trimmingCharacters(in: .whitespacesAndNewlines),
                desktopPublicKey: desktopKey.trimmingCharacters(in: .whitespacesAndNewlines),
                expiresAt: Date().addingTimeInterval(5 * 60),
                displayCode: parsed.displayCode,
                requestedScopes: ["approval_forwarding", "pairing_status"]
            )
            onOffer(offer)
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? "Check the pairing code and try again."
        }
    }
}
