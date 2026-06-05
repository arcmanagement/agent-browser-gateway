import SwiftUI
import AppKit
import GatewayCore

struct GatewayWindowView: View {
    @ObservedObject var coordinator: GatewayCoordinator
    @State private var searchText = ""
    @State private var selectedFilter: PluginFilter = .all
    @State private var selectedPluginID: String?
    @AppStorage("pluginBrowserAppearance") private var appearanceRawValue = PluginBrowserAppearance.system.rawValue

    var body: some View {
        HStack(spacing: 0) {
            sidebar
                .frame(width: 230)

            Divider()

            pluginList
                .frame(width: 330)

            Divider()

            pluginDetail
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .frame(minWidth: 820, minHeight: 560)
        .background(Color(nsColor: .windowBackgroundColor))
        .preferredColorScheme(selectedAppearance.colorScheme)
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 18) {
            runtimeBadge

            VStack(alignment: .leading, spacing: 6) {
                SidebarItem(
                    title: "Plugins",
                    subtitle: "\(coordinator.pluginSummaries.count) loaded",
                    symbol: "puzzlepiece.extension",
                    isSelected: true
                )
                SidebarItem(
                    title: "Shared Tabs",
                    subtitle: "\(coordinator.permittedTabs.count) active",
                    symbol: "rectangle.stack.badge.person.crop",
                    isSelected: false
                )
            }

            Divider()

            VStack(alignment: .leading, spacing: 8) {
                Text("Filters")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.secondary)

                ForEach(PluginFilter.allCases) { filter in
                    Button {
                        selectedFilter = filter
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: filter.symbol)
                                .frame(width: 18)
                            Text(filter.title)
                            Spacer(minLength: 0)
                            Text("\(count(for: filter))")
                                .font(.system(size: 11, weight: .bold, design: .monospaced))
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, minHeight: 30, alignment: .leading)
                    }
                    .buttonStyle(PluginSidebarButtonStyle(isSelected: selectedFilter == filter))
                }
            }

            Divider()

            VStack(alignment: .leading, spacing: 8) {
                Text("Appearance")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.secondary)

                Picker("Appearance", selection: appearanceBinding) {
                    ForEach(PluginBrowserAppearance.allCases) { appearance in
                        Text(appearance.title).tag(appearance)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
            }

            Spacer(minLength: 0)

            VStack(alignment: .leading, spacing: 7) {
                Label("\(ABGConstants.wsHost):\(ABGConstants.wsPort)", systemImage: "network")
                Label(ABGConstants.runtimeProfileLabel, systemImage: "shippingbox")
            }
            .font(.system(size: 11, weight: .medium, design: .monospaced))
            .foregroundStyle(.secondary)
        }
        .padding(20)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(.ultraThinMaterial)
    }

    private var runtimeBadge: some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(Color.blue.opacity(0.13))
                Image(systemName: "shield.lefthalf.filled")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(.blue)
            }
            .frame(width: 42, height: 42)

            VStack(alignment: .leading, spacing: 3) {
                Text("Agent Browser Gateway")
                    .font(.system(size: 13, weight: .semibold))
                    .lineLimit(1)
                Text(ABGConstants.runtimeProfileLabel.uppercased())
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .foregroundStyle(runtimeProfileColor)
            }

            Spacer(minLength: 0)
        }
    }

    private var pluginList: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Text("Plugins")
                    .font(.system(size: 22, weight: .semibold))
                Spacer(minLength: 0)
                Button {
                    reloadPlugins()
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .frame(width: 28, height: 28)
                }
                .buttonStyle(.plain)
                .help("Reload plugins")
            }

            searchField

            Picker("Filter", selection: $selectedFilter) {
                ForEach(PluginFilter.allCases) { filter in
                    Text(filter.title).tag(filter)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()

            if filteredPlugins.isEmpty {
                WindowEmptyState(
                    symbol: "magnifyingglass",
                    title: "No plugins found",
                    detail: "Try another filter or search term."
                )
                Spacer(minLength: 0)
            } else {
                ScrollView {
                    LazyVStack(spacing: 6) {
                        ForEach(filteredPlugins) { plugin in
                            PluginListRow(
                                plugin: plugin,
                                source: source(for: plugin),
                                isSelected: selectedPlugin?.id == plugin.id
                            ) {
                                selectedPluginID = plugin.id
                            }
                        }
                    }
                    .padding(.vertical, 2)
                }
            }
        }
        .padding(20)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(.regularMaterial)
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.secondary)
            TextField("Search plugins", text: $searchText)
                .textFieldStyle(.plain)
            if !searchText.isEmpty {
                Button {
                    searchText = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(Color.secondary.opacity(0.10))
        )
    }

    @ViewBuilder
    private var pluginDetail: some View {
        if let plugin = selectedPlugin {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    detailHeader(plugin)
                    summaryGrid(plugin)
                    descriptionSection(plugin)
                    commandsSection(plugin)
                    domainsSection(plugin)
                    transformsSection(plugin)
                    pathSection(plugin)
                }
                .padding(28)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(Color(nsColor: .windowBackgroundColor))
        } else {
            WindowEmptyState(
                symbol: "puzzlepiece.extension",
                title: "No plugin selected",
                detail: "Loaded plugins will appear here."
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func detailHeader(_ plugin: PluginHost.PluginSummary) -> some View {
        HStack(alignment: .top, spacing: 16) {
            PluginIcon(name: plugin.name, size: 56)

            VStack(alignment: .leading, spacing: 7) {
                HStack(spacing: 8) {
                    Text(plugin.name)
                        .font(.system(size: 28, weight: .semibold))
                        .lineLimit(1)
                    SourceBadge(source: source(for: plugin))
                }

                HStack(spacing: 8) {
                    if let author = plugin.author, !author.isEmpty {
                        Label(author, systemImage: "person.crop.circle")
                    }
                    if let version = plugin.version, !version.isEmpty {
                        Label(version, systemImage: "number")
                    }
                }
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(.secondary)
            }

            Spacer(minLength: 0)

            Button {
                copy(plugin.name)
            } label: {
                Label("Copy name", systemImage: "doc.on.doc")
            }
            .buttonStyle(PluginPrimaryButtonStyle())
        }
    }

    private func summaryGrid(_ plugin: PluginHost.PluginSummary) -> some View {
        LazyVGrid(columns: [
            GridItem(.adaptive(minimum: 140), spacing: 10),
        ], spacing: 10) {
            PluginStat(title: "Commands", value: "\(plugin.registeredCommands.count)", symbol: "terminal")
            PluginStat(title: "Transforms", value: "\(plugin.transforms.count)", symbol: "wand.and.stars")
            PluginStat(title: "Domains", value: "\(plugin.domains.count)", symbol: "globe")
            PluginStat(title: "Source", value: source(for: plugin).title, symbol: source(for: plugin).symbol)
        }
    }

    @ViewBuilder
    private func descriptionSection(_ plugin: PluginHost.PluginSummary) -> some View {
        if let description = plugin.description, !description.isEmpty {
            PluginSection(title: "Description", symbol: "text.alignleft") {
                Text(description)
                    .font(.system(size: 14, weight: .regular))
                    .foregroundStyle(.primary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func commandsSection(_ plugin: PluginHost.PluginSummary) -> some View {
        PluginSection(title: "Commands", symbol: "terminal") {
            if plugin.commands.isEmpty && plugin.registeredCommands.isEmpty {
                Text("No commands")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.secondary)
            } else {
                VStack(spacing: 8) {
                    ForEach(commandRows(plugin)) { command in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(spacing: 8) {
                                Text(command.name)
                                    .font(.system(size: 13, weight: .semibold, design: .monospaced))
                                Spacer(minLength: 0)
                                Button {
                                    copy("\(plugin.name) \(command.name)")
                                } label: {
                                    Image(systemName: "doc.on.doc")
                                        .frame(width: 24, height: 24)
                                }
                                .buttonStyle(.plain)
                                .foregroundStyle(.secondary)
                            }

                            if let description = command.description, !description.isEmpty {
                                Text(description)
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(.secondary)
                                    .fixedSize(horizontal: false, vertical: true)
                            }

                            if !command.args.isEmpty {
                                FlowLayout(spacing: 6) {
                                    ForEach(command.args, id: \.self) { arg in
                                        PluginChip(text: arg, color: .blue)
                                    }
                                }
                            }
                        }
                        .padding(10)
                        .background(PluginRowBackground())
                    }
                }
            }
        }
    }

    private func domainsSection(_ plugin: PluginHost.PluginSummary) -> some View {
        PluginSection(title: "Domains", symbol: "globe") {
            if plugin.domains.isEmpty {
                Text("No domain bindings")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.secondary)
            } else {
                FlowLayout(spacing: 7) {
                    ForEach(plugin.domains, id: \.self) { domain in
                        PluginChip(text: domain, color: .green)
                    }
                }
            }
        }
    }

    private func transformsSection(_ plugin: PluginHost.PluginSummary) -> some View {
        PluginSection(title: "Transforms", symbol: "wand.and.stars") {
            if plugin.transforms.isEmpty {
                Text("No transforms")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.secondary)
            } else {
                FlowLayout(spacing: 7) {
                    ForEach(plugin.transforms, id: \.self) { transform in
                        PluginChip(text: transform, color: .purple)
                    }
                }
            }
        }
    }

    private func pathSection(_ plugin: PluginHost.PluginSummary) -> some View {
        PluginSection(title: "Location", symbol: "folder") {
            HStack(spacing: 10) {
                Text(plugin.path)
                    .font(.system(size: 12, weight: .medium, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .textSelection(.enabled)

                Spacer(minLength: 0)

                Button {
                    NSWorkspace.shared.selectFile(plugin.path, inFileViewerRootedAtPath: "")
                } label: {
                    Image(systemName: "arrow.up.forward.app")
                        .frame(width: 26, height: 26)
                }
                .buttonStyle(.plain)
                .help("Reveal in Finder")

                Button {
                    copy(plugin.path)
                } label: {
                    Image(systemName: "doc.on.doc")
                        .frame(width: 26, height: 26)
                }
                .buttonStyle(.plain)
                .help("Copy path")
            }
        }
    }

    private var filteredPlugins: [PluginHost.PluginSummary] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        return coordinator.pluginSummaries
            .filter { selectedFilter.matches(source(for: $0)) }
            .filter { plugin in
                guard !query.isEmpty else { return true }
                return searchableText(plugin).localizedCaseInsensitiveContains(query)
            }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    private var selectedPlugin: PluginHost.PluginSummary? {
        if let selectedPluginID,
           let plugin = filteredPlugins.first(where: { $0.id == selectedPluginID }) {
            return plugin
        }
        return filteredPlugins.first
    }

    private func count(for filter: PluginFilter) -> Int {
        coordinator.pluginSummaries.filter { filter.matches(source(for: $0)) }.count
    }

    private func source(for plugin: PluginHost.PluginSummary) -> PluginSource {
        let path = URL(fileURLWithPath: plugin.path).standardizedFileURL.path
        let userPluginsPath = ABGConstants.userPluginsDir.standardizedFileURL.path
        if path == userPluginsPath || path.hasPrefix(userPluginsPath + "/") {
            return .user
        }
        if path.contains("/Contents/Resources/plugins/") || path.contains("/agent-browser-gateway/plugins/") {
            return .bundled
        }
        return .local
    }

    private func searchableText(_ plugin: PluginHost.PluginSummary) -> String {
        [
            plugin.name,
            plugin.author ?? "",
            plugin.description ?? "",
            plugin.path,
            plugin.domains.joined(separator: " "),
            plugin.transforms.joined(separator: " "),
            plugin.registeredCommands.joined(separator: " "),
        ].joined(separator: " ")
    }

    private func commandRows(_ plugin: PluginHost.PluginSummary) -> [PluginHost.CommandSummary] {
        if !plugin.commands.isEmpty { return plugin.commands }
        return plugin.registeredCommands.map {
            PluginHost.CommandSummary(id: "\(plugin.name).\($0)", name: $0, description: nil, args: [])
        }
    }

    private func reloadPlugins() {
        let _ = coordinator.pluginHost.reload()
        coordinator.pluginSummaries = coordinator.pluginHost.loadedPluginSummaryModels()
    }

    private func copy(_ value: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(value, forType: .string)
    }

    private var runtimeProfileColor: Color {
        ABGConstants.runtimeProfile == nil ? .secondary : .orange
    }

    private var selectedAppearance: PluginBrowserAppearance {
        PluginBrowserAppearance(rawValue: appearanceRawValue) ?? .system
    }

    private var appearanceBinding: Binding<PluginBrowserAppearance> {
        Binding(
            get: { selectedAppearance },
            set: { appearanceRawValue = $0.rawValue }
        )
    }
}

private enum PluginBrowserAppearance: String, CaseIterable, Identifiable {
    case system
    case light
    case dark

    var id: String { rawValue }

    var title: String {
        switch self {
        case .system: return "System"
        case .light: return "Light"
        case .dark: return "Dark"
        }
    }

    var colorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }
}

private enum PluginFilter: String, CaseIterable, Identifiable {
    case all
    case bundled
    case user
    case local

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: return "All"
        case .bundled: return "Built-in"
        case .user: return "User Plugins"
        case .local: return "Local Dev"
        }
    }

    var symbol: String {
        switch self {
        case .all: return "square.grid.2x2"
        case .bundled: return "shippingbox"
        case .user: return "person.crop.circle"
        case .local: return "hammer"
        }
    }

    func matches(_ source: PluginSource) -> Bool {
        switch self {
        case .all: return true
        case .bundled: return source == .bundled
        case .user: return source == .user
        case .local: return source == .local
        }
    }
}

