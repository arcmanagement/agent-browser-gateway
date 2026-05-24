using System.Text.Json;
using System.Text.Json.Serialization;

namespace AgentBrowserGateway.Core;

public sealed record PermittedTab(
    string ExtensionId,
    int TabId,
    string Url,
    string Title,
    string Origin,
    DateTimeOffset PermittedAt,
    DateTimeOffset? ExpiresAt = null)
{
    public bool IsExpired => ExpiresAt is not null && DateTimeOffset.UtcNow >= ExpiresAt.Value;
}

public sealed record ExtensionInfo(
    string ExtensionId,
    string? Profile,
    string? Browser,
    string? Version);

public sealed record ErrorPayload(
    string Code,
    string Message,
    string? UserMessage = null,
    string? NextCommand = null,
    string? Hint = null,
    int? TabId = null,
    string? Plugin = null,
    string? Command = null);

public sealed record CliRequest
{
    [JsonPropertyName("id")]
    public string Id { get; init; } = Guid.NewGuid().ToString("N");

    [JsonPropertyName("method")]
    public string Method { get; init; } = "";

    [JsonPropertyName("params")]
    public JsonElement? Params { get; init; }
}

public sealed record CliResponse
{
    [JsonPropertyName("id")]
    public string Id { get; init; } = "";

    [JsonPropertyName("result")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public object? Result { get; init; }

    [JsonPropertyName("error")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public ErrorPayload? Error { get; init; }
}

public sealed record GatewayCommand(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("method")] string Method,
    [property: JsonPropertyName("params")] object? Params = null);

public sealed record GatewaySnapshot(
    bool Running,
    IReadOnlyList<ExtensionInfo> Extensions,
    IReadOnlyList<Dictionary<string, object?>> Tabs);

public sealed class GatewayCommandException : Exception
{
    public string Code { get; }

    public GatewayCommandException(string code, string message) : base(message)
    {
        Code = code;
    }
}
