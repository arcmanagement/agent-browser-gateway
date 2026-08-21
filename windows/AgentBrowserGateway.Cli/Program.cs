using System.Text;
using System.Text.Json;
using AgentBrowserGateway.Core;

namespace AgentBrowserGateway.Cli;

internal static class Program
{
    private static readonly CliPipeClient Client = new();

    public static async Task<int> Main(string[] args)
    {
        try
        {
            return await RunAsync(args).ConfigureAwait(false);
        }
        catch (CliUsageException ex)
        {
            Console.Error.WriteLine(ex.Message);
            return 2;
        }
        catch (Exception ex)
        {
            PrintErrorJson("cli_failed", ex.Message);
            return 1;
        }
    }

    private static async Task<int> RunAsync(string[] args)
    {
        if (args.Length == 0 || args[0] is "--help" or "-h" or "help")
        {
            PrintHelp();
            return 0;
        }

        var command = args[0];
        var rest = args.Skip(1).ToArray();
        switch (command)
        {
            case "status":
                return await CallAndPrintAsync("status").ConfigureAwait(false);
            case "inspect":
                return await CallAndPrintAsync("inspect").ConfigureAwait(false);
            case "tabs":
                return await TabsAsync(rest).ConfigureAwait(false);
            case "read":
                return await ReadAsync(rest).ConfigureAwait(false);
            case "screenshot":
                return await ScreenshotAsync(rest).ConfigureAwait(false);
            case "console":
                return await TargetDispatchAsync(rest, "console_tab").ConfigureAwait(false);
            case "eval":
                return await EvalAsync(rest).ConfigureAwait(false);
            case "table":
                return await TargetDispatchAsync(rest, "table_tab", ["selector"]).ConfigureAwait(false);
            case "describe":
                return await TargetDispatchAsync(rest, "describe_tab", ["all", "kind", "grid", "limit"]).ConfigureAwait(false);
            case "network":
                return await TargetDispatchAsync(rest, "network_tab", ["url", "method", "status-min", "type", "request-id", "body", "limit"]).ConfigureAwait(false);
            case "click":
                return await TargetDispatchAsync(rest, "click_tab", ["selector", "id", "x", "y", "all", "grid", "limit"]).ConfigureAwait(false);
            case "fill":
                return await TargetDispatchAsync(rest, "fill_tab", ["selector", "value"]).ConfigureAwait(false);
            case "paste":
                return await TargetDispatchAsync(rest, "paste_tab", ["selector", "value", "stdin"]).ConfigureAwait(false);
            case "clear":
                return await TargetDispatchAsync(rest, "clear_tab", ["selector"]).ConfigureAwait(false);
            case "replace":
                return await TargetDispatchAsync(rest, "replace_tab", ["selector", "html"]).ConfigureAwait(false);
            case "upload":
                return await TargetDispatchAsync(rest, "upload_tab", ["selector", "file"]).ConfigureAwait(false);
            case "type":
                return await TypeAsync(rest).ConfigureAwait(false);
            case "key":
                return await TargetDispatchAsync(rest, "key_tab", ["modifiers"], positionalKeys: ["key"]).ConfigureAwait(false);
            case "navigate":
                return await TargetDispatchAsync(rest, "navigate_tab", positionalKeys: ["url"]).ConfigureAwait(false);
            case "scroll":
                return await TargetDispatchAsync(rest, "scroll_tab", ["dy", "dx", "at-x", "at-y"]).ConfigureAwait(false);
            case "drag":
                return await TargetDispatchAsync(rest, "drag_tab", ["from-selector", "to-selector", "from-x", "from-y", "to-x", "to-y", "steps"]).ConfigureAwait(false);
            case "wait":
                return await TargetDispatchAsync(rest, "wait_tab", ["selector", "hidden", "ms", "timeout"]).ConfigureAwait(false);
            case "revoke":
                return await RevokeAsync(rest).ConfigureAwait(false);
            case "audit":
                return await AuditAsync(rest).ConfigureAwait(false);
            case "install-skill":
                PrintErrorJson("install_skill_removed", "abg install-skill was removed. Install the ABG skills with: npx skills add arcmanagement/agent-browser-gateway -g");
                return 1;
            case "record":
            case "replay":
            case "plugin":
                PrintErrorJson("not_supported_on_windows_mvp", $"{command} is not supported by the Windows MVP.");
                return 1;
            default:
                PrintErrorJson("unknown_command", command);
                return 1;
        }
    }

