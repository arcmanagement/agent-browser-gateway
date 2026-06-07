using System.Text.Json;

namespace AgentBrowserGateway.Core;

public static class TabResolver
{
    public static int Resolve(
        JsonElement tabsElement,
        string? token,
        string? matchUrl = null,
        string? matchTitle = null,
        bool first = false)
    {
        var tabs = tabsElement.ValueKind == JsonValueKind.Array
            ? tabsElement.EnumerateArray().ToList()
            : [];

        if (!string.IsNullOrWhiteSpace(token))
        {
            if (token.StartsWith("t", StringComparison.OrdinalIgnoreCase) &&
                int.TryParse(token[1..], out var refIndex) &&
                refIndex >= 1 &&
                refIndex <= tabs.Count)
            {
                return tabs[refIndex - 1].GetInt("tabId") ??
                       throw new InvalidOperationException($"Tab ref {token} has no tabId.");
            }

            if (int.TryParse(token, out var tabId)) return tabId;
            throw new InvalidOperationException($"Invalid tab target: {token}");
        }

        IEnumerable<JsonElement> matches = tabs;
        if (!string.IsNullOrWhiteSpace(matchUrl))
        {
            matches = matches.Where(tab => GlobMatcher.IsMatch(tab.GetString("url") ?? "", matchUrl));
        }
        if (!string.IsNullOrWhiteSpace(matchTitle))
        {
            matches = matches.Where(tab => GlobMatcher.IsMatch(tab.GetString("title") ?? "", matchTitle));
        }

        var list = matches.ToList();
        if (list.Count == 0) throw new InvalidOperationException("No shared tab matched the target.");
        if (list.Count > 1 && !first)
        {
            throw new InvalidOperationException("Multiple shared tabs matched. Pass --first or a concrete tab/ref.");
        }
        return list[0].GetInt("tabId") ?? throw new InvalidOperationException("Matched tab has no tabId.");
    }
}
