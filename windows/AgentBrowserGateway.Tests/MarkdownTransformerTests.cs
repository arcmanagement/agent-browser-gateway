using AgentBrowserGateway.Core;
using Xunit;

namespace AgentBrowserGateway.Tests;

public sealed class MarkdownTransformerTests
{
    [Fact]
    public void ConvertsBasicHtmlToMarkdown()
    {
        var transformer = new MarkdownTransformer();
        var markdown = transformer.ConvertHtmlToMarkdown("<h1>Hello</h1><p><strong>World</strong></p>");
        Assert.Contains("# Hello", markdown);
        Assert.Contains("**World**", markdown);
    }

    [Fact]
    public void DropsImageSrcUnlessKeepImagesIsEnabled()
    {
        var transformer = new MarkdownTransformer();
        var markdown = transformer.ConvertHtmlToMarkdown("<img alt=\"Logo\" src=\"https://example.com/logo.png\">");
        Assert.Equal("![Logo]", markdown);

        var keep = transformer.ConvertHtmlToMarkdown("<img alt=\"Logo\" src=\"https://example.com/logo.png\">", keepImages: true);
        Assert.Equal("![Logo](https://example.com/logo.png)", keep);
    }
}