    private static async Task<int> TabsAsync(string[] args)
    {
        var parsed = ParseArgs(args);
        var response = await Client.CallAsync("list_tabs").ConfigureAwait(false);
        if (!EnsureSuccess(response, out var result)) return 1;
        if (parsed.Flags.Contains("compact") || parsed.Options.GetValueOrDefault("format") == "text")
        {
            if (result.HasValue && result.Value.ValueKind == JsonValueKind.Array)
            {
                foreach (var tab in result.Value.EnumerateArray())
                {
                    var refName = tab.GetString("ref") ?? "?";
                    var tabId = tab.GetInt("tabId")?.ToString() ?? "?";
                    var accessMode = tab.GetString("accessMode");
                    var title = tab.GetString("title") ?? "";
                    var url = tab.GetString("url") ?? "";
                    var modePrefix = string.IsNullOrWhiteSpace(accessMode) ? "" : $"{accessMode}\t";
                    Console.WriteLine($"{refName}\t{tabId}\t{modePrefix}{title}\t{url}");
                }
            }
            return 0;
        }
        PrintJson(result);
        return 0;
    }

    private static async Task<int> ReadAsync(string[] args)
    {
        var parsed = ParseArgs(args);
        var tabId = await ResolveTabIdAsync(parsed).ConfigureAwait(false);
        var format = parsed.Options.GetValueOrDefault("format", "markdown");
        var parameters = BaseTabParams(tabId, parsed);
        if (parsed.Options.TryGetValue("selector", out var selector)) parameters["selector"] = selector;
        if (format == "markdown") parameters["asMarkdown"] = true;
        if (parsed.Flags.Contains("keep-images")) parameters["keepImages"] = true;

        var response = await Client.CallAsync("read_tab", parameters).ConfigureAwait(false);
        if (!EnsureSuccess(response, out var result)) return 1;
        if (format == "json")
        {
            PrintJson(result);
            return 0;
        }

        if (result.HasValue && result.Value.ValueKind == JsonValueKind.Object)
        {
            var key = format switch
            {
                "markdown" => "markdown",
                "html" => "html",
                "text" => "text",
                _ => throw new CliUsageException("--format must be markdown, text, html, or json")
            };
            if (result.Value.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String)
            {
                Console.WriteLine(value.GetString());
                return 0;
            }
        }
        PrintJson(result);
        return 0;
    }

    private static async Task<int> ScreenshotAsync(string[] args)
    {
        var parsed = ParseArgs(args);
        if (parsed.Flags.Contains("latest"))
        {
            if (!File.Exists(AbgPaths.LatestScreenshotMarker))
            {
                PrintErrorJson("latest_screenshot_not_found", "No latest screenshot marker exists.");
                return 1;
            }
            PrintJson(new Dictionary<string, object?> { ["path"] = File.ReadAllText(AbgPaths.LatestScreenshotMarker).Trim() });
            return 0;
        }

        var tabId = await ResolveTabIdAsync(parsed).ConfigureAwait(false);
        var parameters = BaseTabParams(tabId, parsed);
        var hasClip = parsed.Options.ContainsKey("x") || parsed.Options.ContainsKey("y") ||
                      parsed.Options.ContainsKey("width") || parsed.Options.ContainsKey("height");
        if (hasClip)
        {
            foreach (var key in new[] { "x", "y", "width", "height" })
            {
                if (!parsed.Options.ContainsKey(key)) throw new CliUsageException("--x, --y, --width, and --height are all required when clipping");
            }
            parameters["clip"] = new Dictionary<string, object?>
            {
                ["x"] = ToDouble(parsed.Options["x"]),
                ["y"] = ToDouble(parsed.Options["y"]),
                ["width"] = ToDouble(parsed.Options["width"]),
                ["height"] = ToDouble(parsed.Options["height"])
            };
        }

        var response = await Client.CallAsync("screenshot_tab", parameters).ConfigureAwait(false);
        if (!EnsureSuccess(response, out var result)) return 1;
        var outPath = parsed.Options.TryGetValue("out", out var specified)
            ? AbgPaths.ExpandUserPath(specified)
            : Path.Combine(AbgPaths.ScreenshotDir, $"abg-screenshot-{tabId}-{DateTimeOffset.UtcNow.ToUnixTimeSeconds()}.png");
        var saved = SaveScreenshot(result, outPath);
        PrintJson(saved);
        return 0;
    }

