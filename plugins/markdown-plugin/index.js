// markdown-plugin: HTML → Markdown converter for `abg read --as-markdown`.
//
// Runs in JavaScriptCore inside the Gateway. No DOM is available, so this is
// a regex-based converter — lossy on deeply nested or malformed HTML, but
// covers the common cases (headings, links, lists, emphasis, code,
// blockquotes, hr, br). A future iteration can swap in a real parser.

abg.registerTransform("html-to-markdown", function (html) {
  if (typeof html !== "string") return "";

  var s = html;

  // Strip noise.
  s = s
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "");

  // Block elements with structural meaning.
  s = s
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n\n")
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n\n")
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n\n")
    .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "\n#### $1\n\n")
    .replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, "\n##### $1\n\n")
    .replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, "\n###### $1\n\n")
    .replace(/<\/p\s*>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<hr\s*\/?>/gi, "\n---\n\n");

  // Lists: each <li> becomes a bullet. Nested list semantics are flattened.
  s = s
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n")
    .replace(/<\/?[uo]l[^>]*>/gi, "\n");

  // Code / pre blocks.
  s = s.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, "\n```\n$1\n```\n\n");

  // Blockquotes.
  s = s.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, function (_, inner) {
    return (
      "\n" +
      inner.trim().split("\n").map(function (l) { return "> " + l; }).join("\n") +
      "\n\n"
    );
  });

  // Inline formatting. Loop a few times so nested same-tag chains collapse.
  for (var i = 0; i < 4; i++) {
    s = s
      .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**")
      .replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, "_$2_")
      .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
      .replace(/<a[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
      .replace(/<img[^>]*alt=["']([^"']*)["'][^>]*src=["']([^"']*)["'][^>]*>/gi, "![$1]($2)")
      .replace(/<img[^>]*src=["']([^"']*)["'][^>]*alt=["']([^"']*)["'][^>]*>/gi, "![$2]($1)")
      .replace(/<img[^>]*src=["']([^"']*)["'][^>]*>/gi, "![]($1)");
  }

  // Drop any remaining tags.
  s = s.replace(/<[^>]+>/g, "");

  // Decode the entities we care about.
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");

  // Whitespace cleanup.
  return s
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
});

abg.log("registered html-to-markdown transformer");
