import SwiftUI

/// A plain menu-item row ("Sound Settings…" style): full width, native-like hover
/// highlight, no icon.
struct MenuActionRow: View {
    var title: String
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .lineLimit(1)
        }
        .buttonStyle(MenuRowButtonStyle())
    }
}

private struct MenuRowButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        MenuRowBody(configuration: configuration)
    }
}

private struct MenuRowBody: View {
    let configuration: ButtonStyleConfiguration
    @State private var isHovered = false

    var body: some View {
        configuration.label
            .font(.body)
            .padding(.horizontal, 9)
            .frame(maxWidth: .infinity, minHeight: 26, alignment: .leading)
            .background {
                RoundedRectangle(cornerRadius: 6)
                    .fill(isHovered || configuration.isPressed ? Color.primary.opacity(0.08) : .clear)
            }
            .contentShape(Rectangle())
            .onHover { isHovered = $0 }
    }
}
