// markdown-plugin: HTML → Markdown converter for `abg read --as-markdown`.
//
// Runs in JavaScriptCore inside the Gateway. No DOM is available, so this is
// a regex-based converter — lossy on deeply nested or malformed HTML, but
// covers the common cases (headings, links, lists, emphasis, code,
// blockquotes, hr, br). A future iteration can swap in a real parser.

function convertHtmlToMarkdown(html, keepImages) {
  if (typeof html !== "string") return "";

  var s = html;

  // Strip noise.
  s = s
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "");

  s = normalizeSlackSenderNames(s);

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
      .replace(/<img[^>]*alt=["']([^"']*)["'][^>]*src=["']([^"']*)["'][^>]*>/gi, function (_, alt, src) {
        return imageMarkdown(alt, src, keepImages);
      })
      .replace(/<img[^>]*src=["']([^"']*)["'][^>]*alt=["']([^"']*)["'][^>]*>/gi, function (_, src, alt) {
        return imageMarkdown(alt, src, keepImages);
      })
      .replace(/<img[^>]*src=["']([^"']*)["'][^>]*>/gi, function (_, src) {
        return imageMarkdown("", src, keepImages);
      });
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
}

function imageMarkdown(alt, src, keepImages) {
  var cleanAlt = (alt || "").replace(/\s+/g, " ").trim();
  if (keepImages) return "![" + cleanAlt + "](" + src + ")";
  if (!cleanAlt) return "[img]";
  return "![" + cleanAlt + "]";
}

function normalizeSlackSenderNames(html) {
  var startTagRe = /<([a-z0-9-]+)\b(?=[^>]*\bdata-qa\s*=\s*["']message_sender_name["'])[^>]*>/ig;
  var output = "";
  var cursor = 0;
  var match;

  while ((match = startTagRe.exec(html)) !== null) {
    var tagName = match[1];
    var close = findClosingTag(html, tagName, startTagRe.lastIndex);
    if (!close) continue;

    var startTag = match[0];
    var inner = html.slice(startTagRe.lastIndex, close.start);
    var senderName = slackSenderName(startTag, inner);
    if (!senderName) continue;

    var afterSeparator = consumeSlackSenderSeparator(html, close.end);
    output += html.slice(cursor, match.index) + senderName;
    if (afterSeparator > close.end) output += " ";
    cursor = afterSeparator;
    startTagRe.lastIndex = afterSeparator;
  }

  return output + html.slice(cursor);
}

function findClosingTag(html, tagName, fromIndex) {
  var tagRe = new RegExp("</?" + escapeRegExp(tagName) + "\\b[^>]*>", "ig");
  tagRe.lastIndex = fromIndex;
  var depth = 1;
  var match;

  while ((match = tagRe.exec(html)) !== null) {
    if (match[0].charAt(1) === "/") {
      depth -= 1;
    } else if (!/\/\s*>$/.test(match[0])) {
      depth += 1;
    }
    if (depth === 0) return { start: match.index, end: tagRe.lastIndex };
  }

  return null;
}

function slackSenderName(startTag, innerHtml) {
  var label = attrValue(startTag, "aria-label") || firstAttrValue(innerHtml, "aria-label");
  if (label) return cleanSenderName(label);

  var text = textFromHtml(innerHtml);
  var clean = cleanSenderName(text);
  return collapseRepeatedSenderName(clean);
}

function consumeSlackSenderSeparator(html, fromIndex) {
  var i = skipWhitespace(html, fromIndex);
  if (html.charAt(i) === ":") return skipWhitespace(html, i + 1);

  var tag = html.slice(i).match(/^<([a-z0-9-]+)\b[^>]*>/i);
  if (!tag) return fromIndex;

  var close = findClosingTag(html, tag[1], i + tag[0].length);
  if (!close) return fromIndex;

  var text = textFromHtml(html.slice(i + tag[0].length, close.start)).replace(/\s+/g, " ").trim();
  if (text === ":") return skipWhitespace(html, close.end);

  return fromIndex;
}

function skipWhitespace(text, index) {
  var i = index;
  while (i < text.length && /\s/.test(text.charAt(i))) i += 1;
  return i;
}

function attrValue(html, name) {
  var re = new RegExp("\\s" + escapeRegExp(name) + "\\s*=\\s*([\"'])([\\s\\S]*?)\\1", "i");
  var match = html.match(re);
  return match ? match[2] : "";
}

function firstAttrValue(html, name) {
  var tagRe = /<[^>]+>/g;
  var match;
  while ((match = tagRe.exec(html)) !== null) {
    var value = attrValue(match[0], name);
    if (value) return value;
  }
  return "";
}

function textFromHtml(html) {
  return String(html)
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function cleanSenderName(name) {
  return String(name).replace(/\s*:\s*$/, "").replace(/\s+/g, " ").trim();
}

function collapseRepeatedSenderName(name) {
  var half = name.length / 2;
  if (half % 1 === 0 && name.slice(0, half) === name.slice(half)) {
    return name.slice(0, half).trim();
  }
  return name;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

abg.registerTransform("html-to-markdown", function (html) {
  return convertHtmlToMarkdown(html, false);
});

abg.registerTransform("html-to-markdown-keep-images", function (html) {
  return convertHtmlToMarkdown(html, true);
});

abg.log("registered html-to-markdown transformer");