    private static async Task<int> TypeAsync(string[] args)
    {
        var parsed = ParseArgs(args);
        var tabId = await ResolveTabIdAsync(parsed).ConfigureAwait(false);
        var textIndex = HasMatchTarget(parsed) ? 0 : 1;
        if (parsed.Positionals.Count <= textIndex) throw new CliUsageException("usage: abg type <tab> <text>");
        var parameters = BaseTabParams(tabId, parsed);
        parameters["text"] = parsed.Positionals[textIndex];
        return await CallAndPrintAsync("type_tab", parameters).ConfigureAwait(false);
    }

    private static async Task<int> RevokeAsync(string[] args)
    {
        var parsed = ParseArgs(args);
        var tabId = await ResolveTabIdAsync(parsed).ConfigureAwait(false);
        return await CallAndPrintAsync("revoke_tab", new Dictionary<string, object?> { ["tabId"] = tabId }).ConfigureAwait(false);
    }

    private static async Task<int> AuditAsync(string[] args)
    {
        var parsed = ParseArgs(args);
        var lines = parsed.Options.TryGetValue("lines", out var value) ? ToInt(value) : 50;
        return await CallAndPrintAsync("audit", new Dictionary<string, object?> { ["lines"] = lines }).ConfigureAwait(false);
    }

    private static async Task<int> EvalAsync(string[] args)
    {
        var parsed = ParseArgs(args);
        var sourceCount = (parsed.Options.ContainsKey("script") ? 1 : 0) +
                          (parsed.Options.ContainsKey("script-file") ? 1 : 0) +
                          (parsed.Flags.Contains("stdin") ? 1 : 0);
        if (sourceCount != 1) throw new CliUsageException("Pass exactly one script source: --script, --script-file, or --stdin.");

        string script;
        if (parsed.Options.TryGetValue("script", out var inlineScript))
        {
            script = inlineScript;
        }
        else if (parsed.Options.TryGetValue("script-file", out var scriptFile))
        {
            script = await File.ReadAllTextAsync(AbgPaths.ExpandUserPath(scriptFile)).ConfigureAwait(false);
        }
        else
        {
            using var reader = new StreamReader(Console.OpenStandardInput(), Encoding.UTF8);
            script = await reader.ReadToEndAsync().ConfigureAwait(false);
        }

        var tabId = await ResolveTabIdAsync(parsed).ConfigureAwait(false);
        var parameters = BaseTabParams(tabId, parsed);
        parameters["script"] = script;
        parameters["approve"] = parsed.Flags.Contains("approve");
        parameters["maxBytes"] = parsed.Options.TryGetValue("max-bytes", out var maxBytes) ? ToInt(maxBytes) : 65_536;
        var response = await Client.CallAsync("eval_tab", parameters).ConfigureAwait(false);
        if (!EnsureSuccess(response, out var result)) return 1;
        PrintJson(result);
        if (result.HasValue &&
            result.Value.ValueKind == JsonValueKind.Object &&
            result.Value.TryGetProperty("ok", out var ok) &&
            ok.ValueKind == JsonValueKind.False)
        {
            return 1;
        }
        return 0;
    }

    private static async Task<int> TargetDispatchAsync(
        string[] args,
        string method,
        IReadOnlyList<string>? optionAllowList = null,
        IReadOnlyList<string>? positionalKeys = null)
    {
        var parsed = ParseArgs(args);
        var tabId = await ResolveTabIdAsync(parsed).ConfigureAwait(false);
        var parameters = BaseTabParams(tabId, parsed);

        if (optionAllowList is not null)
        {
            foreach (var key in optionAllowList)
            {
                if (parsed.Options.TryGetValue(key, out var value))
                {
                    parameters[ToCamelKey(key)] = CoerceScalar(value);
                }
                else if (parsed.Flags.Contains(key))
                {
                    parameters[ToCamelKey(key)] = true;
                }
            }
        }

        if (parsed.Flags.Contains("stdin"))
        {
            using var reader = new StreamReader(Console.OpenStandardInput(), Encoding.UTF8);
            parameters["value"] = await reader.ReadToEndAsync().ConfigureAwait(false);
        }

        if (positionalKeys is not null)
        {
            var valueIndex = HasMatchTarget(parsed) ? 0 : 1;
            foreach (var key in positionalKeys)
            {
                if (parsed.Positionals.Count > valueIndex)
                {
                    parameters[key] = CoerceScalar(parsed.Positionals[valueIndex]);
                }
                valueIndex++;
            }
        }

        return await CallAndPrintAsync(method, parameters).ConfigureAwait(false);
    }