private enum PluginSource {
    case bundled
    case user
    case local

    var title: String {
        switch self {
        case .bundled: return "Built-in"
        case .user: return "User Plugins"
        case .local: return "Local Dev"
        }
    }

    var symbol: String {
        switch self {
        case .bundled: return "shippingbox"
        case .user: return "person.crop.circle"
        case .local: return "hammer"
        }
    }

    var color: Color {
        switch self {
        case .bundled: return .blue
        case .user: return .green
        case .local: return .orange
        }
    }
}

private struct SidebarItem: View {
    let title: String
    let subtitle: String
    let symbol: String
    let isSelected: Bool

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: symbol)
                .font(.system(size: 15, weight: .semibold))
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 14, weight: .semibold))
                    .lineLimit(1)
                Text(subtitle)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(isSelected ? Color.blue.opacity(0.16) : Color.clear)
        )
    }
}

private struct PluginListRow: View {
    let plugin: PluginHost.PluginSummary
    let source: PluginSource
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 11) {
                PluginIcon(name: plugin.name, size: 34)

                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Text(plugin.name)
                            .font(.system(size: 14, weight: .semibold))
                            .lineLimit(1)
                        SourceBadge(source: source)
                    }

                    Text(plugin.description ?? "No description")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer(minLength: 0)
            }
            .padding(10)
            .frame(maxWidth: .infinity, minHeight: 58, alignment: .leading)
        }
        .buttonStyle(PluginListButtonStyle(isSelected: isSelected))
    }
}

