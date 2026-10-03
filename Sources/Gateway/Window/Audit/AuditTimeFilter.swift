import Foundation

enum AuditTimeFilter: String, CaseIterable, Identifiable {
    case hour
    case day
    case week
    case all

    var id: String { rawValue }

    var title: String {
        switch self {
        case .hour: return "1h"
        case .day: return "24h"
        case .week: return "7d"
        case .all: return "All"
        }
    }

    var accessibilityTitle: String {
        switch self {
        case .hour: return "Last hour"
        case .day: return "Last 24 hours"
        case .week: return "Last 7 days"
        case .all: return "All loaded entries"
        }
    }

    func includes(_ date: Date, now: Date = Date()) -> Bool {
        switch self {
        case .hour:
            return date >= now.addingTimeInterval(-3_600)
        case .day:
            return date >= now.addingTimeInterval(-86_400)
        case .week:
            return date >= now.addingTimeInterval(-604_800)
        case .all:
            return true
        }
    }
}