    private static async Task<int> ResolveTabIdAsync(ParsedArgs parsed)
    {
        var listResponse = await Client.CallAsync("list_tabs").ConfigureAwait(false);
        if (!EnsureSuccess(listResponse, out var tabs)) throw new CliUsageException("failed to list shared tabs");
        var token = HasMatchTarget(parsed) ? null : parsed.Positionals.FirstOrDefault();
        try
        {
            return TabResolver.Resolve(
                tabs ?? JsonUtil.ToElement(Array.Empty<object>()),
                token,
                parsed.Options.GetValueOrDefault("match-url"),
                parsed.Options.GetValueOrDefault("match-title"),
                parsed.Flags.Contains("first"));
        }
        catch (Exception ex)
        {
            throw new CliUsageException(ex.Message);
        }
    }

    private static Dictionary<string, object?> BaseTabParams(int tabId, ParsedArgs parsed)
    {
        var parameters = new Dictionary<string, object?> { ["tabId"] = tabId };
        if (parsed.Options.TryGetValue("match-url", out var matchUrl)) parameters["matchUrl"] = matchUrl;
        if (parsed.Options.TryGetValue("match-title", out var matchTitle)) parameters["matchTitle"] = matchTitle;
        return parameters;
    }

    private static bool HasMatchTarget(ParsedArgs parsed)
    {
        return parsed.Options.ContainsKey("match-url") || parsed.Options.ContainsKey("match-title");
    }

    private static async Task<int> CallAndPrintAsync(string method, object? parameters = null)
    {
        var response = await Client.CallAsync(method, parameters).ConfigureAwait(false);
        if (!EnsureSuccess(response, out var result)) return 1;
        PrintJson(result);
        return 0;
    }

    private static bool EnsureSuccess(CliResponse response, out JsonElement? result)
    {
        result = null;
        if (response.Error is not null)
        {
            PrintJson(new Dictionary<string, object?>
            {
                ["error"] = response.Error.Code,
                ["message"] = response.Error.Message,
                ["userMessage"] = response.Error.UserMessage,
                ["nextCommand"] = response.Error.NextCommand,
                ["hint"] = response.Error.Hint,
                ["tabId"] = response.Error.TabId,
                ["plugin"] = response.Error.Plugin,
                ["command"] = response.Error.Command
            }, stderr: true);
            return false;
        }

        if (response.Result is JsonElement element) result = element;
        else if (response.Result is not null) result = JsonUtil.ToElement(response.Result);
        return true;
    }

    private static Dictionary<string, object?> SaveScreenshot(JsonElement? result, string outPath)
    {
        if (!result.HasValue ||
            result.Value.ValueKind != JsonValueKind.Object ||
            !result.Value.TryGetProperty("dataUrl", out var dataUrlElement) ||
            dataUrlElement.ValueKind != JsonValueKind.String)
        {
            throw new CliUsageException("screenshot result did not contain dataUrl");
        }

        var dataUrl = dataUrlElement.GetString() ?? "";
        var marker = "base64,";
        var index = dataUrl.IndexOf(marker, StringComparison.Ordinal);
        if (index < 0) throw new CliUsageException("screenshot dataUrl was not base64 PNG data");
        var bytes = Convert.FromBase64String(dataUrl[(index + marker.Length)..]);
        Directory.CreateDirectory(Path.GetDirectoryName(outPath)!);
        File.WriteAllBytes(outPath, bytes);
        File.WriteAllText(AbgPaths.LatestScreenshotMarker, outPath);
        return new Dictionary<string, object?>
        {
            ["path"] = outPath,
            ["bytes"] = bytes.Length
        };
    }

