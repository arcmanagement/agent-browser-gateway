// slack-plugin: per-domain Markdown diet for Slack pages.

function slackToMarkdown(html) {
  var messages = extractSlackMessages(String(html || ""), 100, null);
  if (messages.length > 0) {
    return messages.map(formatSlackMessage).join("\n\n").trim();
  }
  return cleanText(
    stripNoise(html)
      .replace(/<([a-z0-9-]+)[^>]*aria-label=["'](?:Channel browser|Workspace switcher|Sidebar|Navigation)["'][^>]*>[\s\S]*?<\/\1>/gi, "\n")
      .replace(/<a[^>]*href=["']([^"']*\/archives\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|section|article|main)>/gi, "\n")
  );
}

abg.registerCommand("catch-up", async function (args, context) {
  var missing = requireTab(context, "catch-up");
  if (missing) return missing;
  return await readSettledMessages(args, context, false);
});

abg.registerCommand("pending", async function (args, context) {
  var missing = requireTab(context, "pending");
  if (missing) return missing;
  return await readSettledMessages(args, context, true);
});

function requireTab(context, command) {
  if (context.tabId == null) {
    return {
      ok: false,
      error: "no_tab_context",
      message: "abg slack " + command + " requires a shared Slack tab. Use domain auto-bind or pass --tab/--tab-id.",
    };
  }
  return null;
}

async function readSettledMessages(args, context, pendingOnly) {
  var limit = Number(args.limit || 20);
  var timeoutMs = Number(args.timeoutMs || 3000);
  var started = Date.now();
  var last = null;

  while (Date.now() - started <= timeoutMs) {
    var page = await context.tab.read({});
    var parsed = parseSlackUrl(String(page.url || ""));
    var messages = extractSlackMessages(String(page.html || ""), limit, parsed.channel);
    last = { page: page, parsed: parsed, messages: messages };

    var stale = parsed.channel && messages.length > 0 && messages.some(function (m) {
      return m.channelId && m.channelId !== parsed.channel;
    });
    if (!stale) {
      if (pendingOnly) {
        messages = messages.filter(function (m) {
          return /(?:\bunread\b|\bpending\b|mention|needs reply|未読|要返信)/i.test(m.raw);
        });
      }
      return {
        ok: true,
        channel_id: parsed.channel || null,
        url: page.url || null,
        count: messages.length,
        messages: messages.map(messageRecord),
        markdown: messages.map(formatSlackMessage).join("\n\n").trim(),
      };
    }
    await context.tab.wait({ ms: 150 });
  }

  return {
    ok: false,
    error: "stale_channel_dom",
    message: "Slack DOM did not settle to the active channel before timeout.",
    expected_channel_id: last && last.parsed ? last.parsed.channel : null,
    observed_channel_ids: unique((last && last.messages ? last.messages : []).map(function (m) { return m.channelId; }).filter(Boolean)),
  };
}

function parseSlackUrl(url) {
  var match = String(url || "").match(/^(https:\/\/[^/]+)\/client\/([^/?#]+)\/([^/?#]+)/);
  return {
    origin: match ? match[1] : "",
    team: match ? match[2] : "",
    channel: match ? match[3] : "",
  };
}

function extractSlackMessages(html, limit, expectedChannelId) {
  var s = stripNoise(html);
  var re = /<a[^>]*href=["']([^"']*\/archives\/([A-Z0-9]+)\/p\d+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  var messages = [];
  var match;
  while ((match = re.exec(s)) !== null && messages.length < limit) {
    var raw = messageBlockAround(s, match.index, re.lastIndex);
    var text = cleanText(raw).replace(/\s+/g, " ").trim();
    if (text.length > 600) text = text.slice(0, 600).trim();
    messages.push({
      channelId: match[2],
      permalink: match[1],
      time: cleanText(match[3]),
      text: text,
      raw: raw,
      stale: expectedChannelId ? match[2] !== expectedChannelId : false,
    });
  }
  if (messages.length > 0) return dedupeMessages(messages).slice(-limit);

  var fallback = cleanText(s);
  return fallback ? [{ channelId: expectedChannelId || "", permalink: "", time: "", text: fallback, raw: s, stale: false }] : [];
}

function messageBlockAround(html, anchorIndex, fallbackEnd) {
  var marker = "data-qa=\"message_container\"";
  var markerIndex = html.lastIndexOf(marker, anchorIndex);
  if (markerIndex < 0) markerIndex = html.lastIndexOf("data-qa='message_container'", anchorIndex);
  if (markerIndex < 0) {
    var start = Math.max(0, anchorIndex - 400);
    var end = Math.min(html.length, fallbackEnd + 800);
    return html.slice(start, end);
  }
  var startTag = html.lastIndexOf("<", markerIndex);
  var nextMarker = html.indexOf(marker, anchorIndex + 1);
  if (nextMarker < 0) nextMarker = html.indexOf("data-qa='message_container'", anchorIndex + 1);
  var endTag = nextMarker >= 0 ? html.lastIndexOf("<", nextMarker) : html.length;
  if (startTag < 0 || endTag <= startTag) return html.slice(Math.max(0, anchorIndex - 400), Math.min(html.length, fallbackEnd + 800));
  return html.slice(startTag, endTag);
}

function formatSlackMessage(message) {
  var prefix = message.time ? "- " + message.time + ": " : "- ";
  var link = message.permalink ? " (" + message.permalink + ")" : "";
  return prefix + message.text + link;
}

function dedupeMessages(messages) {
  var seen = {};
  var out = [];
  for (var i = 0; i < messages.length; i++) {
    var key = messages[i].permalink || messages[i].text;
    if (seen[key]) continue;
    seen[key] = true;
    out.push(messages[i]);
  }
  return out;
}

function messageRecord(message) {
  return {
    channel_id: message.channelId || null,
    permalink: message.permalink || null,
    time: message.time || null,
    text: message.text,
    stale: message.stale,
  };
}

function unique(values) {
  var seen = {};
  var out = [];
  for (var i = 0; i < values.length; i++) {
    if (seen[values[i]]) continue;
    seen[values[i]] = true;
    out.push(values[i]);
  }
  return out;
}

function stripNoise(input) {
  return String(input || "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "");
}

function cleanText(input) {
  return String(input || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

abg.registerTransform("slack-to-markdown", slackToMarkdown);
abg.log("registered slack-to-markdown transformer and catch-up commands");