private struct PluginIcon: View {
    let name: String
    let size: CGFloat

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(iconColor.opacity(0.16))
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(Color.white.opacity(0.16), lineWidth: 1)
                )
            Image(systemName: symbol)
                .font(.system(size: size * 0.42, weight: .semibold))
                .foregroundStyle(iconColor)
        }
        .frame(width: size, height: size)
    }

    private var symbol: String {
        switch name {
        case "gmail": return "envelope.fill"
        case "slack": return "message.fill"
        case "linear": return "list.bullet.rectangle"
        case "redaction": return "shield.lefthalf.filled"
        case "workflow": return "arrow.triangle.branch"
        case "notion-plugin": return "doc.richtext"
        case "markdown-plugin": return "text.alignleft"
        default: return "puzzlepiece.extension.fill"
        }
    }

    private var iconColor: Color {
        switch name {
        case "gmail": return .red
        case "slack": return .green
        case "linear": return .purple
        case "redaction": return .orange
        case "workflow": return .blue
        case "notion-plugin": return .primary
        case "markdown-plugin": return .cyan
        default: return .secondary
        }
    }
}

private struct SourceBadge: View {
    let source: PluginSource

    var body: some View {
        Text(source.title.uppercased())
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(source.color)
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .background(
                Capsule(style: .continuous)
                    .fill(source.color.opacity(0.12))
            )
    }
}