    private static ParsedArgs ParseArgs(string[] args)
    {
        var parsed = new ParsedArgs();
        for (var i = 0; i < args.Length; i++)
        {
            var token = args[i];
            if (!token.StartsWith("--", StringComparison.Ordinal))
            {
                parsed.Positionals.Add(token);
                continue;
            }

            var key = token[2..];
            if (string.IsNullOrWhiteSpace(key)) throw new CliUsageException("empty option name is not allowed");
            if (i + 1 < args.Length && !args[i + 1].StartsWith("--", StringComparison.Ordinal))
            {
                parsed.Options[key] = args[++i];
            }
            else
            {
                parsed.Flags.Add(key);
            }
        }
        return parsed;
    }

    private static object CoerceScalar(string value)
    {
        if (value.Equals("true", StringComparison.OrdinalIgnoreCase)) return true;
        if (value.Equals("false", StringComparison.OrdinalIgnoreCase)) return false;
        if (int.TryParse(value, out var intValue)) return intValue;
        if (double.TryParse(value, out var doubleValue)) return doubleValue;
        if (value.Contains(',', StringComparison.Ordinal) && value.All(ch => char.IsLetter(ch) || ch == ',' || ch == '-' || ch == '_'))
        {
            return value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        }
        return value;
    }

    private static int ToInt(string value) => int.TryParse(value, out var parsed) ? parsed : throw new CliUsageException($"not an integer: {value}");

    private static double ToDouble(string value) => double.TryParse(value, out var parsed) ? parsed : throw new CliUsageException($"not a number: {value}");

    private static string ToCamelKey(string key)
    {
        return key switch
        {
            "status-min" => "statusMin",
            "request-id" => "requestId",
            "url" => "urlPattern",
            "from-selector" => "fromSelector",
            "to-selector" => "toSelector",
            "from-x" => "fromX",
            "from-y" => "fromY",
            "to-x" => "toX",
            "to-y" => "toY",
            "at-x" => "atX",
            "at-y" => "atY",
            "dx" => "deltaX",
            "dy" => "deltaY",
            "ms" => "sleepMs",
            "timeout" => "timeoutMs",
            _ => key
        };
    }

    private static void PrintJson(object? value, bool stderr = false)
    {
        var json = value is JsonElement element
            ? JsonSerializer.Serialize(element, JsonUtil.PrettyOptions)
            : JsonSerializer.Serialize(value, JsonUtil.PrettyOptions);
        if (stderr) Console.Error.WriteLine(json);
        else Console.WriteLine(json);
    }

    private static void PrintErrorJson(string error, string message)
    {
        PrintJson(new Dictionary<string, object?> { ["error"] = error, ["message"] = message }, stderr: true);
    }

    private static void PrintHelp()
    {
        Console.WriteLine("""
        Agent Browser Gateway CLI for Windows

        Observation:
          abg status
          abg tabs --compact
          abg inspect
          abg read <tab|ref> [--selector <css>] [--format markdown|text|html|json]
          abg screenshot <tab|ref> [--out <path>] [--x N --y N --width N --height N]
          abg console <tab|ref>
          abg eval <tab|ref> --script "document.title" [--approve]
          abg table <tab|ref> [--selector table]
          abg describe <tab|ref>
          abg network <tab|ref> [--url *api*] [--status-min 400]

        Operation:
          abg click <tab|ref> --selector <css>
          abg fill <tab|ref> --selector <css> --value <text>
          abg paste <tab|ref> --selector <css> --value <text>
          abg upload <tab|ref> --selector "input[type=file]" --file C:\path\file.zip
          abg key <tab|ref> Enter
          abg navigate <tab|ref> https://example.com
          abg revoke <tab|ref>

        Agent skills install via: npx skills add arcmanagement/agent-browser-gateway -g
        """);
    }

    private sealed class ParsedArgs
    {
        public List<string> Positionals { get; } = [];
        public Dictionary<string, string> Options { get; } = new(StringComparer.Ordinal);
        public HashSet<string> Flags { get; } = new(StringComparer.Ordinal);
    }

    private sealed class CliUsageException : Exception
    {
        public CliUsageException(string message) : base(message)
        {
        }
    }
}
