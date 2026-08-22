import Crypto
import Foundation
import XCTest
@testable import Gateway
@testable import GatewayCore

final class PairingEngineTests: XCTestCase {
    private func devicePublicKey() -> String {
        Curve25519.KeyAgreement.PrivateKey().publicKey.rawRepresentation.base64EncodedString()
    }

    func testOfferPayloadCarriesTheDesignFields() {
        var engine = PairingEngine()
        let offer = engine.createOffer()
        let payload = engine.offerPayload(gatewayBaseUrl: "http://100.64.0.5:8767")

        XCTAssertEqual(payload?.pairingId, offer.pairingId)
        XCTAssertEqual(payload?.pairingNonce, offer.nonce)
        XCTAssertEqual(payload?.displayCode, offer.displayCode)
        XCTAssertEqual(payload?.desktopPublicKey, offer.desktopPublicKeyBase64)
        XCTAssertEqual(payload?.requestedScopes, ["approval_forwarding", "pairing_status"])
        XCTAssertEqual(offer.displayCode.count, 6)
        XCTAssertTrue(payload?.manualCode.hasPrefix("ABG-PAIR-\(offer.pairingId)-\(offer.displayCode)-") == true)
    }

    func testOfferLifetimeIsCappedAtFiveMinutes() {
        var engine = PairingEngine()
        let now = Date()
        let offer = engine.createOffer(lifetime: 3600, now: now)
        XCTAssertEqual(offer.expiresAt.timeIntervalSince(now), PairingEngine.maxOfferLifetime, accuracy: 1)
    }

    func testClaimThenConfirmCreatesAnActiveGrant() throws {
        var engine = PairingEngine()
        let offer = engine.createOffer()
        let claim = try engine.applyClaim(
            pairingId: offer.pairingId,
            nonce: offer.nonce,
            devicePublicKeyBase64: devicePublicKey(),
            deviceLabel: "iPhone of Tester",
            requestedScopes: [.approvalForwarding]
        )
        XCTAssertEqual(claim.requestedScopes, [.approvalForwarding])

        let (grant, sessionToken, _) = try engine.confirm(pairingId: offer.pairingId)
        XCTAssertEqual(grant.deviceId, claim.deviceId)
        XCTAssertEqual(sessionToken.count, 64)
        XCTAssertTrue(engine.verifySession(deviceId: grant.deviceId, sessionToken: sessionToken))
        XCTAssertFalse(engine.verifySession(deviceId: grant.deviceId, sessionToken: sessionToken + "0"))
        XCTAssertTrue(grant.isActive)
        XCTAssertEqual(grant.scopes, [.approvalForwarding])
        XCTAssertNil(engine.activeOffer)
        XCTAssertFalse(engine.listenerShouldRun())
    }

    func testNonceMismatchIsRejected() {
        var engine = PairingEngine()
        let offer = engine.createOffer()
        XCTAssertThrowsError(try engine.applyClaim(
            pairingId: offer.pairingId,
            nonce: String(offer.nonce.dropLast()) + "0",
            devicePublicKeyBase64: devicePublicKey(),
            deviceLabel: "attacker",
            requestedScopes: [.approvalForwarding]
        )) { error in
            XCTAssertEqual((error as? PairingError)?.reason, .nonceMismatch)
        }
    }

    func testSecondClaimIsRejectedAsDuplicate() throws {
        var engine = PairingEngine()
        let offer = engine.createOffer()
        _ = try engine.applyClaim(
            pairingId: offer.pairingId,
            nonce: offer.nonce,
            devicePublicKeyBase64: devicePublicKey(),
            deviceLabel: "first",
            requestedScopes: [.approvalForwarding]
        )
        XCTAssertThrowsError(try engine.applyClaim(
            pairingId: offer.pairingId,
            nonce: offer.nonce,
            devicePublicKeyBase64: devicePublicKey(),
            deviceLabel: "second",
            requestedScopes: [.approvalForwarding]
        )) { error in
            XCTAssertEqual((error as? PairingError)?.reason, .duplicateClaim)
        }
    }

    func testExpiredOfferRejectsClaimsAndStopsTheListener() {
        var engine = PairingEngine()
        let now = Date()
        let offer = engine.createOffer(now: now)
        let late = now.addingTimeInterval(PairingEngine.maxOfferLifetime + 1)
        XCTAssertThrowsError(try engine.applyClaim(
            pairingId: offer.pairingId,
            nonce: offer.nonce,
            devicePublicKeyBase64: devicePublicKey(),
            deviceLabel: "late",
            requestedScopes: [.approvalForwarding],
            now: late
        )) { error in
            XCTAssertEqual((error as? PairingError)?.reason, .expiredOffer)
        }
        XCTAssertNil(engine.activeOffer)
        XCTAssertFalse(engine.listenerShouldRun(now: late))
    }

    func testScopeEscalationIsRejected() {
        var engine = PairingEngine()
        let offer = engine.createOffer(scopes: [.pairingStatus])
        XCTAssertThrowsError(try engine.applyClaim(
            pairingId: offer.pairingId,
            nonce: offer.nonce,
            devicePublicKeyBase64: devicePublicKey(),
            deviceLabel: "greedy",
            requestedScopes: [.approvalForwarding]
        )) { error in
            XCTAssertEqual((error as? PairingError)?.reason, .scopeNotAllowed)
        }
    }

    func testInvalidDeviceKeyIsRejected() {
        var engine = PairingEngine()
        let offer = engine.createOffer()
        XCTAssertThrowsError(try engine.applyClaim(
            pairingId: offer.pairingId,
            nonce: offer.nonce,
            devicePublicKeyBase64: "not-a-key",
            deviceLabel: "bad",
            requestedScopes: [.approvalForwarding]
        )) { error in
            XCTAssertEqual((error as? PairingError)?.reason, .deviceKeyInvalid)
        }
    }

