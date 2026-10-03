import SwiftUI

/// "All" plus one tab per connected extension, in the style of a popover filter bar.
/// Scrolls horizontally when several browser profiles are connected.
struct ExtensionSwitcher: View {
    struct Option: Identifiable, Equatable {
        let id: String
        let title: String
        let sharedCount: Int
    }

    var options: [Option]
    @Binding var selection: String?

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 2) {
                SwitcherPill(
                    title: "All",
                    count: options.reduce(0) { $0 + $1.sharedCount },
                    isSelected: selection == nil
                ) {
                    selection = nil
                }
                ForEach(options) { option in
                    SwitcherPill(
                        title: option.title,
                        count: option.sharedCount,
                        isSelected: selection == option.id
                    ) {
                        selection = option.id
                    }
                }
            }
            .padding(.horizontal, 4)
        }
        .scrollIndicators(.hidden)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Browser extensions")
    }
}

private struct SwitcherPill: View {
    var title: String
    var count: Int
    var isSelected: Bool
    var action: () -> Void

    @State private var isHovered = false
    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Text(title)
                    .lineLimit(1)
                Text(verbatim: "\(count)")
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            }
            .font(.callout.weight(isSelected ? .semibold : .regular))
            .foregroundStyle(isSelected ? .primary : .secondary)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background {
                RoundedRectangle(cornerRadius: 7)
                    .fill(fill)
                    .overlay {
                        if isSelected {
                            RoundedRectangle(cornerRadius: 7)
                                .strokeBorder(Color.primary.opacity(contrast == .increased ? 0.6 : 0.22), lineWidth: 1)
                        }
                    }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { isHovered = $0 }
        .accessibilityLabel("\(title), \(GateText.tabs(count)) shared")
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }

    private var fill: Color {
        if isSelected { return Color.primary.opacity(0.1) }
        return isHovered ? Color.primary.opacity(0.06) : .clear
    }
}
