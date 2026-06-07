using System.Net;
using System.Text.RegularExpressions;

namespace AgentBrowserGateway.Core;

public sealed class MarkdownTransformer
{
    public (string Name, string Markdown) TransformForUrl(string url, string html, bool keepImages)
    {
        if (Uri.TryCreate(url, UriKind.Absolute, out var uri) &&
            (uri.Host.EndsWith("notion.so", StringComparison.OrdinalIgnoreCase) ||
             uri.Host.EndsWith("notion.site", StringComparison.OrdinalIgnoreCase)))
        {
            return ("notion-to-markdown", CleanNotionHtml(html));
        }
        return (keepImages ? "html-to-markdown-keep-images" : "html-to-markdown", ConvertHtmlToMarkdown(html, keepImages));
    }

    public string ConvertHtmlToMarkdown(string? html, bool keepImages = false)
    {
        if (string.IsNullOrEmpty(html)) return "";
        var s = html;

        s = Regex.Replace(s, @"<!--[\s\S]*?-->", "", RegexOptions.CultureInvariant);
        s = Regex.Replace(s, @"<script[\s\S]*?</script>", "", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        s = Regex.Replace(s, @"<style[\s\S]*?</style>", "", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        s = Regex.Replace(s, @"<noscript[\s\S]*?</noscript>", "", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        s = Regex.Replace(s, @"<svg[\s\S]*?</svg>", "", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

        for (var level = 1; level <= 6; level++)
        {
            var hashes = new string('#', level);
            s = Regex.Replace(s, $@"<h{level}[^>]*>([\s\S]*?)</h{level}>", $"\n{hashes} $1\n\n", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        }

        s = Regex.Replace(s, @"</p\s*>", "\n\n", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        s = Regex.Replace(s, @"<br\s*/?>", "\n", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        s = Regex.Replace(s, @"<hr\s*/?>", "\n---\n\n", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        s = Regex.Replace(s, @"<li[^>]*>([\s\S]*?)</li>", "- $1\n", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        s = Regex.Replace(s, @"</?[uo]l[^>]*>", "\n", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        s = Regex.Replace(s, @"<pre[^>]*>([\s\S]*?)</pre>", "\n```\n$1\n```\n\n", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        s = Regex.Replace(s, @"<blockquote[^>]*>([\s\S]*?)</blockquote>", m =>
        {
            var inner = StripTags(m.Groups[1].Value).Trim();
            return "\n" + string.Join("\n", inner.Split('\n').Select(line => "> " + line.Trim())) + "\n\n";
        }, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

        for (var i = 0; i < 4; i++)
        {
            s = Regex.Replace(s, @"<(strong|b)[^>]*>([\s\S]*?)</\1>", "**$2**", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
            s = Regex.Replace(s, @"<(em|i)[^>]*>([\s\S]*?)</\1>", "_$2_", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
            s = Regex.Replace(s, @"<code[^>]*>([\s\S]*?)</code>", "`$1`", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
            s = Regex.Replace(s, @"<a[^>]*href=[""']([^""']*)[""'][^>]*>([\s\S]*?)</a>", "[$2]($1)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
            s = Regex.Replace(s, @"<img[^>]*alt=[""']([^""']*)[""'][^>]*src=[""']([^""']*)[""'][^>]*>", m => ImageMarkdown(m.Groups[1].Value, m.Groups[2].Value, keepImages), RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
            s = Regex.Replace(s, @"<img[^>]*src=[""']([^""']*)[""'][^>]*alt=[""']([^""']*)[""'][^>]*>", m => ImageMarkdown(m.Groups[2].Value, m.Groups[1].Value, keepImages), RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
            s = Regex.Replace(s, @"<img[^>]*src=[""']([^""']*)[""'][^>]*>", m => ImageMarkdown("", m.Groups[1].Value, keepImages), RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        }

        return CleanText(s);
    }

    private string CleanNotionHtml(string html)
    {
        var s = html;
        var chromeClasses = new[]
        {
            "notion-sidebar",
            "notion-topbar",
            "notion-help-button",
            "notion-ai-button",
            "notion-overlay-container",
            "notion-presence-container",
            "notion-peek-renderer",
            "notion-page-controls",
            "notion-comment",
            "notion-update-sidebar"
        };

        foreach (var klass in chromeClasses)
        {
            s = Regex.Replace(s, $@"<([a-z0-9-]+)[^>]*class=[""'][^""']*{Regex.Escape(klass)}[^""']*[""'][^>]*>[\s\S]*?</\1>", "\n", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        }

        s = Regex.Replace(s, @"\sdata-block-id=[""'][^""']*[""']", "", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        s = Regex.Replace(s, @"\sdata-content-editable-leaf=[""'][^""']*[""']", "", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        s = Regex.Replace(s, @"\sstyle=[""'][^""']*[""']", "", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        s = Regex.Replace(s, @"\sclass=[""'][^""']*notion-[^""']*[""']", "", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        return ConvertHtmlToMarkdown(s, keepImages: false);
    }

    private static string ImageMarkdown(string alt, string src, bool keepImages)
    {
        var cleanAlt = Regex.Replace(alt ?? "", @"\s+", " ").Trim();
        if (keepImages) return $"![{cleanAlt}]({src})";
        return string.IsNullOrEmpty(cleanAlt) ? "[img]" : $"![{cleanAlt}]";
    }

    private static string CleanText(string input)
    {
        var s = StripTags(input);
        s = WebUtility.HtmlDecode(s);
        s = Regex.Replace(s, @"[ \t]+\n", "\n", RegexOptions.CultureInvariant);
        s = Regex.Replace(s, @"\n[ \t]+", "\n", RegexOptions.CultureInvariant);
        s = Regex.Replace(s, @"\n{3,}", "\n\n", RegexOptions.CultureInvariant);
        return s.Trim();
    }

    private static string StripTags(string input)
    {
        return Regex.Replace(input, @"<[^>]+>", "", RegexOptions.CultureInvariant);
    }
}
