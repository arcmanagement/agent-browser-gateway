using System.Collections.Concurrent;
using System.Text;
using System.Text.Json;

namespace AgentBrowserGateway.Core;

public sealed class GatewayHost
{
    private readonly object _gate = new();
    private readonly AuditLog _auditLog;
    private readonly MarkdownTransformer _markdownTransformer = new();
    private readonly Dictionary<string, ExtensionWebSocketServer.BrowserConnection> _connections = new(StringComparer.Ordinal);
    private readonly Dictionary<string, ExtensionInfo> _extensions = new(StringComparer.Ordinal);
    private readonly List<PermittedTab> _permittedTabs = [];
    private readonly ConcurrentDictionary<string, TaskCompletionSource<JsonElement?>> _inflight = new();
    private CancellationTokenSource? _cts;
    private ExtensionWebSocketServer? _webSocketServer;
    private CliPipeServer? _pipeServer;

    public GatewayHost(AuditLog? auditLog = null)
    {
        _auditLog = auditLog ?? new AuditLog();
    }

    public event EventHandler? StateChanged;

    public bool Running { get; private set; }

    public Task StartAsync(CancellationToken cancellationToken = default)
    {
        if (Running) return Task.CompletedTask;
        _cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        _webSocketServer = new ExtensionWebSocketServer(this);
        _pipeServer = new CliPipeServer(this);
        _webSocketServer.Start();
        Running = true;
        _ = Task.Run(() => _webSocketServer.StartAsync(_cts.Token), CancellationToken.None);
        _ = Task.Run(() => _pipeServer.StartAsync(_cts.Token), CancellationToken.None);
        OnStateChanged();
        return Task.CompletedTask;
    }

    public void Stop()
    {
        _cts?.Cancel();
        _webSocketServer?.Stop();
        lock (_gate)
        {
            foreach (var connection in _connections.Values) connection.Close();
            _connections.Clear();
            _extensions.Clear();
            _permittedTabs.Clear();
        }
        Running = false;
        OnStateChanged();
    }

    public GatewaySnapshot Snapshot()
    {
        lock (_gate)
        {
            return new GatewaySnapshot(
                Running,
                _extensions.Values.OrderBy(x => x.ExtensionId, StringComparer.Ordinal).ToList(),
                TabSummariesLocked());
        }
    }

