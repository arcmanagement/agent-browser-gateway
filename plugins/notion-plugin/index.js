// notion-plugin: per-domain Markdown diet for shared Notion tabs.
//
// JavaScriptCore does not expose DOMParser, so this is intentionally a small,
// deterministic HTML cleanup pass tuned for Notion's app chrome. It strips
// sidebars, top bars, popovers, scripts, styles, and Notion bookkeeping before
// converting the remaining page content to compact Markdown.

function notionToMarkdown(html) {
  if (typeof html !== "string") return "";

  var s = html;

  s = s
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<canvas[\s\S]*?<\/canvas>/gi, "");

  s = stripNotionChrome(s);

  s = s
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n\n")
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n\n")
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n\n")
    .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "\n#### $1\n\n")
    .replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, "\n##### $1\n\n")
    .replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, "\n###### $1\n\n")
    .replace(/<div[^>]*class=["'][^"']*notion-header-block[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi, "\n# $1\n\n")
    .replace(/<div[^>]*class=["'][^"']*notion-sub_header-block[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi, "\n## $1\n\n")
    .replace(/<div[^>]*class=["'][^"']*notion-sub_sub_header-block[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi, "\n### $1\n\n")
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n")
    .replace(/<\/?[uo]l[^>]*>/gi, "\n")
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, function (_, inner) {
      return "\n" + cleanText(inner).split("\n").map(function (line) {
        return line.trim() ? "> " + line.trim() : ">";
      }).join("\n") + "\n\n";
    })
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, "\n```\n$1\n```\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|main|tr)>/gi, "\n")
    .replace(/<\/(td|th)>/gi, " | ");

  for (var i = 0; i < 4; i++) {
    s = s
      .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**")
      .replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, "_$2_")
      .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
      .replace(/<a[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
      .replace(/<img[^>]*alt=["']([^"']*)["'][^>]*>/gi, "\n[image: $1]\n")
      .replace(/<img[^>]*>/gi, "\n[image]\n");
  }

  return cleanText(s);
}

function stripNotionChrome(html) {
  var chromeClasses = [
    "notion-sidebar",
    "notion-topbar",
    "notion-help-button",
    "notion-ai-button",
    "notion-overlay-container",
    "notion-presence-container",
    "notion-peek-renderer",
    "notion-page-controls",
    "notion-comment",
    "notion-update-sidebar",
  ];

  var s = html;
  for (var i = 0; i < chromeClasses.length; i++) {
    var klass = chromeClasses[i];
    var re = new RegExp("<([a-z0-9-]+)[^>]*class=[\"'][^\"']*" + klass + "[^\"']*[\"'][^>]*>[\\s\\S]*?<\\/\\1>", "gi");
    s = s.replace(re, "\n");
  }

  return s
    .replace(/\sdata-block-id=["'][^"']*["']/gi, "")
    .replace(/\sdata-content-editable-leaf=["'][^"']*["']/gi, "")
    .replace(/\sstyle=["'][^"']*["']/gi, "")
    .replace(/\sclass=["'][^"']*notion-[^"']*["']/gi, "")
    .replace(/<div[^>]*role=["']button["'][^>]*>\s*(Share|Updates|Comments|Search|New|Ask AI)\s*<\/div>/gi, "\n");
}

function cleanText(input) {
  return String(input)
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

abg.registerTransform("notion-to-markdown", notionToMarkdown);
abg.log("registered notion-to-markdown transformer");
