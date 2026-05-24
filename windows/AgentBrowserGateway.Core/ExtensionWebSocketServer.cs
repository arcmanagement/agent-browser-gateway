using System.Buffers.Binary;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;

namespace AgentBrowserGateway.Core;

public sealed class ExtensionWebSocketServer
{
    private const int MaxFrameBytes = 256 * 1024 * 1024;
    private readonly GatewayHost _host;
    private TcpListener? _listener;

    public ExtensionWebSocketServer(GatewayHost host)
    {
        _host = host;
    }

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        Start();

        while (!cancellationToken.IsCancellationRequested)
        {
            var listener = _listener ?? throw new InvalidOperationException("WebSocket listener is not running.");
            var client = await listener.AcceptTcpClientAsync(cancellationToken).ConfigureAwait(false);
            _ = Task.Run(() => HandleClientAsync(client, cancellationToken), CancellationToken.None);
        }
    }

    public void Start()
    {
        if (_listener is not null) return;
        _listener = new TcpListener(IPAddress.Loopback, AbgPaths.WsPort);
        _listener.Start();
    }

    public void Stop()
    {
        _listener?.Stop();
        _listener = null;
    }

    private async Task HandleClientAsync(TcpClient client, CancellationToken serverToken)
    {
        using var _ = client;
        var stream = client.GetStream();
        BrowserConnection? connection = null;
        try
        {
            var headers = await ReadHttpHeadersAsync(stream, serverToken).ConfigureAwait(false);
            if (!TryValidateHandshake(headers, out var websocketKey))
            {
                await WriteHttpErrorAsync(stream, "403 Forbidden", serverToken).ConfigureAwait(false);
                return;
            }

            await WriteHandshakeResponseAsync(stream, websocketKey, serverToken).ConfigureAwait(false);
            connection = new BrowserConnection(client, stream);

            while (!serverToken.IsCancellationRequested)
            {
                var message = await connection.ReadTextMessageAsync(serverToken).ConfigureAwait(false);
                if (message is null) break;
                await _host.HandleExtensionTextAsync(connection, message, serverToken).ConfigureAwait(false);
            }
        }
        catch
        {
            // Browser reconnect is cheap and expected when the service worker sleeps.
        }
        finally
        {
            if (connection is not null)
            {
                await _host.HandleExtensionDisconnectedAsync(connection, CancellationToken.None).ConfigureAwait(false);
            }
        }
    }

    private static async Task<Dictionary<string, string>> ReadHttpHeadersAsync(NetworkStream stream, CancellationToken cancellationToken)
    {
        var buffer = new byte[16 * 1024];
        var total = 0;
        while (total < buffer.Length)
        {
            var read = await stream.ReadAsync(buffer.AsMemory(total, buffer.Length - total), cancellationToken).ConfigureAwait(false);
            if (read == 0) break;
            total += read;
            var text = Encoding.ASCII.GetString(buffer, 0, total);
            if (text.Contains("\r\n\r\n", StringComparison.Ordinal))
            {
                return ParseHeaders(text);
            }
        }
        throw new IOException("WebSocket handshake headers were incomplete.");
    }

    private static Dictionary<string, string> ParseHeaders(string text)
    {
        var lines = text.Split("\r\n", StringSplitOptions.None);
        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["__request"] = lines.FirstOrDefault() ?? ""
        };
        foreach (var line in lines.Skip(1))
        {
            if (string.IsNullOrEmpty(line)) break;
            var idx = line.IndexOf(':');
            if (idx <= 0) continue;
            headers[line[..idx].Trim()] = line[(idx + 1)..].Trim();
        }
        return headers;
    }

    private static bool TryValidateHandshake(Dictionary<string, string> headers, out string websocketKey)
    {
        websocketKey = "";
        if (!headers.TryGetValue("__request", out var request) ||
            !request.StartsWith("GET /ws ", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        if (!headers.TryGetValue("Upgrade", out var upgrade) ||
            !upgrade.Equals("websocket", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        if (!headers.TryGetValue("Sec-WebSocket-Key", out var key) ||
            string.IsNullOrWhiteSpace(key))
        {
            return false;
        }
        websocketKey = key;

        if (!headers.TryGetValue("Origin", out var origin) || !IsAllowedWebSocketOrigin(origin))
        {
            return false;
        }

        return true;
    }

    public static bool IsAllowedWebSocketOrigin(string? origin)
    {
        if (string.IsNullOrWhiteSpace(origin)) return false;
        if (!Uri.TryCreate(origin.Trim(), UriKind.Absolute, out var uri)) return false;
        if (!string.IsNullOrEmpty(uri.UserInfo) || !string.IsNullOrEmpty(uri.PathAndQuery) && uri.PathAndQuery != "/") return false;
        return uri.Scheme is "chrome-extension" or "moz-extension" or "safari-web-extension";
    }

    private static async Task WriteHandshakeResponseAsync(NetworkStream stream, string websocketKey, CancellationToken cancellationToken)
    {
        var acceptBytes = SHA1.HashData(Encoding.ASCII.GetBytes(websocketKey.Trim() + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"));
        var accept = Convert.ToBase64String(acceptBytes);
        var response =
            "HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            $"Sec-WebSocket-Accept: {accept}\r\n" +
            "\r\n";
        await stream.WriteAsync(Encoding.ASCII.GetBytes(response), cancellationToken).ConfigureAwait(false);
    }

    private static async Task WriteHttpErrorAsync(NetworkStream stream, string status, CancellationToken cancellationToken)
    {
        var response = $"HTTP/1.1 {status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n";
        await stream.WriteAsync(Encoding.ASCII.GetBytes(response), cancellationToken).ConfigureAwait(false);
    }

    public sealed class BrowserConnection
    {
        private readonly TcpClient _client;
        private readonly NetworkStream _stream;
        private readonly SemaphoreSlim _sendLock = new(1, 1);

        public BrowserConnection(TcpClient client, NetworkStream stream)
        {
            _client = client;
            _stream = stream;
        }

        public string? ExtensionId { get; set; }

        public async Task SendTextAsync(string text, CancellationToken cancellationToken)
        {
            var payload = Encoding.UTF8.GetBytes(text);
            await _sendLock.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                await WriteFrameAsync(_stream, opcode: 0x1, payload, cancellationToken).ConfigureAwait(false);
            }
            finally
            {
                _sendLock.Release();
            }
        }

        public async Task<string?> ReadTextMessageAsync(CancellationToken cancellationToken)
        {
            using var message = new MemoryStream();
            var readingText = false;
            while (true)
            {
                var frame = await ReadFrameAsync(_stream, cancellationToken).ConfigureAwait(false);
                switch (frame.Opcode)
                {
                    case 0x8:
                        return null;
                    case 0x9:
                        await WriteFrameAsync(_stream, 0xA, frame.Payload, cancellationToken).ConfigureAwait(false);
                        continue;
                    case 0x1:
                        readingText = true;
                        message.Write(frame.Payload);
                        break;
                    case 0x0 when readingText:
                        message.Write(frame.Payload);
                        break;
                    default:
                        continue;
                }

                if (frame.Fin)
                {
                    return Encoding.UTF8.GetString(message.ToArray());
                }
            }
        }

        public void Close()
        {
            try { _client.Close(); } catch { }
        }
    }

    private readonly record struct WebSocketFrame(bool Fin, int Opcode, byte[] Payload);

    private static async Task<WebSocketFrame> ReadFrameAsync(NetworkStream stream, CancellationToken cancellationToken)
    {
        var header = await ReadExactAsync(stream, 2, cancellationToken).ConfigureAwait(false);
        var fin = (header[0] & 0x80) != 0;
        var opcode = header[0] & 0x0F;
        var masked = (header[1] & 0x80) != 0;
        ulong length = (ulong)(header[1] & 0x7F);
        if (length == 126)
        {
            var ext = await ReadExactAsync(stream, 2, cancellationToken).ConfigureAwait(false);
            length = BinaryPrimitives.ReadUInt16BigEndian(ext);
        }
        else if (length == 127)
        {
            var ext = await ReadExactAsync(stream, 8, cancellationToken).ConfigureAwait(false);
            length = BinaryPrimitives.ReadUInt64BigEndian(ext);
        }

        if (length > MaxFrameBytes) throw new IOException("WebSocket frame too large.");

        var mask = masked ? await ReadExactAsync(stream, 4, cancellationToken).ConfigureAwait(false) : [];
        var payload = await ReadExactAsync(stream, checked((int)length), cancellationToken).ConfigureAwait(false);
        if (masked)
        {
            for (var i = 0; i < payload.Length; i++) payload[i] ^= mask[i % 4];
        }
        return new WebSocketFrame(fin, opcode, payload);
    }

    private static async Task WriteFrameAsync(NetworkStream stream, int opcode, byte[] payload, CancellationToken cancellationToken)
    {
        var header = new List<byte> { (byte)(0x80 | opcode) };
        if (payload.Length <= 125)
        {
            header.Add((byte)payload.Length);
        }
        else if (payload.Length <= ushort.MaxValue)
        {
            header.Add(126);
            var ext = new byte[2];
            BinaryPrimitives.WriteUInt16BigEndian(ext, (ushort)payload.Length);
            header.AddRange(ext);
        }
        else
        {
            header.Add(127);
            var ext = new byte[8];
            BinaryPrimitives.WriteUInt64BigEndian(ext, (ulong)payload.Length);
            header.AddRange(ext);
        }
        await stream.WriteAsync(header.ToArray(), cancellationToken).ConfigureAwait(false);
        await stream.WriteAsync(payload, cancellationToken).ConfigureAwait(false);
    }

    private static async Task<byte[]> ReadExactAsync(NetworkStream stream, int length, CancellationToken cancellationToken)
    {
        var buffer = new byte[length];
        var offset = 0;
        while (offset < length)
        {
            var read = await stream.ReadAsync(buffer.AsMemory(offset, length - offset), cancellationToken).ConfigureAwait(false);
            if (read == 0) throw new IOException("Unexpected end of stream.");
            offset += read;
        }
        return buffer;
    }
}