    public async Task HandleExtensionTextAsync(
        ExtensionWebSocketServer.BrowserConnection connection,
        string text,
        CancellationToken cancellationToken)
    {
        using var document = JsonDocument.Parse(text);
        var root = document.RootElement;
        var type = root.GetString("type");
        if (string.IsNullOrEmpty(type)) return;

        switch (type)
        {
            case "hello":
            {
                var extensionId = root.GetString("extensionId") ?? connection.ExtensionId ?? Guid.NewGuid().ToString("N");
                var version = root.GetString("version");
                var profile = root.GetString("profileLabel");
                var browser = root.GetString("browserKind");
                connection.ExtensionId = extensionId;
                lock (_gate)
                {
                    _connections[extensionId] = connection;
                    _extensions[extensionId] = new ExtensionInfo(extensionId, profile, browser, version);
                }
                await _auditLog.LogAsync("extension_connected", extensionId, cancellationToken: cancellationToken).ConfigureAwait(false);
                OnStateChanged();
                break;
            }
            case "tab_permitted":
            {
                if (connection.ExtensionId is null) return;
                var tabId = root.GetInt("tabId");
                if (tabId is null) return;
                var url = root.GetString("url") ?? "";
                var title = root.GetString("title") ?? "";
                var origin = root.GetString("origin") ?? "";
                var accessMode = root.GetString("accessMode") ?? "manual";
                DateTimeOffset? expiresAt = null;
                var expires = root.GetString("expiresAt");
                if (!string.IsNullOrWhiteSpace(expires) && DateTimeOffset.TryParse(expires, out var parsed))
                {
                    expiresAt = parsed;
                }
                lock (_gate)
                {
                    _permittedTabs.RemoveAll(tab => tab.ExtensionId == connection.ExtensionId && tab.TabId == tabId.Value);
                    _permittedTabs.Add(new PermittedTab(connection.ExtensionId, tabId.Value, url, title, origin, DateTimeOffset.UtcNow, expiresAt, accessMode));
                }
                await _auditLog.LogAsync(
                    "permit",
                    connection.ExtensionId,
                    tabId,
                    url,
                    details: new Dictionary<string, object?> { ["accessMode"] = accessMode },
                    cancellationToken: cancellationToken).ConfigureAwait(false);
                OnStateChanged();
                break;
            }
            case "tab_revoked":
            {
                if (connection.ExtensionId is null) return;
                var tabId = root.GetInt("tabId");
                if (tabId is null) return;
                var reason = root.GetString("reason") ?? "unknown";
                string? url = null;
                lock (_gate)
                {
                    var tab = _permittedTabs.FirstOrDefault(t => t.ExtensionId == connection.ExtensionId && t.TabId == tabId.Value);
                    url = tab?.Url;
                    _permittedTabs.RemoveAll(t => t.ExtensionId == connection.ExtensionId && t.TabId == tabId.Value);
                }
                await _auditLog.LogAsync("revoke", connection.ExtensionId, tabId, url, details: new Dictionary<string, object?> { ["reason"] = reason }, cancellationToken: cancellationToken).ConfigureAwait(false);
                OnStateChanged();
                break;
            }
            case "tab_updated":
            {
                if (connection.ExtensionId is null) return;
                var tabId = root.GetInt("tabId");
                if (tabId is null) return;
                lock (_gate)
                {
                    var index = _permittedTabs.FindIndex(t => t.ExtensionId == connection.ExtensionId && t.TabId == tabId.Value);
                    if (index >= 0)
                    {
                        var current = _permittedTabs[index];
                        var accessMode = root.GetString("accessMode") ?? current.AccessMode;
                        _permittedTabs[index] = current with
                        {
                            Url = root.GetString("url") ?? current.Url,
                            Title = root.GetString("title") ?? current.Title,
                            Origin = root.GetString("origin") ?? current.Origin,
                            AccessMode = accessMode
                        };
                    }
                }
                OnStateChanged();
                break;
            }
            case "tab_closed":
            {
                if (connection.ExtensionId is null) return;
                var tabId = root.GetInt("tabId");
                if (tabId is null) return;
                string? url = null;
                lock (_gate)
                {
                    var tab = _permittedTabs.FirstOrDefault(t => t.ExtensionId == connection.ExtensionId && t.TabId == tabId.Value);
                    url = tab?.Url;
                    _permittedTabs.RemoveAll(t => t.ExtensionId == connection.ExtensionId && t.TabId == tabId.Value);
                }
                await _auditLog.LogAsync("tab_closed", connection.ExtensionId, tabId, url, cancellationToken: cancellationToken).ConfigureAwait(false);
                OnStateChanged();
                break;
            }
            case "response":
            {
                var id = root.GetString("id");
                if (string.IsNullOrWhiteSpace(id) || !_inflight.TryRemove(id, out var completion)) return;
                if (root.TryGetProperty("error", out var errorElement) && errorElement.ValueKind == JsonValueKind.Object)
                {
                    var code = errorElement.GetString("code") ?? "extension_error";
                    var message = errorElement.GetString("message") ?? code;
                    completion.TrySetException(new GatewayCommandException(code, message));
                }
                else if (root.TryGetProperty("result", out var result))
                {
                    completion.TrySetResult(result.Clone());
                }
                else
                {
                    completion.TrySetResult(null);
                }
                break;
            }
        }
    }

    public async Task HandleExtensionDisconnectedAsync(ExtensionWebSocketServer.BrowserConnection connection, CancellationToken cancellationToken)
    {
        var extensionId = connection.ExtensionId;
        if (string.IsNullOrWhiteSpace(extensionId)) return;
        lock (_gate)
        {
            if (_connections.TryGetValue(extensionId, out var current) && ReferenceEquals(current, connection))
            {
                _connections.Remove(extensionId);
                _extensions.Remove(extensionId);
                _permittedTabs.RemoveAll(tab => tab.ExtensionId == extensionId);
            }
        }
        await _auditLog.LogAsync("extension_disconnected", extensionId, cancellationToken: cancellationToken).ConfigureAwait(false);
        OnStateChanged();
    }

