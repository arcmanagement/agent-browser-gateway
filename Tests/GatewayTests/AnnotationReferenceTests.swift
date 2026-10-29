import XCTest
@testable import GatewayCore

final class AnnotationReferenceTests: XCTestCase {
    func testTabTokensStayTabTokens() throws {
        for token in [nil, "t1", "414636456"] { XCTAssertNil(try AnnotationReference.uid(from: token)) }
    }
    func testStablePrefixedReferences() throws {
        XCTAssertEqual(try AnnotationReference.uid(from: "abg-annotation:a6cf36f6-572b-4a32-b94a-e4a0c19356f0"), "a6cf36f6-572b-4a32-b94a-e4a0c19356f0")
        for suffix in ["", "a b", "x/y", String(repeating: "x", count: 129)] {
            XCTAssertThrowsError(try AnnotationReference.uid(from: "abg-annotation:" + suffix))
        }
    }
}
