using System.Text.RegularExpressions;

namespace AgentBrowserGateway.Core;

public static class GlobMatcher
{
    public static bool IsMatch(string value, string pattern)
    {
        if (string.IsNullOrEmpty(pattern)) return true;
        var escaped = Regex.Escape(pattern)
            .Replace("\\*", ".*", StringComparison.Ordinal)
            .Replace("\\?", ".", StringComparison.Ordinal);
        return Regex.IsMatch(value, "^" + escaped + "$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    }
}
