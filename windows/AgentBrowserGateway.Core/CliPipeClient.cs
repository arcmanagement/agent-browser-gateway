using System.IO.Pipes;
using System.Text;
using System.Text.Json;

namespace AgentBrowserGateway.Core;

public sealed class CliPipeClient
{
    public async Task<CliResponse> CallAsync(string method, object? parameters = null, int timeoutMs = 2500, CancellationToken cancellationToken = default)
    {
        var request = new CliRequest
        {
            Id = Guid.NewGuid().ToString("N"),
            Method = method,
            Params = parameters is null ? null : JsonUtil.ToElement(parameters)
        };

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(timeoutMs);

        try
        {
            await using var pipe = new NamedPipeClientStream(".", AbgPaths.CliPipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
            await pipe.ConnectAsync(timeout.Token).ConfigureAwait(false);
            await using var writer = new StreamWriter(pipe, new UTF8Encoding(false), leaveOpen: true)
            {
                AutoFlush = true,
                NewLine = "\n"
            };
            using var reader = new StreamReader(pipe, Encoding.UTF8, detectEncodingFromByteOrderMarks: false, leaveOpen: true);

            await writer.WriteLineAsync(JsonSerializer.Serialize(request, JsonUtil.Options)).ConfigureAwait(false);
            var line = await reader.ReadLineAsync(timeout.Token).ConfigureAwait(false);
            if (string.IsNullOrWhiteSpace(line))
            {
                return GatewayNotRunningResponse(request.Id, "Gateway returned an empty response.");
            }

            return JsonSerializer.Deserialize<CliResponse>(line, JsonUtil.Options)
                   ?? GatewayNotRunningResponse(request.Id, "Gateway returned an invalid response.");
        }
        catch (Exception ex) when (ex is TimeoutException or OperationCanceledException or IOException)
        {
            return GatewayNotRunningResponse(request.Id, ex.Message);
        }
    }

    private static CliResponse GatewayNotRunningResponse(string id, string message)
    {
        return new CliResponse
        {
            Id = id,
            Error = new ErrorPayload(
                "gateway_not_running",
                message,
                "Agent Browser Gateway for Windows is not running. Start agent-browser-gateway.exe, then retry.",
                "agent-browser-gateway.exe")
        };
    }
}
