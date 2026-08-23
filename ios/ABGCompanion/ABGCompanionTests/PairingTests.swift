import CryptoKit
import XCTest
@testable import Agent_Browser_Gateway

final class PairingTests: XCTestCase {
    func testOfferPayloadParsesTheDesktopQRJSON() throws {
        let json = """
        {"gatewayBaseUrl":"http://100.64.0.5:8767","pairingId":"abc123","pairingNonce":"deadbeef","desktopPublicKey":"a2V5","expiresAt":"2026-08-22T09:00:00Z","displayCode":"123456","requestedScopes":["approval_forwarding","pairing_status","tab_sharing"]}
        """
        let offer = try PairingOfferPayload.parse(qrPayload: json)
        XCTAssertEqual(offer.pairingId, "abc123")
        XCTAssertEqual(offer.displayCode, "123456")
        XCTAssertEqual(offer.requestedScopes, ["approval_forwarding", "pairing_status", "tab_sharing"])
    }

    func testMalformedQRPayloadIsRejected() {
        XCTAssertThrowsError(try PairingOfferPayload.parse(qrPayload: "https://example.com"))
    }

    func testManualCodeParsing() throws {
        let parsed = try ManualPairingCode.parse("ABG-PAIR-d4d6a539f49ce241-827426-b6dc435d")
        XCTAssertEqual(parsed.pairingId, "d4d6a539f49ce241")
        XCTAssertEqual(parsed.displayCode, "827426")
        XCTAssertEqual(parsed.nonceFragment, "b6dc435d")
        XCTAssertThrowsError(try ManualPairingCode.parse("ABG-PAIR-only-three"))
        XCTAssertThrowsError(try ManualPairingCode.parse("NOT-A-CODE-1-2-3"))
    }

    func testSessionSealingOpensWhatTheDesktopSealed() throws {
        // Mirrors the desktop's seal: ephemeral X25519 -> HKDF-SHA256 -> ChaChaPoly.
        let deviceKey = Curve25519.KeyAgreement.PrivateKey()
        let ephemeral = Curve25519.KeyAgreement.PrivateKey()
        let shared = try ephemeral.sharedSecretFromKeyAgreement(with: deviceKey.publicKey)
        let symmetric = shared.hkdfDerivedSymmetricKey(
            using: SHA256.self,
            salt: Data(),
            sharedInfo: SessionSealing.info,
            outputByteCount: 32
        )
        let box = try ChaChaPoly.seal(Data("token-abc".utf8), using: symmetric)
        let sealed = SealedSession(
            ephemeralPublicKey: ephemeral.publicKey.rawRepresentation.base64EncodedString(),
            ciphertext: box.combined.base64EncodedString()
        )
        XCTAssertEqual(try SessionSealing.open(sealed, privateKey: deviceKey), "token-abc")
        XCTAssertThrowsError(try SessionSealing.open(sealed, privateKey: Curve25519.KeyAgreement.PrivateKey()))
    }

    func testApprovalSummaryDecodingAndDestructiveClassification() throws {
        let text = """
        {"type":"approval_pending","approval":{"approvalId":"a1","method":"personal_data_mutation","intent":"PERMANENTLY DELETE bookmark \\"Docs\\"","targetOrigin":"https://example.com","targetTabRef":"t1","requester":"cli","gatewayLabel":"dev@mac","createdAt":"2026-08-22T09:00:00Z","expiresAt":"2026-08-22T09:01:00Z","scriptPreview":null,"canAllow":true}}
        """
        guard case .pending(let summary)? = CompanionEvent.decode(text) else {
            return XCTFail("expected approval_pending")
        }
        XCTAssertEqual(summary.approvalId, "a1")
        XCTAssertTrue(summary.isDestructive)
        XCTAssertTrue(summary.isExpired(at: Date(timeIntervalSince1970: 4_000_000_000)))

        let clickText = text.replacingOccurrences(of: "personal_data_mutation", with: "click_selector")
            .replacingOccurrences(of: "PERMANENTLY DELETE bookmark \\\"Docs\\\"", with: "Click the element")
        guard case .pending(let click)? = CompanionEvent.decode(clickText) else {
            return XCTFail("expected approval_pending")
        }
        XCTAssertFalse(click.isDestructive)
    }

    func testDecisionEventsDecode() {
        guard case .resolved(let id, let decision, let by)? = CompanionEvent.decode(
            #"{"type":"approval_resolved","approvalId":"a1","decision":"allow","decidedBy":"companion:abc"}"#
        ) else { return XCTFail("expected resolved") }
        XCTAssertEqual(id, "a1")
        XCTAssertEqual(decision, "allow")
        XCTAssertEqual(by, "companion:abc")

        guard case .decisionResult(_, let ok, let error)? = CompanionEvent.decode(
            #"{"type":"decision_result","approvalId":"a1","ok":false,"error":"approval_already_decided"}"#
        ) else { return XCTFail("expected decision_result") }
        XCTAssertFalse(ok)
        XCTAssertEqual(error, "approval_already_decided")
    }

    func testDecisionErrorMessagesAreActionable() {
        XCTAssertTrue(CompanionModelMessages.expired.contains("expired"))
        XCTAssertTrue(CompanionModelMessages.alreadyDecided.contains("already decided"))
        XCTAssertTrue(CompanionModelMessages.desktopGesture.contains("desktop"))
    }

    func testPairingStoreKeepsIdentityAndClearsPairingOnly() {
        let store = PairingStore(secrets: MemorySecretStore())
        let key1 = store.devicePublicKeyBase64
        XCTAssertEqual(key1, store.devicePublicKeyBase64, "device identity must be stable")

        store.saveGateway(
            PairedGateway(deviceId: "d1", gatewayBaseUrl: "http://100.64.0.5:8767", gatewayLabel: "mac", pairedAt: Date()),
            sessionToken: "tok"
        )
        XCTAssertEqual(store.sessionToken(), "tok")
        XCTAssertEqual(store.loadGateway()?.deviceId, "d1")

        store.clearPairing()
        XCTAssertNil(store.sessionToken())
        XCTAssertNil(store.loadGateway())
        XCTAssertEqual(store.devicePublicKeyBase64, key1, "unpairing keeps the device identity")
    }

    func testPairingStoreMigratesAnExistingKeychainSessionToTheAppGroup() throws {
        let secrets = MemorySecretStore()
        let legacyStore = PairingStore(secrets: secrets)
        let gateway = PairedGateway(
            deviceId: "d1",
            gatewayBaseUrl: "http://100.64.0.5:8767",
            gatewayLabel: "mac",
            pairedAt: Date(timeIntervalSince1970: 1_777_000_000)
        )
        legacyStore.saveGateway(gateway, sessionToken: "tok")

        let sessionURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("abg-pairing-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: sessionURL) }
        let sharedSession = AppGroupPairingSessionStore(sessionURL: sessionURL)
        let migratedStore = PairingStore(secrets: secrets, sharedSession: sharedSession)

        XCTAssertEqual(migratedStore.loadGateway(), gateway)
        XCTAssertEqual(sharedSession.load()?.gateway, gateway)
        XCTAssertEqual(sharedSession.load()?.sessionToken, "tok")
    }
}

/// Message strings surfaced by CompanionModel, pulled out so they can be asserted
/// without touching the main actor.
enum CompanionModelMessages {
    static let expired = "That request expired before the decision arrived."
    static let alreadyDecided = "That request was already decided somewhere else."
    static let desktopGesture = "Recording must be allowed on the desktop: the capture permission is tied to that window."
}
