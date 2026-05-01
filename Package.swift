// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "AgentBrowserGateway",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "Gateway", targets: ["Gateway"]),
        .executable(name: "abg", targets: ["abg"]),
    ],
    dependencies: [
        .package(url: "https://github.com/vapor/vapor.git", from: "4.92.0"),
        .package(url: "https://github.com/apple/swift-nio.git", from: "2.65.0"),
        .package(url: "https://github.com/apple/swift-argument-parser.git", from: "1.3.0"),
    ],
    targets: [
        .target(
            name: "GatewayCore",
            path: "Sources/GatewayCore"
        ),
        .executableTarget(
            name: "Gateway",
            dependencies: [
                "GatewayCore",
                .product(name: "Vapor", package: "vapor"),
                .product(name: "NIOCore", package: "swift-nio"),
                .product(name: "NIOPosix", package: "swift-nio"),
            ],
            path: "Sources/Gateway"
        ),
        .executableTarget(
            name: "abg",
            dependencies: [
                "GatewayCore",
                .product(name: "ArgumentParser", package: "swift-argument-parser"),
            ],
            path: "Sources/abg"
        ),
    ]
)
