// linear-plugin: per-domain Markdown diet for Linear issue pages.

function linearToMarkdown(html) {
  var s = stripNoise(html);
  s = stripChrome(s);
  s = s
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n\n")
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n\n")
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n\n")
    .replace(/<span[^>]*(?:data-testid|aria-label)=["'](?:Issue ID|Identifier)["'][^>]*>([\s\S]*?)<\/span>/gi, "\nIssue: $1\n")
    .replace(/<span[^>]*(?:data-testid|aria-label)=["']Status["'][^>]*>([\s\S]*?)<\/span>/gi, "\nStatus: $1\n")
    .replace(/<span[^>]*(?:data-testid|aria-label)=["']Assignee["'][^>]*>([\s\S]*?)<\/span>/gi, "\nAssignee: $1\n")
    .replace(/<time[^>]*datetime=["']([^"']+)["'][^>]*>([\s\S]*?)<\/time>/gi, "$2 ($1)")
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n")
    .replace(/<\/?[uo]l[^>]*>/gi, "\n")
    .replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|main)>/gi, "\n");
  return cleanText(s);
}

function stripNoise(input) {
  return String(input || "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<canvas[\s\S]*?<\/canvas>/gi, "");
}

function stripChrome(html) {
  return html
    .replace(/<aside[\s\S]*?<\/aside>/gi, "\n")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "\n")
    .replace(/<header[\s\S]*?<\/header>/gi, "\n")
    .replace(/<([a-z0-9-]+)[^>]*(?:data-testid|aria-label)=["'](?:Sidebar|Navigation|Command menu|Roadmap)["'][^>]*>[\s\S]*?<\/\1>/gi, "\n");
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

abg.registerTransform("linear-to-markdown", linearToMarkdown);
abg.log("registered linear-to-markdown transformer");
