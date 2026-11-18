import XCTest
@testable import GatewayCore

final class AnnotationTextFormatTests: XCTestCase {
    func testLiveArrowShowsBothEndsAndTheirTargets() {
        let annotation: [String: Any] = [
            "kind": "arrow",
            "arrow": [
                "from": ["viewportPoint": ["x": 120.0, "y": 340.5], "selector": "h1",
                         "element": ["tag": "h1", "selector": "h1", "text": "Pricing\n  plans"]],
                "to": ["viewportPoint": ["x": 500, "y": 200], "annotationUid": "a1", "annotationDisplayNumber": 1],
            ],
        ]
        XCTAssertEqual(AnnotationTextFormat.arrowEndLines(annotation), [
            "    from (120, 340.5) selector=h1 text=\"Pricing plans\"",
            "    to (500, 200) -> [1]",
        ])
    }

    func testSavedArrowNamesTargetsWithTheCallerLabel() {
        let annotation: [String: Any] = [
            "kind": "arrow",
            "arrow": [
                "from": ["point": ["x": 10, "y": 20]],
                "to": ["point": ["x": 30, "y": 40], "annotationUid": "known"],
            ],
        ]
        XCTAssertEqual(AnnotationTextFormat.arrowEndLines(annotation, label: { $0 == "known" ? "saved [2]" : nil }), [
            "    from (10, 20)",
            "    to (30, 40) -> saved [2]",
        ])
        let unknown = AnnotationTextFormat.arrowEndLines(annotation)
        XCTAssertEqual(unknown.last, "    to (30, 40) -> annotation known")
    }

    func testOtherKindsAndLongTextStayCompact() {
        XCTAssertEqual(AnnotationTextFormat.arrowEndLines(["kind": "dom", "arrow": [:]]), [])
        let long = String(repeating: "x", count: 120)
        let lines = AnnotationTextFormat.arrowEndLines([
            "kind": "arrow",
            "arrow": ["from": ["element": ["text": long]], "to": [:]],
        ])
        XCTAssertEqual(lines.first, "    from text=\"\(String(repeating: "x", count: 79))…\"")
        XCTAssertEqual(lines.last, "    to")
    }
}
