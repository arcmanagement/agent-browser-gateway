using System.Text.Json;
using System.Text.Json.Serialization;

namespace AgentBrowserGateway.Core;

public static class JsonUtil
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        WriteIndented = false
    };

    public static readonly JsonSerializerOptions PrettyOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        WriteIndented = true
    };

    public static JsonElement ToElement(object? value)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(value, Options);
        using var doc = JsonDocument.Parse(bytes);
        return doc.RootElement.Clone();
    }

    public static Dictionary<string, object?> ToDictionary(JsonElement? element)
    {
        if (!element.HasValue || element.Value.ValueKind != JsonValueKind.Object) return [];
        return ToDictionary(element.Value);
    }

    public static Dictionary<string, object?> ToDictionary(JsonElement element)
    {
        var dict = new Dictionary<string, object?>(StringComparer.Ordinal);
        foreach (var property in element.EnumerateObject())
        {
            dict[property.Name] = ToObject(property.Value);
        }
        return dict;
    }

    public static object? ToObject(JsonElement element)
    {
        return element.ValueKind switch
        {
            JsonValueKind.Object => ToDictionary(element),
            JsonValueKind.Array => element.EnumerateArray().Select(ToObject).ToList(),
            JsonValueKind.String => element.GetString(),
            JsonValueKind.Number when element.TryGetInt64(out var longValue) => longValue is <= int.MaxValue and >= int.MinValue ? (int)longValue : longValue,
            JsonValueKind.Number when element.TryGetDouble(out var doubleValue) => doubleValue,
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Null => null,
            _ => null
        };
    }

    public static string? GetString(this JsonElement? element, string name)
    {
        if (!element.HasValue) return null;
        return GetString(element.Value, name);
    }

    public static string? GetString(this JsonElement element, string name)
    {
        return element.ValueKind == JsonValueKind.Object &&
               element.TryGetProperty(name, out var value) &&
               value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
    }

    public static int? GetInt(this JsonElement? element, string name)
    {
        if (!element.HasValue) return null;
        return GetInt(element.Value, name);
    }

    public static int? GetInt(this JsonElement element, string name)
    {
        return element.ValueKind == JsonValueKind.Object &&
               element.TryGetProperty(name, out var value) &&
               value.ValueKind == JsonValueKind.Number &&
               value.TryGetInt32(out var n)
            ? n
            : null;
    }

    public static bool? GetBool(this JsonElement? element, string name)
    {
        if (!element.HasValue || element.Value.ValueKind != JsonValueKind.Object ||
            !element.Value.TryGetProperty(name, out var value)) return null;
        return value.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => null
        };
    }

    public static JsonElement RemoveKeys(JsonElement? element, params string[] keys)
    {
        var dict = ToDictionary(element);
        foreach (var key in keys) dict.Remove(key);
        return ToElement(dict);
    }

    public static string SerializeLine(object value)
    {
        return JsonSerializer.Serialize(value, Options) + "\n";
    }
}