    public async Task<CliResponse> HandleCliRequestAsync(CliRequest request, CancellationToken cancellationToken)
    {
        try
        {
            return request.Method switch
            {
                "status" => Ok(request, StatusObject()),
                "list_tabs" => Ok(request, TabSummaries()),
                "inspect" => Ok(request, InspectObject()),
                "read_tab" => await HandleReadTabAsync(request, cancellationToken).ConfigureAwait(false),
                "screenshot_tab" => await DispatchAsync(request, "screenshot", cancellationToken).ConfigureAwait(false),
                "console_tab" => await DispatchAsync(request, "console", cancellationToken).ConfigureAwait(false),
                "table_tab" => await DispatchAsync(request, "table", cancellationToken).ConfigureAwait(false),
                "describe_tab" => await DispatchAsync(request, "describe", cancellationToken).ConfigureAwait(false),
                "network_tab" => await DispatchAsync(request, "network_log", cancellationToken).ConfigureAwait(false),
                "click_tab" => await HandleClickTabAsync(request, cancellationToken).ConfigureAwait(false),
                "fill_tab" => await DispatchAsync(request, "fill", cancellationToken).ConfigureAwait(false),
                "paste_tab" => await DispatchAsync(request, "paste", cancellationToken).ConfigureAwait(false),
                "clear_tab" => await DispatchAsync(request, "clear", cancellationToken).ConfigureAwait(false),
                "replace_tab" => await DispatchAsync(request, "replace_dom", cancellationToken).ConfigureAwait(false),
                "upload_tab" => await DispatchAsync(request, "upload_file", cancellationToken).ConfigureAwait(false),
                "type_tab" => await DispatchAsync(request, "type_text", cancellationToken).ConfigureAwait(false),
                "key_tab" => await DispatchAsync(request, "key_press", cancellationToken).ConfigureAwait(false),
                "navigate_tab" => await DispatchAsync(request, "navigate", cancellationToken).ConfigureAwait(false),
                "scroll_tab" => await DispatchAsync(request, "scroll", cancellationToken).ConfigureAwait(false),
                "drag_tab" => await DispatchAsync(request, "drag", cancellationToken).ConfigureAwait(false),
                "wait_tab" => await DispatchAsync(request, "wait_for", cancellationToken).ConfigureAwait(false),
                "eval_tab" => await HandleEvalTabAsync(request, cancellationToken).ConfigureAwait(false),
                "annotate_tab" => await DispatchAsync(request, "annotation_mode", cancellationToken).ConfigureAwait(false),
                "revoke_tab" => await HandleRevokeTabAsync(request, cancellationToken).ConfigureAwait(false),
                "audit" => await HandleAuditAsync(request, cancellationToken).ConfigureAwait(false),
                "plugins" => Ok(request, Array.Empty<object>()),
                "plugin_command_list" => Ok(request, Array.Empty<object>()),
                "plugin_command_run" => Error(request, "not_supported_on_windows_mvp", "Dynamic plugin commands are not supported by the Windows MVP."),
                _ => Error(request, "unknown_method", request.Method)
            };
        }
        catch (GatewayCommandException ex)
        {
            return Error(request, ex.Code, ex.Message);
        }
        catch (Exception ex)
        {
            return Error(request, "command_failed", ex.Message);
        }
    }

    private async Task<CliResponse> HandleClickTabAsync(CliRequest request, CancellationToken cancellationToken)
    {
        var parameters = JsonUtil.ToDictionary(request.Params);
        string method;
        if (parameters.ContainsKey("selector")) method = "click_selector";
        else if (parameters.ContainsKey("id")) method = "click_described";
        else if (parameters.ContainsKey("x") && parameters.ContainsKey("y")) method = "click_at";
        else return Error(request, "bad_params", "selector, id, or (x,y) required");
        return await DispatchAsync(request, method, cancellationToken).ConfigureAwait(false);
    }

