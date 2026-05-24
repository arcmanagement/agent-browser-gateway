using System.Text.Json;

namespace AgentBrowserGateway.Core;

public sealed class AuditLog
{
    private readonly string _path;
    private readonly SemaphoreSlim _writeLock = new(1, 1);

    public AuditLog(string? path = null)
    {
        _path = path ?? AbgPaths.AuditLogPath;
        Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
        if (!File.Exists(_path)) File.WriteAllText(_path, "");
    }

    public async Task LogAsync(
        string action,
        string? extensionId = null,
        int? tabId = null,
        string? url = null,
        string? agent = null,
        Dictionary<string, object?>? details = null,
        CancellationToken cancellationToken = default)
    {
        var entry = new Entry(DateTimeOffset.UtcNow, extensionId, tabId, url, action, agent, details);
        var line = JsonUtil.SerializeLine(entry);
        await _writeLock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await File.AppendAllTextAsync(_path, line, cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _writeLock.Release();
        }
    }

    public async Task<IReadOnlyList<Entry>> TailAsync(int lines = 50, CancellationToken cancellationToken = default)
    {
        if (!File.Exists(_path)) return [];
        var raw = await File.ReadAllLinesAsync(_path, cancellationToken).ConfigureAwait(false);
        return raw
            .Where(line => !string.IsNullOrWhiteSpace(line))
            .TakeLast(Math.Max(1, lines))
            .Select(line =>
            {
                try { return JsonSerializer.Deserialize<Entry>(line, JsonUtil.Options); }
                catch { return null; }
            })
            .Where(entry => entry is not null)
            .Cast<Entry>()
            .ToList();
    }

    public sealed record Entry(
        DateTimeOffset Ts,
        string? ExtensionId,
        int? TabId,
        string? Url,
        string Action,
        string? Agent,
        Dictionary<string, object?>? Details);
}