private struct PluginStat: View {
    let title: String
    let value: String
    let symbol: String

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: symbol)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.blue)
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 2) {
                Text(value)
                    .font(.system(size: 16, weight: .semibold, design: .monospaced))
                    .lineLimit(1)
                Text(title)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(PluginRowBackground())
    }
}

private struct PluginSection<Content: View>: View {
    let title: String
    let symbol: String
    let content: Content

    init(title: String, symbol: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.symbol = symbol
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(title, systemImage: symbol)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.secondary)
            content
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(PluginRowBackground())
    }
}

private struct PluginChip: View {
    let text: String
    let color: Color

    var body: some View {
        Text(text)
            .font(.system(size: 12, weight: .semibold, design: .monospaced))
            .foregroundStyle(color)
            .lineLimit(1)
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(
                Capsule(style: .continuous)
                    .fill(color.opacity(0.11))
            )
    }
}

private struct WindowEmptyState: View {
    let symbol: String
    let title: String
    let detail: String

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: symbol)
                .font(.system(size: 26, weight: .semibold))
                .foregroundStyle(.secondary)
            Text(title)
                .font(.system(size: 15, weight: .semibold))
            Text(detail)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(.secondary)
        }
        .padding(24)
    }
}

private struct PluginRowBackground: View {
    var body: some View {
        RoundedRectangle(cornerRadius: 8, style: .continuous)
            .fill(.thinMaterial)
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(Color.white.opacity(0.13), lineWidth: 1)
            )
    }
}

