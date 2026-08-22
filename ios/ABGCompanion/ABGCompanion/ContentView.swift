import SwiftUI

struct ContentView: View {
    @StateObject private var model = CompanionModel()
    @State private var showScanner = false
    @State private var showManualEntry = false

    var body: some View {
        NavigationStack {
            Group {
                switch model.phase {
                case .unpaired:
                    PairingIntroView(showScanner: $showScanner, showManualEntry: $showManualEntry)
                case .claiming:
                    ProgressPane(title: "Contacting your Gateway…", detail: nil, onCancel: model.cancelPairing)
                case .awaitingConfirmation(let code):
                    ConfirmCodePane(code: code, onCancel: model.cancelPairing)
                case .paired:
                    ApprovalListView(model: model)
                }
            }
            .navigationTitle(navigationTitle)
            .toolbar {
                if model.phase == .paired {
                    ToolbarItem(placement: .topBarTrailing) {
                        Menu {
                            Button(model.connected ? "Disconnect" : "Connect", action: model.connected ? model.disconnect : model.connect)
                            Button("Unpair this device", role: .destructive, action: model.unpair)
                        } label: {
                            Label("Gateway", systemImage: "ellipsis.circle")
                        }
                    }
                }
            }
            .sheet(isPresented: $showScanner) {
                QRScannerView { payload in
                    showScanner = false
                    handleScanned(payload)
                }
            }
            .sheet(isPresented: $showManualEntry) {
                ManualPairingView { offer in
                    showManualEntry = false
                    model.pair(with: offer, deviceLabel: UIDevice.current.name)
                }
            }
            .alert("Something went wrong", isPresented: Binding(
                get: { model.errorMessage != nil },
                set: { if !$0 { model.errorMessage = nil } }
            )) {
                Button("OK", role: .cancel) { model.errorMessage = nil }
            } message: {
                Text(model.errorMessage ?? "")
            }
        }
        .onAppear { if model.phase == .paired { model.connect() } }
    }

    private var navigationTitle: String {
        switch model.phase {
        case .paired: return "Approvals"
        default: return "ABG Companion"
        }
    }

    private func handleScanned(_ payload: String) {
        do {
            let offer = try PairingOfferPayload.parse(qrPayload: payload)
            model.pair(with: offer, deviceLabel: UIDevice.current.name)
        } catch {
            model.errorMessage = (error as? LocalizedError)?.errorDescription ?? "That QR code is not an ABG pairing offer."
        }
    }
}

struct PairingIntroView: View {
    @Binding var showScanner: Bool
    @Binding var showManualEntry: Bool

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            Image(systemName: "iphone.and.arrow.forward")
                .font(.system(size: 56))
                .foregroundStyle(.tint)
            VStack(spacing: 8) {
                Text("Approve from your phone")
                    .font(.title2.weight(.semibold))
                Text("Pair with your desktop Gateway to review and decide operation requests. Page contents stay on the desktop — this app only sees a summary of each request.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding(.horizontal, 28)
            Spacer()
            VStack(spacing: 12) {
                Button {
                    showScanner = true
                } label: {
                    Label("Scan pairing QR code", systemImage: "qrcode.viewfinder")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                Button("Enter code manually") { showManualEntry = true }
                    .buttonStyle(.bordered)
                Text("On the desktop, run `abg companion offer` to show a code.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
        }
    }
}

struct ProgressPane: View {
    let title: String
    let detail: String?
    let onCancel: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            ProgressView()
            Text(title).font(.headline)
            if let detail {
                Text(detail).font(.subheadline).foregroundStyle(.secondary)
            }
            Button("Cancel", role: .cancel, action: onCancel).padding(.top, 8)
        }
        .padding()
    }
}

struct ConfirmCodePane: View {
    let code: String
    let onCancel: () -> Void

    var body: some View {
        VStack(spacing: 20) {
            Spacer()
            Text("Check this code on the desktop")
                .font(.headline)
            Text(code)
                .font(.system(size: 44, weight: .bold, design: .monospaced))
                .tracking(6)
                .padding(.vertical, 8)
            Text("Confirm on the desktop only if the same code is shown there. Pairing finishes once you confirm.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            ProgressView().padding(.top, 8)
            Spacer()
            Button("Cancel pairing", role: .cancel, action: onCancel).padding(.bottom, 32)
        }
    }
}

#Preview {
    ContentView()
}
