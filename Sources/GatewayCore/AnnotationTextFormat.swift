import Foundation

/// Text-mode rendering shared by `abg annotate --format text`.
public enum AnnotationTextFormat {
    /// Lines for an arrow's tail (`from`) and head (`to`), indented under its annotation row.
    /// Live ends carry `viewportPoint` and `annotationDisplayNumber`; saved ends carry `point`
    /// and `annotationUid`, which `label` turns into a row label such as `[2]` or `saved [2]`.
    public static func arrowEndLines(
        _ annotation: [String: Any],
        indent: String = "    ",
        label: (String) -> String? = { _ in nil }
    ) -> [String] {
        guard (annotation["kind"] as? String) == "arrow",
              let arrow = annotation["arrow"] as? [String: Any]
        else { return [] }
        return ["from", "to"].compactMap { key in
            guard let end = arrow[key] as? [String: Any] else { return nil }
            var line = "\(indent)\(key)"
            if let point = (end["viewportPoint"] ?? end["point"]) as? [String: Any],
               let x = number(point["x"]), let y = number(point["y"]) {
                line += " (\(x), \(y))"
            }
            if let display = end["annotationDisplayNumber"].flatMap(number) {
                line += " -> [\(display)]"
            } else if let uid = end["annotationUid"] as? String {
                line += " -> \(label(uid) ?? "annotation \(uid)")"
            }
            let element = end["element"] as? [String: Any]
            if let selector = (end["selector"] as? String) ?? (element?["selector"] as? String), !selector.isEmpty {
                line += " selector=\(selector)"
            }
            if let text = element?["text"] as? String {
                let flat = text.split(whereSeparator: \.isWhitespace).joined(separator: " ")
                if !flat.isEmpty {
                    line += " text=\"\(flat.count > 80 ? String(flat.prefix(79)) + "…" : flat)\""
                }
            }
            return line
        }
    }

    static func number(_ value: Any?) -> String? {
        guard let value else { return nil }
        let double: Double
        if let int = value as? Int { return String(int) }
        if let number = value as? Double { double = number }
        else if let number = value as? NSNumber { double = number.doubleValue }
        else { return nil }
        guard double.isFinite else { return nil }
        return double == double.rounded() ? String(Int(double)) : String(format: "%.1f", double)
    }
}
