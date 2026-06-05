// redaction-plugin: deterministic local masking baseline.

function applyCustomRegexes(text, customRegexes) {
  var output = text;
  if (!Array.isArray(customRegexes)) return output;
  customRegexes.forEach(function (pattern, index) {
    try {
      output = output.replace(new RegExp(String(pattern), "g"), "[redacted:custom-" + (index + 1) + "]");
    } catch (_) {
      // Ignore invalid user regexes; the Gateway still reports built-in redaction output.
    }
  });
  return output;
}

function redactText(input, customRegexes) {
  var output = String(input || "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted:email]")
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, function (match) {
      var digits = match.replace(/\D/g, "");
      return digits.length >= 13 && digits.length <= 19 ? "[redacted:card]" : match;
    })
    .replace(/(^|[^\w+])(\+?\d[\d .()/-]{7,}\d)\b/g, function (_, prefix, match) {
      var digits = match.replace(/\D/g, "");
      return digits.length >= 9 ? prefix + "[redacted:phone]" : prefix + match;
    });
  return applyCustomRegexes(output, customRegexes);
}

abg.registerTransform("local-redact-markdown", function (input) {
  return redactText(input);
});

abg.registerCommand("redact", async function (args, context) {
  var input = args.text || args.stdin || "";
  return {
    ok: true,
    plugin: context.plugin.name,
    text: redactText(input, args.customRegexes),
  };
});

abg.log("registered local-redact-markdown transformer");
