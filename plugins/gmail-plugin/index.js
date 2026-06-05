// gmail-plugin: per-domain Markdown diet for Gmail threads.

function gmailToMarkdown(html) {
  var s = stripNoise(html);
  s = stripBlocksByAttrs(s, [
    "role=[\"']navigation[\"']",
    "role=[\"']banner[\"']",
    "role=[\"']complementary[\"']",
    "aria-label=[\"']Main menu[\"']",
    "aria-label=[\"']Search mail[\"']",
    "gh=[\"']tm[\"']",
  ]);
  s = s
    .replace(/<div[^>]*role=["']listitem["'][^>]*>/gi, "\n\n---\n\n")
    .replace(/<div[^>]*class=["'][^"']*(?:adn|gs|ii|a3s|im)[^"']*["'][^>]*>/gi, "\n")
    .replace(/<span[^>]*email=["']([^"']+)["'][^>]*>([\s\S]*?)<\/span>/gi, "$2 <$1>")
    .replace(/<span[^>]*name=["']([^"']+)["'][^>]*email=["']([^"']+)["'][^>]*>[\s\S]*?<\/span>/gi, "$1 <$2>")
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n")
    .replace(/<div[^>]*data-hovercard-id=["']([^"']+)["'][^>]*>([\s\S]*?)<\/div>/gi, "\nFrom: $2 <$1>\n")
    .replace(/<a[^>]*href=["']mailto:([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "$2 <$1>")
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, function (_, inner) {
      return "\n" + cleanText(inner).split("\n").map(function (line) {
        return line.trim() ? "> " + line.trim() : ">";
      }).join("\n") + "\n";
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|table)>/gi, "\n")
    .replace(/<\/(td|th)>/gi, " | ");
  return cleanText(s);
}

function stripNoise(input) {
  return String(input || "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<img[^>]*>/gi, "");
}

function stripBlocksByAttrs(html, attrs) {
  var s = html;
  for (var i = 0; i < attrs.length; i++) {
    var re = new RegExp("<([a-z0-9-]+)[^>]*" + attrs[i] + "[^>]*>[\\s\\S]*?<\\/\\1>", "gi");
    s = s.replace(re, "\n");
  }
  return s;
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

abg.registerTransform("gmail-to-markdown", gmailToMarkdown);
abg.log("registered gmail-to-markdown transformer");
