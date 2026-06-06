import Foundation
import NIOCore
import NIOPosix
import GatewayCore

final class UDSServer: @unchecked Sendable {
    private var channel: Channel?
    private let group = MultiThreadedEventLoopGroup(numberOfThreads: 1)

    func start(runtime: any GatewayRuntime) async throws {
        let path = ABGConstants.udsPath
        try? FileManager.default.removeItem(atPath: path)

        // Hold the runtime weakly inside the long-lived bootstrap closure so the transport
        // does not pin a platform shell implementation.
        let weakRuntime = WeakGatewayRuntime(runtime)

        let bootstrap = ServerBootstrap(group: group)
            .serverChannelOption(ChannelOptions.backlog, value: 16)
            .childChannelInitializer { channel in
                let handler = LineDelimitedJSONHandler { requestData in
                    guard let runtime = weakRuntime.value else { return Data() }
                    let decoder = JSONDecoder()
                    let encoder = JSONEncoder()
                    do {
                        let req = try decoder.decode(CLIRequest.self, from: requestData)
                        let resp = await runtime.handleCLIRequest(req)
                        return try encoder.encode(resp)
                    } catch {
                        let resp = CLIResponse(id: "?", error: ErrorPayload(code: "decode_failed", message: "\(error)"))
                        return (try? encoder.encode(resp)) ?? Data()
                    }
                }
                return channel.pipeline.addHandler(handler)
            }

        let channel = try await bootstrap.bind(unixDomainSocketPath: path).get()
        self.channel = channel
        chmod(path, 0o700)
    }
}

private final class WeakGatewayRuntime: @unchecked Sendable {
    weak var value: (any GatewayRuntime)?
    init(_ value: (any GatewayRuntime)?) { self.value = value }
}

final class LineDelimitedJSONHandler: ChannelInboundHandler, @unchecked Sendable {
    typealias InboundIn = ByteBuffer
    typealias OutboundOut = ByteBuffer

    private let handler: @Sendable (Data) async -> Data
    private var buffer = Data()

    init(handler: @escaping @Sendable (Data) async -> Data) {
        self.handler = handler
    }

    func channelRead(context: ChannelHandlerContext, data: NIOAny) {
        var byteBuffer = self.unwrapInboundIn(data)
        let bytes = byteBuffer.readBytes(length: byteBuffer.readableBytes) ?? []
        buffer.append(contentsOf: bytes)

        while let nl = buffer.firstIndex(of: 0x0A) {
            let line = buffer.subdata(in: 0..<nl)
            buffer.removeSubrange(0...nl)
            let channel = context.channel
            let h = self.handler
            Task {
                let respData = await h(line)
                var out = respData
                out.append(0x0A)
                var bb = channel.allocator.buffer(capacity: out.count)
                bb.writeBytes(out)
                do { try await channel.writeAndFlush(bb) } catch {}
            }
        }
    }

    func errorCaught(context: ChannelHandlerContext, error: Error) {
        context.close(promise: nil)
    }
}