    private async Task<CliResponse> HandleReadTabAsync(CliRequest request, CancellationToken cancellationToken)
    {
        var tabId = request.Params.GetInt("tabId");
        if (tabId is null) return Error(request, "bad_params", "tabId required");
        var tab = FindTab(tabId.Value);
        if (tab is null) return Error(request, TabUnavailableError(tabId.Value));

        var asMarkdown = request.Params.GetBool("asMarkdown") == true;
        var keepImages = request.Params.GetBool("keepImages") == true;
        var extensionParams = JsonUtil.RemoveKeys(request.Params, "asMarkdown", "keepImages");
        var result = await SendCommandAsync(tab.ExtensionId, "read_dom", extensionParams, cancellationToken).ConfigureAwait(false);
        await _auditLog.LogAsync("read_dom", tab.ExtensionId, tab.TabId, tab.Url, "cli", cancellationToken: cancellationToken).ConfigureAwait(false);

        if (!asMarkdown || result is null || result.Value.ValueKind != JsonValueKind.Object ||
            !result.Value.TryGetProperty("html", out var htmlElement) ||
            htmlElement.ValueKind != JsonValueKind.String)
        {
            return Ok(request, result);
        }

        var dict = JsonUtil.ToDictionary(result.Value);
        var html = htmlElement.GetString() ?? "";
        var url = dict.TryGetValue("url", out var resultUrl) ? resultUrl?.ToString() ?? tab.Url : tab.Url;
        var transform = _markdownTransformer.TransformForUrl(url, html, keepImages);
        dict.Remove("html");
        dict["markdown"] = transform.Markdown;
        dict["markdownTransform"] = transform.Name;
        return Ok(request, dict);
    }

    private async Task<CliResponse> DispatchAsync(CliRequest request, string method, CancellationToken cancellationToken)
    {
        var tabId = request.Params.GetInt("tabId");
        if (tabId is null) return Error(request, "bad_params", "tabId required");
        var tab = FindTab(tabId.Value);
        if (tab is null) return Error(request, TabUnavailableError(tabId.Value));

        var result = await SendCommandAsync(tab.ExtensionId, method, request.Params, cancellationToken).ConfigureAwait(false);
        Dictionary<string, object?>? details = null;
        if (method is "paste" or "clear")
        {
            details = [];
            var selector = request.Params.GetString("selector");
            if (!string.IsNullOrEmpty(selector)) details["selector"] = selector;
            var value = request.Params.GetString("value");
            if (method == "paste" && value is not null) details["textBytes"] = System.Text.Encoding.UTF8.GetByteCount(value);
        }
        await _auditLog.LogAsync(method, tab.ExtensionId, tab.TabId, tab.Url, "cli", details, cancellationToken).ConfigureAwait(false);
        return Ok(request, result);
    }

    private async Task<CliResponse> HandleEvalTabAsync(CliRequest request, CancellationToken cancellationToken)
    {
        var tabId = request.Params.GetInt("tabId");
        var script = request.Params.GetString("script");
        if (tabId is null || script is null) return Error(request, "bad_params", "tabId and script required");
        var tab = FindTab(tabId.Value);
        if (tab is null) return Error(request, TabUnavailableError(tabId.Value));

        var details = new Dictionary<string, object?>
        {
            ["script"] = script,
            ["scriptBytes"] = Encoding.UTF8.GetByteCount(script),
            ["approvalRequested"] = request.Params.GetBool("approve") ?? false,
            ["tabTitle"] = tab.Title
        };
        if (request.Params.GetInt("maxBytes") is int maxBytes) details["maxBytes"] = maxBytes;

        try
        {
            var result = await SendCommandAsync(tab.ExtensionId, "eval_script", request.Params, cancellationToken).ConfigureAwait(false);
            details["ok"] = true;
            if (result is { ValueKind: JsonValueKind.Object })
            {
                if (result.Value.TryGetProperty("ok", out var ok)) details["ok"] = JsonUtil.ToObject(ok);
                if (result.Value.TryGetProperty("resultSummary", out var summary)) details["resultSummary"] = JsonUtil.ToObject(summary);
                if (result.Value.TryGetProperty("approval", out var approval))
                {
                    details["approval"] = JsonUtil.ToObject(approval);
                    if (approval.ValueKind == JsonValueKind.Object)
                    {
                        if (approval.TryGetProperty("mode", out var mode)) details["approvalMode"] = JsonUtil.ToObject(mode);
                        if (approval.TryGetProperty("approver", out var approver)) details["approver"] = JsonUtil.ToObject(approver);
                    }
                }
                if (result.Value.TryGetProperty("error", out var error)) details["error"] = JsonUtil.ToObject(error);
            }
            await _auditLog.LogAsync("eval_script", tab.ExtensionId, tab.TabId, tab.Url, "cli", details, cancellationToken).ConfigureAwait(false);
            return Ok(request, result);
        }
        catch (GatewayCommandException ex)
        {
            details["ok"] = false;
            details["error"] = ex.Message;
            await _auditLog.LogAsync("eval_script", tab.ExtensionId, tab.TabId, tab.Url, "cli", details, cancellationToken).ConfigureAwait(false);
            return Error(request, ex.Code, ex.Message);
        }
        catch (Exception ex)
        {
            details["ok"] = false;
            details["error"] = ex.Message;
            await _auditLog.LogAsync("eval_script", tab.ExtensionId, tab.TabId, tab.Url, "cli", details, cancellationToken).ConfigureAwait(false);
            return Error(request, "command_failed", ex.Message);
        }
    }

