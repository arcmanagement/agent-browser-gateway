using System.IO.Pipes;
using System.Text;
using System.Text.Json;

namespace AgentBrowserGateway.Core;

public sealed class CliPipeServer
{
    private readonly GatewayHost _host;

    public CliPipeServer(GatewayHost host)
    {
        _host = host;
    }

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            var pipe = new NamedPipeServerStream(
                AbgPaths.CliPipeName,
                PipeDirection.InOut,
                NamedPipeServerStream.MaxAllowedServerInstances,
                PipeTransmissionMode.Byte,
                PipeOptions.Asynchronous);

            await pipe.WaitForConnectionAsync(cancellationToken).ConfigureAwait(false);
            _ = Task.Run(() => HandleClientAsync(pipe, cancellationToken), CancellationToken.None);
        }
    }

    private async Task HandleClientAsync(NamedPipeServerStream pipe, CancellationToken cancellationToken)
    {
        await using var pipeResource = pipe;
        try
        {
            using var reader = new StreamReader(pipe, Encoding.UTF8, detectEncodingFromByteOrderMarks: false, leaveOpen: true);
            await using var writer = new StreamWriter(pipe, new UTF8Encoding(false), leaveOpen: true)
            {
                AutoFlush = true,
                NewLine = "\n"
            };

            var line = await reader.ReadLineAsync(cancellationToken).ConfigureAwait(false);
            if (string.IsNullOrWhiteSpace(line)) return;

            CliResponse response;
            try
            {
                var request = JsonSerializer.Deserialize<CliRequest>(line, JsonUtil.Options)
                              ?? new CliRequest { Id = "?", Method = "" };
                response = await _host.HandleCliRequestAsync(request, cancellationToken).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                response = new CliResponse
                {
                    Id = "?",
                    Error = new ErrorPayload("decode_failed", ex.Message)
                };
            }

            await writer.WriteAsync(JsonSerializer.Serialize(response, JsonUtil.Options)).ConfigureAwait(false);
            await writer.WriteAsync("\n").ConfigureAwait(false);
        }
        catch
        {
            // CLI clients are short-lived. Broken pipes are not actionable for the app UI.
        }
    }
}