    func testConfirmWithoutClaimFails() {
        var engine = PairingEngine()
        let offer = engine.createOffer()
        XCTAssertThrowsError(try engine.confirm(pairingId: offer.pairingId)) { error in
            XCTAssertEqual((error as? PairingError)?.reason, .notClaimed)
        }
    }

    func testRejectClearsTheOffer() throws {
        var engine = PairingEngine()
        let offer = engine.createOffer()
        try engine.reject(pairingId: offer.pairingId)
        XCTAssertNil(engine.activeOffer)
        XCTAssertFalse(engine.listenerShouldRun())
    }

    func testRevocationDeactivatesTheGrantOnce() throws {
        var engine = PairingEngine()
        let offer = engine.createOffer()
        _ = try engine.applyClaim(
            pairingId: offer.pairingId,
            nonce: offer.nonce,
            devicePublicKeyBase64: devicePublicKey(),
            deviceLabel: "phone",
            requestedScopes: [.approvalForwarding]
        )
        let (grant, sessionToken, _) = try engine.confirm(pairingId: offer.pairingId)

        let revoked = engine.revoke(deviceId: grant.deviceId, by: "cli")
        XCTAssertFalse(engine.verifySession(deviceId: grant.deviceId, sessionToken: sessionToken))
        XCTAssertEqual(revoked?.revokedBy, "cli")
        XCTAssertNil(engine.activeGrant(deviceId: grant.deviceId))
        XCTAssertNil(engine.revoke(deviceId: grant.deviceId, by: "cli"))
    }

    func testGrantPersistenceRoundTripsWithoutSecrets() throws {
        var engine = PairingEngine()
        let offer = engine.createOffer()
        _ = try engine.applyClaim(
            pairingId: offer.pairingId,
            nonce: offer.nonce,
            devicePublicKeyBase64: devicePublicKey(),
            deviceLabel: "phone",
            requestedScopes: [.approvalForwarding, .pairingStatus]
        )
        _ = try engine.confirm(pairingId: offer.pairingId)

        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("abg-grants-test-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: url) }
        try CompanionGrantStore.save(engine.grants, to: url)

        let raw = try String(contentsOf: url, encoding: .utf8)
        XCTAssertFalse(raw.contains(offer.nonce), "the pairing nonce must never be persisted")

        let reloaded = CompanionGrantStore.load(from: url)
        XCTAssertEqual(reloaded.count, 1)
        XCTAssertEqual(reloaded.first?.deviceLabel, "phone")
        XCTAssertEqual(reloaded.first?.scopes, [.approvalForwarding, .pairingStatus])
    }

    func testPairingAuditHashIsStableAndRedacted() {
        let hash = PairingAudit.hashed("device-1234")
        XCTAssertEqual(hash, PairingAudit.hashed("device-1234"))
        XCTAssertNotEqual(hash, PairingAudit.hashed("device-1235"))
        XCTAssertEqual(hash.count, 16)
        XCTAssertFalse(hash.contains("device"))
    }

    func testPrivateAddressClassification() {
        XCTAssertTrue(PairingManager.isTailnetAddress("100.64.0.5"))
        XCTAssertTrue(PairingManager.isTailnetAddress("100.127.255.1"))
        XCTAssertFalse(PairingManager.isTailnetAddress("100.128.0.1"))
        XCTAssertTrue(PairingManager.isPrivateLANAddress("192.168.1.20"))
        XCTAssertTrue(PairingManager.isPrivateLANAddress("10.0.0.9"))
        XCTAssertTrue(PairingManager.isPrivateLANAddress("172.16.5.5"))
        XCTAssertFalse(PairingManager.isPrivateLANAddress("172.32.0.1"))
        XCTAssertFalse(PairingManager.isPrivateLANAddress("8.8.8.8"))
    }

    func testStatusFollowsThePairingLifecycle() throws {
        var engine = PairingEngine()
        let offer = engine.createOffer()
        XCTAssertEqual(engine.status(pairingId: offer.pairingId), .offerActive)
        XCTAssertEqual(engine.status(pairingId: "nope"), .unknown)

        _ = try engine.applyClaim(
            pairingId: offer.pairingId,
            nonce: offer.nonce,
            devicePublicKeyBase64: devicePublicKey(),
            deviceLabel: "phone",
            requestedScopes: [.approvalForwarding]
        )
        XCTAssertEqual(engine.status(pairingId: offer.pairingId), .claimed)

        let (grant, _, _) = try engine.confirm(pairingId: offer.pairingId)
        XCTAssertEqual(engine.status(pairingId: offer.pairingId), .paired(deviceId: grant.deviceId))

        engine.revoke(deviceId: grant.deviceId, by: "cli")
        XCTAssertEqual(engine.status(pairingId: offer.pairingId), .revoked)
    }

    func testSessionTokenSealRoundTrip() throws {
        let deviceKey = Curve25519.KeyAgreement.PrivateKey()
        let devicePublic = deviceKey.publicKey.rawRepresentation.base64EncodedString()
        let sealed = try PairingCrypto.seal("session-token-123", toDevicePublicKeyBase64: devicePublic)
        XCTAssertFalse(sealed.ciphertext.contains("session-token"))
        let opened = try PairingCrypto.open(sealed, devicePrivateKey: deviceKey)
        XCTAssertEqual(opened, "session-token-123")

        let wrongKey = Curve25519.KeyAgreement.PrivateKey()
        XCTAssertThrowsError(try PairingCrypto.open(sealed, devicePrivateKey: wrongKey))
    }
}