    private async Task<CliResponse> HandleRevokeTabAsync(CliRequest request, CancellationToken cancellationToken)
    {
        var tabId = request.Params.GetInt("tabId");
        if (tabId is null) return Error(request, "bad_params", "tabId required");
        List<string> extensionIds;
        lock (_gate)
        {
            extensionIds = _connections.Keys.ToList();
            _permittedTabs.RemoveAll(tab => tab.TabId == tabId.Value);
        }
        foreach (var extensionId in extensionIds)
        {
            try
            {
                await SendCommandAsync(extensionId, "revoke", JsonUtil.ToElement(new Dictionary<string, object?> { ["tabId"] = tabId.Value }), cancellationToken).ConfigureAwait(false);
            }
            catch
            {
                // The owning extension will revoke; non-owning extensions may ignore/fail.
            }
        }
        await _auditLog.LogAsync("revoke_via_cli", tabId: tabId, cancellationToken: cancellationToken).ConfigureAwait(false);
        OnStateChanged();
        return Ok(request, new Dictionary<string, object?> { ["ok"] = true });
    }

    private async Task<CliResponse> HandleAuditAsync(CliRequest request, CancellationToken cancellationToken)
    {
        var lines = request.Params.GetInt("lines") ?? 50;
        var entries = await _auditLog.TailAsync(lines, cancellationToken).ConfigureAwait(false);
        return Ok(request, entries);
    }

    private async Task<JsonElement?> SendCommandAsync(string extensionId, string method, JsonElement? parameters, CancellationToken cancellationToken)
    {
        ExtensionWebSocketServer.BrowserConnection? connection;
        lock (_gate)
        {
            _connections.TryGetValue(extensionId, out connection);
        }
        if (connection is null)
        {
            throw new GatewayCommandException("extension_not_connected", $"extension {extensionId} not connected");
        }

        var id = Guid.NewGuid().ToString("N");
        var completion = new TaskCompletionSource<JsonElement?>(TaskCreationOptions.RunContinuationsAsynchronously);
        _inflight[id] = completion;
        var command = new GatewayCommand(id, method, parameters);
        var text = JsonSerializer.Serialize(command, JsonUtil.Options);

        try
        {
            await connection.SendTextAsync(text, cancellationToken).ConfigureAwait(false);
            var finished = await Task.WhenAny(completion.Task, Task.Delay(TimeSpan.FromSeconds(30), cancellationToken)).ConfigureAwait(false);
            if (finished != completion.Task)
            {
                _inflight.TryRemove(id, out _);
                throw new GatewayCommandException("command_timeout", "command timeout");
            }
            return await completion.Task.ConfigureAwait(false);
        }
        catch
        {
            _inflight.TryRemove(id, out _);
            throw;
        }
    }

    private PermittedTab? FindTab(int tabId)
    {
        lock (_gate)
        {
            _permittedTabs.RemoveAll(tab => tab.IsExpired);
            return _permittedTabs.FirstOrDefault(tab => tab.TabId == tabId);
        }
    }