private struct PluginSidebarButtonStyle: ButtonStyle {
    let isSelected: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(isSelected ? .primary : .secondary)
            .padding(.horizontal, 9)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(isSelected ? Color.blue.opacity(0.14) : Color.clear)
            )
    }
}

private struct PluginListButtonStyle: ButtonStyle {
    let isSelected: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .contentShape(Rectangle())
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(backgroundColor(configuration: configuration))
                    .overlay(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .stroke(isSelected ? Color.blue.opacity(0.45) : Color.white.opacity(0.10), lineWidth: 1)
                    )
            )
    }

    private func backgroundColor(configuration: Configuration) -> Color {
        if configuration.isPressed { return Color.blue.opacity(0.22) }
        if isSelected { return Color.blue.opacity(0.16) }
        return Color.secondary.opacity(0.08)
    }
}

private struct PluginPrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(.blue)
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(configuration.isPressed ? Color.blue.opacity(0.20) : Color.blue.opacity(0.12))
            )
    }
}

private struct FlowLayout: Layout {
    let spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        layout(in: proposal.width ?? 640, subviews: subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = layout(in: bounds.width, subviews: subviews)
        for item in result.items {
            subviews[item.index].place(
                at: CGPoint(x: bounds.minX + item.frame.minX, y: bounds.minY + item.frame.minY),
                proposal: ProposedViewSize(item.frame.size)
            )
        }
    }

    private func layout(in width: CGFloat, subviews: Subviews) -> (items: [(index: Int, frame: CGRect)], size: CGSize) {
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var items: [(index: Int, frame: CGRect)] = []
        let availableWidth = max(width, 1)

        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            if x > 0, x + size.width > availableWidth {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            items.append((index, CGRect(origin: CGPoint(x: x, y: y), size: size)))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }

        return (items, CGSize(width: availableWidth, height: y + rowHeight))
    }
}
