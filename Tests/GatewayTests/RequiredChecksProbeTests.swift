import XCTest

final class RequiredChecksProbeTests: XCTestCase {
    func testDeliberateFailureForBranchProtectionProbe() {
        XCTFail("deliberate failure: branch-protection probe for issue #44")
    }
}