    private object StatusObject()
    {
        lock (_gate)
        {
            var extensions = _extensions.Values.OrderBy(x => x.ExtensionId, StringComparer.Ordinal).ToList();
            return new Dictionary<string, object?>
            {
                ["running"] = true,
                ["version"] = AbgPaths.Version,
                ["wsHost"] = AbgPaths.WsHost,
                ["wsPort"] = AbgPaths.WsPort,
                ["processId"] = Environment.ProcessId,
                ["processPath"] = Environment.ProcessPath,
                ["extensions"] = extensions,
                ["extensionCount"] = extensions.Count,
                ["permittedTabCount"] = _permittedTabs.Count
            };
        }
    }

    private object InspectObject()
    {
        lock (_gate)
        {
            var extensions = _extensions.Values.OrderBy(x => x.ExtensionId, StringComparer.Ordinal).ToList();
            var tabs = TabSummariesLocked();
            return new Dictionary<string, object?>
            {
                ["running"] = true,
                ["version"] = AbgPaths.Version,
                ["wsHost"] = AbgPaths.WsHost,
                ["wsPort"] = AbgPaths.WsPort,
                ["processId"] = Environment.ProcessId,
                ["processPath"] = Environment.ProcessPath,
                ["extensions"] = extensions,
                ["extensionCount"] = extensions.Count,
                ["permittedTabCount"] = tabs.Count,
                ["tabs"] = tabs
            };
        }
    }

    private IReadOnlyList<Dictionary<string, object?>> TabSummaries()
    {
        lock (_gate)
        {
            return TabSummariesLocked();
        }
    }

    private List<Dictionary<string, object?>> TabSummariesLocked()
    {
        _permittedTabs.RemoveAll(tab => tab.IsExpired);
        return _permittedTabs
            .Select((tab, index) =>
            {
                _extensions.TryGetValue(tab.ExtensionId, out var extension);
                var dict = new Dictionary<string, object?>
                {
                    ["ref"] = $"t{index + 1}",
                    ["extensionId"] = tab.ExtensionId,
                    ["tabId"] = tab.TabId,
                    ["url"] = tab.Url,
                    ["title"] = tab.Title,
                    ["origin"] = tab.Origin,
                    ["permittedAt"] = tab.PermittedAt.ToString("O"),
                    ["accessMode"] = tab.AccessMode
                };
                if (tab.ExpiresAt is not null) dict["expiresAt"] = tab.ExpiresAt.Value.ToString("O");
                if (!string.IsNullOrWhiteSpace(extension?.Profile)) dict["profile"] = extension.Profile;
                if (!string.IsNullOrWhiteSpace(extension?.Browser)) dict["browser"] = extension.Browser;
                return dict;
            })
            .ToList();
    }

    private ErrorPayload TabUnavailableError(int tabId)
    {
        lock (_gate)
        {
            if (_connections.Count == 0)
            {
                return new ErrorPayload(
                    "extension_not_connected",
                    "No browser extension is connected to the Gateway.",
                    UserMessage: "Chrome extension is not connected. Check that the extension is installed and enabled.",
                    NextCommand: "abg status",
                    TabId: tabId);
            }
            if (_permittedTabs.Count == 0)
            {
                return new ErrorPayload(
                    "no_permitted_tabs",
                    "No tabs are currently shared with ABG.",
                    UserMessage: "No tab is shared. Open the target tab and share it from the ABG extension popup.",
                    NextCommand: "abg tabs --compact",
                    TabId: tabId);
            }
        }

        return new ErrorPayload(
            "tab_not_permitted",
            $"tabId {tabId} is not shared or has expired.",
            UserMessage: "This tab is not shared or the permission expired. Share the tab again and check abg tabs --compact.",
            NextCommand: "abg tabs --compact",
            TabId: tabId);
    }

    private static CliResponse Ok(CliRequest request, object? result)
    {
        return new CliResponse { Id = request.Id, Result = result };
    }

    private static CliResponse Error(CliRequest request, string code, string message)
    {
        return new CliResponse { Id = request.Id, Error = new ErrorPayload(code, message) };
    }

    private static CliResponse Error(CliRequest request, ErrorPayload error)
    {
        return new CliResponse { Id = request.Id, Error = error };
    }

    private void OnStateChanged()
    {
        StateChanged?.Invoke(this, EventArgs.Empty);
    }
}
