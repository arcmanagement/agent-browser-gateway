import SwiftUI
import AppKit
import GatewayCore

struct GatewayWindowView: View {
    @ObservedObject var coordinator: GatewayCoordinator
    @State private var selectedSection: GatewayWindowSection = .plugins
    @State private var searchText = ""
    @State private var selectedFilter: PluginFilter = .all
    @State private var selectedPluginID: String?
    @State private var auditSearchText = ""
    @State private var auditEntries: [AuditLogViewEntry] = []
    @State private var selectedAuditID: String?
    @State private var auditCommandFilter = AuditLogViewEntry.allFilterValue
    @State private var auditTabFilter = AuditLogViewEntry.allFilterValue
    @State private var auditTimeFilter: AuditTimeFilter = .day
    @State private var auditLoadError: String?
    @State private var isAuditReloading = false
    @State private var gatewaySettings = GatewaySettingsStore.load()
    @State private var settingsMessage: String?
    @State private var settingsError: String?
    @State private var newPolicyDomain = ""
    @State private var newPolicyAction: GatewayDomainPolicyAction = .ask
    @State private var newPolicyApprovalMode: GatewayApprovalMode = .extensionPopup
    @State private var newPolicyTimeoutMs = GatewaySettings.defaultTimeoutMs
    @State private var newPolicyAppliesToSubdomains = true
    @State private var isInstallSheetPresented = false
    @State private var pluginOperation: PluginManagementOperation?
    @State private var pluginManagementMessage: String?
    @State private var pluginManagementAlert: PluginManagementAlert?
    @AppStorage("pluginBrowserAppearance") private var appearanceRawValue = PluginBrowserAppearance.system.rawValue

    private static let auditEntryLoadLimit = 500

    var body: some View {
        HStack(spacing: 0) {
            sidebar
                .frame(width: 230)

            Divider()

            if selectedSection == .plugins {
                pluginList
                    .frame(width: 330)

                Divider()

                pluginDetail
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if selectedSection == .audit {
                auditList
                    .frame(width: 390)

                Divider()

                auditDetail
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                settingsDetail
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(minWidth: 820, minHeight: 560)
        .background(Color(nsColor: .windowBackgroundColor))
        .preferredColorScheme(selectedAppearance.colorScheme)
        .sheet(isPresented: $isInstallSheetPresented) {
            PluginInstallSheet { source, name, force in
                try await installPlugin(source: source, name: name, force: force)
            }
        }
        .alert(item: $pluginManagementAlert) { alert in
            switch alert {
            case .confirmUninstall(let plugin):
                Alert(
                    title: Text("Uninstall Plugin"),
                    message: Text("Remove \(plugin.name) from the active ABG user plugin directory? This cannot remove built-in or external local plugins."),
                    primaryButton: .destructive(Text("Uninstall")) {
                        Task { await uninstallUserPlugin(plugin) }
                    },
                    secondaryButton: .cancel()
                )
            case .error(let message):
                Alert(
                    title: Text("Plugin Management Failed"),
                    message: Text(message),
                    dismissButton: .default(Text("OK"))
                )
            }
        }
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 18) {
            runtimeBadge

            VStack(alignment: .leading, spacing: 6) {
                Button {
                    selectedSection = .plugins
                } label: {
                    SidebarItem(
                        title: "Plugins",
                        subtitle: "\(loadedPluginCount) loaded",
                        symbol: "puzzlepiece.extension",
                        isSelected: selectedSection == .plugins
                    )
                }
                .buttonStyle(.plain)

                Button {
                    selectedSection = .audit
                    reloadAuditEntries()
                } label: {
                    SidebarItem(
                        title: "Audit",
                        subtitle: auditSidebarSubtitle,
                        symbol: "list.bullet.rectangle.portrait",
                        isSelected: selectedSection == .audit
                    )
                }
                .buttonStyle(.plain)

                Button {
                    selectedSection = .settings
                    reloadGatewaySettings()
                } label: {
                    SidebarItem(
                        title: "Settings",
                        subtitle: "\(gatewaySettings.domainPolicies.count) policies",
                        symbol: "gearshape",
                        isSelected: selectedSection == .settings
                    )
                }
                .buttonStyle(.plain)

                SidebarItem(
                    title: "Shared Tabs",
                    subtitle: "\(coordinator.permittedTabs.count) active",
                    symbol: "rectangle.stack.badge.person.crop",
                    isSelected: false
                )
            }

            Divider()

            if selectedSection == .plugins {
                pluginFilterSection
            } else if selectedSection == .audit {
                auditFilterSection
            } else {
                settingsSidebarSection
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
                Label {
                    Text(verbatim: gatewayEndpointText)
                } icon: {
                    Image(systemName: "network")
                }
                Label(ABGConstants.runtimeProfileLabel, systemImage: "shippingbox")
            }
            .font(.system(size: 11, weight: .medium, design: .monospaced))
            .foregroundStyle(.secondary)
        }
        .padding(20)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(.ultraThinMaterial)
    }

    private var pluginFilterSection: some View {
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
    }

    private var auditFilterSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Audit Filters")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(.secondary)

            Picker("Time", selection: $auditTimeFilter) {
                ForEach(AuditTimeFilter.allCases) { filter in
                    Text(filter.title).tag(filter)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()

            Picker("Command", selection: $auditCommandFilter) {
                Text("All Commands").tag(AuditLogViewEntry.allFilterValue)
                ForEach(auditCommandOptions, id: \.self) { command in
                    Text(command).tag(command)
                }
            }
            .labelsHidden()

            Picker("Tab", selection: $auditTabFilter) {
                Text("All Tabs").tag(AuditLogViewEntry.allFilterValue)
                ForEach(auditTabOptions, id: \.self) { tab in
                    Text(tab).tag(tab)
                }
            }
            .labelsHidden()
        }
    }

    private var settingsSidebarSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Runtime Defaults")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(.secondary)

            HStack(spacing: 7) {
                PluginChip(text: "\(gatewaySettings.defaultTimeoutMs / 1000)s", color: .blue)
                PluginChip(text: gatewaySettings.approvalModeDefault.title, color: .green)
            }

            VStack(alignment: .leading, spacing: 7) {
                Label(GatewaySettingsStore.settingsFile().deletingLastPathComponent().path, systemImage: "folder")
                    .lineLimit(2)
                Label(settingsFileIsOwnerOnly ? "0600 local" : "local file", systemImage: "lock.doc")
            }
            .font(.system(size: 11, weight: .medium, design: .monospaced))
            .foregroundStyle(.secondary)
        }
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
                    isInstallSheetPresented = true
                } label: {
                    Image(systemName: "plus")
                        .frame(width: 28, height: 28)
                }
                .buttonStyle(.plain)
                .help("Install plugin")
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

    private var auditList: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Text("Audit")
                    .font(.system(size: 22, weight: .semibold))
                Spacer(minLength: 0)
                Button {
                    reloadAuditEntries()
                } label: {
                    Group {
                        if isAuditReloading {
                            ProgressView()
                                .controlSize(.small)
                        } else {
                            Image(systemName: "arrow.clockwise")
                        }
                    }
                    .frame(width: 28, height: 28)
                }
                .buttonStyle(.plain)
                .disabled(isAuditReloading)
                .help("Reload audit log")
                Button {
                    NSWorkspace.shared.open(URL(fileURLWithPath: ABGConstants.auditLogPath))
                } label: {
                    Image(systemName: "doc.text.magnifyingglass")
                        .frame(width: 28, height: 28)
                }
                .buttonStyle(.plain)
                .help("Open audit log file")
            }

            auditSearchField

            HStack(spacing: 8) {
                PluginChip(text: "\(filteredAuditEntries.count) shown", color: .blue)
                PluginChip(text: "latest \(auditEntries.count)", color: .secondary)
                PluginChip(text: ownerOnlyModeText, color: .green)
            }

            if let auditLoadError {
                WindowEmptyState(
                    symbol: "exclamationmark.triangle",
                    title: "Audit log unavailable",
                    detail: auditLoadError
                )
                Spacer(minLength: 0)
            } else if filteredAuditEntries.isEmpty {
                WindowEmptyState(
                    symbol: "doc.text.magnifyingglass",
                    title: "No audit entries",
                    detail: "Try another filter or reload the audit log."
                )
                Spacer(minLength: 0)
            } else {
                ScrollView {
                    LazyVStack(spacing: 6) {
                        ForEach(filteredAuditEntries) { entry in
                            AuditLogListRow(
                                entry: entry,
                                isSelected: selectedAuditEntry?.id == entry.id
                            ) {
                                selectedAuditID = entry.id
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
        .onAppear(perform: reloadAuditEntries)
    }

    private var auditSearchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.secondary)
            TextField("Search audit", text: $auditSearchText)
                .textFieldStyle(.plain)
            if !auditSearchText.isEmpty {
                Button {
                    auditSearchText = ""
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
                    managementSection(plugin)
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

    @ViewBuilder
    private var auditDetail: some View {
        if let entry = selectedAuditEntry {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    auditDetailHeader(entry)
                    auditSummaryGrid(entry)
                    if !entry.auditDiffPreview.isEmpty {
                        PluginSection(title: "Audit Diff", symbol: "text.badge.checkmark") {
                            VStack(alignment: .leading, spacing: 7) {
                                ForEach(entry.auditDiffPreview, id: \.self) { line in
                                    Text(line)
                                        .font(.system(size: 12, weight: .medium, design: .monospaced))
                                        .foregroundStyle(line.hasPrefix("+") ? .green : line.hasPrefix("-") ? .red : .secondary)
                                        .textSelection(.enabled)
                                }
                            }
                        }
                    }
                    if !entry.detailRows.isEmpty {
                        PluginSection(title: "Details", symbol: "list.bullet.rectangle") {
                            VStack(spacing: 7) {
                                ForEach(entry.detailRows) { row in
                                    HStack(alignment: .top, spacing: 10) {
                                        Text(row.key)
                                            .font(.system(size: 11, weight: .bold, design: .monospaced))
                                            .foregroundStyle(.secondary)
                                            .frame(width: 132, alignment: .leading)
                                        Text(row.value)
                                            .font(.system(size: 12, weight: .medium, design: .monospaced))
                                            .foregroundStyle(.primary)
                                            .textSelection(.enabled)
                                            .lineLimit(5)
                                        Spacer(minLength: 0)
                                    }
                                }
                            }
                        }
                    }
                    if let rawDetails = entry.rawDetails {
                        PluginSection(title: "Raw Details", symbol: "curlybraces") {
                            Text(rawDetails)
                                .font(.system(size: 11, weight: .medium, design: .monospaced))
                                .foregroundStyle(.secondary)
                                .textSelection(.enabled)
                        }
                    }
                    PluginSection(title: "Location", symbol: "lock.doc") {
                        HStack(spacing: 10) {
                            Text(ABGConstants.auditLogPath)
                                .font(.system(size: 12, weight: .medium, design: .monospaced))
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                                .textSelection(.enabled)
                            Spacer(minLength: 0)
                            Button {
                                NSWorkspace.shared.selectFile(ABGConstants.auditLogPath, inFileViewerRootedAtPath: "")
                            } label: {
                                Image(systemName: "arrow.up.forward.app")
                                    .frame(width: 26, height: 26)
                            }
                            .buttonStyle(.plain)
                            .help("Reveal in Finder")
                            Button {
                                copy(ABGConstants.auditLogPath)
                            } label: {
                                Image(systemName: "doc.on.doc")
                                    .frame(width: 26, height: 26)
                            }
                            .buttonStyle(.plain)
                            .help("Copy path")
                        }
                    }
                }
                .padding(28)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(Color(nsColor: .windowBackgroundColor))
        } else {
            WindowEmptyState(
                symbol: "doc.text.magnifyingglass",
                title: "No audit entry selected",
                detail: "Recent local audit entries will appear here."
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var settingsDetail: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                settingsHeader
                settingsSummaryGrid
                settingsDefaultsSection
                settingsDomainPolicySection
                settingsLocationSection
            }
            .padding(28)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color(nsColor: .windowBackgroundColor))
        .onAppear(perform: reloadGatewaySettings)
    }

    private var settingsHeader: some View {
        HStack(alignment: .top, spacing: 16) {
            ZStack {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(Color.blue.opacity(0.13))
                Image(systemName: "gearshape.fill")
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(.blue)
            }
            .frame(width: 56, height: 56)

            VStack(alignment: .leading, spacing: 7) {
                HStack(spacing: 8) {
                    Text("Settings")
                        .font(.system(size: 28, weight: .semibold))
                        .lineLimit(1)
                    PluginStatusBadge(text: ABGConstants.runtimeProfileLabel.uppercased(), color: runtimeProfileColor)
                }
                Text(GatewaySettingsStore.settingsFile().path)
                    .font(.system(size: 12, weight: .medium, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .textSelection(.enabled)
            }

            Spacer(minLength: 0)

            HStack(spacing: 8) {
                Button {
                    reloadGatewaySettings()
                } label: {
                    Label("Reload", systemImage: "arrow.clockwise")
                }
                .buttonStyle(PluginSecondaryButtonStyle())

                Button {
                    saveGatewaySettings()
                } label: {
                    Label("Save", systemImage: "checkmark.circle")
                }
                .buttonStyle(PluginPrimaryButtonStyle())
            }
        }
    }

    private var settingsSummaryGrid: some View {
        LazyVGrid(columns: [
            GridItem(.adaptive(minimum: 140), spacing: 10),
        ], spacing: 10) {
            PluginStat(title: "Timeout", value: "\(gatewaySettings.defaultTimeoutMs / 1000)s", symbol: "timer")
            PluginStat(title: "Approval", value: gatewaySettings.approvalModeDefault.title, symbol: "checkmark.shield")
            PluginStat(title: "Policies", value: "\(gatewaySettings.domainPolicies.count)", symbol: "globe")
            PluginStat(title: "Profile", value: ABGConstants.runtimeProfileLabel, symbol: "shippingbox")
        }
    }

    private var settingsDefaultsSection: some View {
        PluginSection(title: "Defaults", symbol: "slider.horizontal.3") {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 12) {
                        Label("Timeout", systemImage: "timer")
                            .font(.system(size: 13, weight: .semibold))
                        Spacer(minLength: 0)
                        TextField("30000", value: defaultTimeoutBinding, format: .number)
                            .textFieldStyle(.roundedBorder)
                            .font(.system(size: 12, weight: .medium, design: .monospaced))
                            .frame(width: 92)
                        Stepper("Timeout", value: defaultTimeoutBinding, in: timeoutRange, step: 1_000)
                            .labelsHidden()
                    }

                    FlowLayout(spacing: 7) {
                        PluginChip(text: "\(GatewaySettings.minimumTimeoutMs / 1000)s min", color: .secondary)
                        PluginChip(text: "\(GatewaySettings.maximumTimeoutMs / 1000)s max", color: .secondary)
                        PluginChip(text: "milliseconds", color: .blue)
                    }
                }

                Divider()

                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 12) {
                        Label("Approval Default", systemImage: "checkmark.shield")
                            .font(.system(size: 13, weight: .semibold))
                        Spacer(minLength: 0)
                        Picker("Approval Default", selection: $gatewaySettings.approvalModeDefault) {
                            ForEach(GatewayApprovalMode.allCases) { mode in
                                Text(mode.title).tag(mode)
                            }
                        }
                        .labelsHidden()
                        .frame(width: 210)
                    }

                    Text(gatewaySettings.approvalModeDefault.detail)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                settingsFeedback
            }
        }
    }

    private var settingsDomainPolicySection: some View {
        PluginSection(title: "Domain Policies", symbol: "globe.badge.chevron.backward") {
            VStack(alignment: .leading, spacing: 12) {
                if gatewaySettings.domainPolicies.isEmpty {
                    Text("No domain defaults")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(.secondary)
                } else {
                    VStack(spacing: 8) {
                        ForEach(gatewaySettings.domainPolicies) { policy in
                            domainPolicyRow(policy)
                        }
                    }
                }

                Divider()

                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 10) {
                        TextField("example.com", text: $newPolicyDomain)
                            .textFieldStyle(.roundedBorder)
                            .font(.system(size: 13, weight: .medium, design: .monospaced))
                            .onSubmit(addDomainPolicy)

                        Picker("Action", selection: $newPolicyAction) {
                            ForEach(GatewayDomainPolicyAction.allCases) { action in
                                Text(action.title).tag(action)
                            }
                        }
                        .labelsHidden()
                        .frame(width: 120)

                        Picker("Mode", selection: $newPolicyApprovalMode) {
                            ForEach(GatewayApprovalMode.allCases) { mode in
                                Text(mode.title).tag(mode)
                            }
                        }
                        .labelsHidden()
                        .frame(width: 170)
                    }

                    HStack(spacing: 10) {
                        Toggle("Subdomains", isOn: $newPolicyAppliesToSubdomains)
                            .toggleStyle(.checkbox)

                        Spacer(minLength: 0)

                        TextField("30000", value: newPolicyTimeoutBinding, format: .number)
                            .textFieldStyle(.roundedBorder)
                            .font(.system(size: 12, weight: .medium, design: .monospaced))
                            .frame(width: 92)

                        Stepper("Policy Timeout", value: newPolicyTimeoutBinding, in: timeoutRange, step: 1_000)
                            .labelsHidden()

                        Button {
                            addDomainPolicy()
                        } label: {
                            Label("Add", systemImage: "plus")
                        }
                        .buttonStyle(PluginPrimaryButtonStyle())
                        .disabled(!canAddDomainPolicy)
                    }
                }
            }
        }
    }

    private var settingsLocationSection: some View {
        PluginSection(title: "Location", symbol: "lock.doc") {
            HStack(spacing: 10) {
                Text(GatewaySettingsStore.settingsFile().path)
                    .font(.system(size: 12, weight: .medium, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .textSelection(.enabled)

                Spacer(minLength: 0)

                PluginChip(text: settingsFileIsOwnerOnly ? "0600 local" : "local file", color: settingsFileIsOwnerOnly ? .green : .secondary)

                Button {
                    NSWorkspace.shared.selectFile(GatewaySettingsStore.settingsFile().path, inFileViewerRootedAtPath: "")
                } label: {
                    Image(systemName: "arrow.up.forward.app")
                        .frame(width: 26, height: 26)
                }
                .buttonStyle(.plain)
                .help("Reveal in Finder")

                Button {
                    copy(GatewaySettingsStore.settingsFile().path)
                } label: {
                    Image(systemName: "doc.on.doc")
                        .frame(width: 26, height: 26)
                }
                .buttonStyle(.plain)
                .help("Copy path")
            }
        }
    }

    @ViewBuilder
    private var settingsFeedback: some View {
        if let settingsError {
            Label(settingsError, systemImage: "exclamationmark.triangle")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(.red)
                .fixedSize(horizontal: false, vertical: true)
        } else if let settingsMessage {
            Label(settingsMessage, systemImage: "checkmark.circle")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(.green)
        }
    }

    private func domainPolicyRow(_ policy: GatewayDomainPolicy) -> some View {
        HStack(spacing: 11) {
            ZStack {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(Color.green.opacity(0.14))
                Image(systemName: "globe")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.green)
            }
            .frame(width: 34, height: 34)

            VStack(alignment: .leading, spacing: 4) {
                Text(policy.domain)
                    .font(.system(size: 14, weight: .semibold, design: .monospaced))
                    .lineLimit(1)
                HStack(spacing: 6) {
                    PluginStatusBadge(text: policy.action.title.uppercased(), color: policyActionColor(policy.action))
                    PluginStatusBadge(text: policy.approvalMode.title.uppercased(), color: .blue)
                    PluginStatusBadge(text: "\(policy.timeoutMs / 1000)S", color: .secondary)
                    if policy.appliesToSubdomains {
                        PluginStatusBadge(text: "SUBDOMAINS", color: .green)
                    }
                }
            }

            Spacer(minLength: 0)

            Button(role: .destructive) {
                removeDomainPolicy(policy)
            } label: {
                Image(systemName: "trash")
                    .frame(width: 26, height: 26)
            }
            .buttonStyle(.plain)
            .foregroundStyle(.red)
            .help("Remove domain policy")
        }
        .padding(10)
        .background(PluginRowBackground())
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
                    if !plugin.isEnabled {
                        PluginStatusBadge(text: "OFF", color: .secondary)
                    }
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
            PluginStat(title: "Status", value: plugin.isEnabled ? "Enabled" : "Disabled", symbol: plugin.isLoaded ? "checkmark.circle" : "pause.circle")
        }
    }

    @ViewBuilder
    private func managementSection(_ plugin: PluginHost.PluginSummary) -> some View {
        if source(for: plugin) == .user {
            PluginSection(title: "Manage", symbol: "gearshape") {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 10) {
                        if plugin.isEnabled {
                            Button {
                                Task { await disableUserPlugin(plugin) }
                            } label: {
                                Label("Disable", systemImage: "pause.circle")
                            }
                            .buttonStyle(PluginSecondaryButtonStyle())
                            .disabled(isOperating(on: plugin))
                            .help("Disable this user plugin without deleting it")
                        } else {
                            Button {
                                Task { await enableUserPlugin(plugin) }
                            } label: {
                                Label("Enable", systemImage: "play.circle")
                            }
                            .buttonStyle(PluginPrimaryButtonStyle())
                            .disabled(isOperating(on: plugin))
                            .help("Enable and reload this user plugin")
                        }

                        Button {
                            Task { await updateUserPlugin(plugin) }
                        } label: {
                            Label("Update", systemImage: "arrow.triangle.2.circlepath")
                        }
                        .buttonStyle(PluginPrimaryButtonStyle())
                        .disabled(!isGitBacked(plugin) || isOperating(on: plugin))
                        .help(isGitBacked(plugin) ? "Update with local git credentials" : "Only git-backed user plugins can be updated")

                        Button(role: .destructive) {
                            pluginManagementAlert = .confirmUninstall(plugin)
                        } label: {
                            Label("Uninstall", systemImage: "trash")
                        }
                        .buttonStyle(PluginDestructiveButtonStyle())
                        .disabled(isOperating(on: plugin))
                        .help("Remove this user plugin from the active ABG profile")

                        Spacer(minLength: 0)
                    }

                    if let pluginOperation, pluginOperation.pluginID == plugin.id {
                        HStack(spacing: 8) {
                            ProgressView()
                                .controlSize(.small)
                            Text(pluginOperation.title)
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(.secondary)
                        }
                    } else if let pluginManagementMessage, selectedPlugin?.id == plugin.id {
                        Label(pluginManagementMessage, systemImage: "checkmark.circle")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(.green)
                    }

                    Text("Managed plugins live in the active ABG user plugin directory. Disabled state is profile-local filesystem state; updates use local git authentication and ABG stores no tokens.")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
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

    private func auditDetailHeader(_ entry: AuditLogViewEntry) -> some View {
        HStack(alignment: .top, spacing: 16) {
            AuditLogIcon(entry: entry, size: 56)

            VStack(alignment: .leading, spacing: 7) {
                HStack(spacing: 8) {
                    Text(entry.command)
                        .font(.system(size: 28, weight: .semibold))
                        .lineLimit(1)
                    PluginStatusBadge(text: entry.outcome.uppercased(), color: entry.outcomeColor)
                }
                Text(entry.timeText)
                    .font(.system(size: 12, weight: .medium, design: .monospaced))
                    .foregroundStyle(.secondary)
                if let url = entry.url {
                    Text(url)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                        .textSelection(.enabled)
                }
            }

            Spacer(minLength: 0)

            Button {
                copy(entry.rawDetails ?? entry.searchBlob)
            } label: {
                Label("Copy details", systemImage: "doc.on.doc")
            }
            .buttonStyle(PluginPrimaryButtonStyle())
        }
    }

    private func auditSummaryGrid(_ entry: AuditLogViewEntry) -> some View {
        LazyVGrid(columns: [
            GridItem(.adaptive(minimum: 140), spacing: 10),
        ], spacing: 10) {
            PluginStat(title: "Action", value: entry.action, symbol: entry.symbol)
            PluginStat(title: "Command", value: entry.command, symbol: "terminal")
            PluginStat(title: "Tab", value: entry.tabDisplay, symbol: "rectangle.on.rectangle")
            PluginStat(title: "Origin", value: entry.origin, symbol: "globe")
            PluginStat(title: "Target", value: entry.selectedTarget, symbol: "scope")
            PluginStat(title: "Result", value: entry.resultSummary, symbol: "checkmark.seal")
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

    private var loadedPluginCount: Int {
        coordinator.pluginSummaries.filter { $0.isLoaded }.count
    }

    private var selectedPlugin: PluginHost.PluginSummary? {
        if let selectedPluginID,
           let plugin = filteredPlugins.first(where: { $0.id == selectedPluginID }) {
            return plugin
        }
        return filteredPlugins.first
    }

    private var filteredAuditEntries: [AuditLogViewEntry] {
        let query = auditSearchText.trimmingCharacters(in: .whitespacesAndNewlines)
        return auditEntries
            .filter { auditTimeFilter.includes($0.timestamp) }
            .filter { auditCommandFilter == AuditLogViewEntry.allFilterValue || $0.command == auditCommandFilter || $0.action == auditCommandFilter }
            .filter { auditTabFilter == AuditLogViewEntry.allFilterValue || $0.tabFilterValue == auditTabFilter }
            .filter { entry in
                guard !query.isEmpty else { return true }
                return entry.searchBlob.localizedCaseInsensitiveContains(query)
            }
    }

    private var selectedAuditEntry: AuditLogViewEntry? {
        if let selectedAuditID,
           let entry = filteredAuditEntries.first(where: { $0.id == selectedAuditID }) {
            return entry
        }
        return filteredAuditEntries.first
    }

    private var auditCommandOptions: [String] {
        Array(Set(auditEntries.flatMap { [$0.command, $0.action] }))
            .filter { !$0.isEmpty }
            .sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
    }

    private var auditTabOptions: [String] {
        Array(Set(auditEntries.map(\.tabFilterValue)))
            .sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
    }

    private var ownerOnlyModeText: String {
        auditLogIsOwnerOnly ? "0600 local" : "local file"
    }

    private var auditSidebarSubtitle: String {
        if auditEntries.isEmpty {
            return "latest entries"
        }
        return "latest \(auditEntries.count)"
    }

    private var auditLogIsOwnerOnly: Bool {
        guard let permissions = try? FileManager.default.attributesOfItem(atPath: ABGConstants.auditLogPath)[.posixPermissions] as? NSNumber else {
            return false
        }
        return permissions.intValue & 0o077 == 0
    }

    private var settingsFileIsOwnerOnly: Bool {
        let path = GatewaySettingsStore.settingsFile().path
        guard FileManager.default.fileExists(atPath: path),
              let permissions = try? FileManager.default.attributesOfItem(atPath: path)[.posixPermissions] as? NSNumber else {
            return false
        }
        return permissions.intValue & 0o077 == 0
    }

    private var timeoutRange: ClosedRange<Int> {
        GatewaySettings.minimumTimeoutMs...GatewaySettings.maximumTimeoutMs
    }

    private var defaultTimeoutBinding: Binding<Int> {
        Binding(
            get: { gatewaySettings.defaultTimeoutMs },
            set: {
                gatewaySettings.defaultTimeoutMs = GatewaySettings.clampedTimeout($0)
                clearSettingsFeedback()
            }
        )
    }

    private var newPolicyTimeoutBinding: Binding<Int> {
        Binding(
            get: { newPolicyTimeoutMs },
            set: { newPolicyTimeoutMs = GatewaySettings.clampedTimeout($0) }
        )
    }

    private var canAddDomainPolicy: Bool {
        GatewaySettings.normalizedDomain(newPolicyDomain) != nil
    }

    private func count(for filter: PluginFilter) -> Int {
        coordinator.pluginSummaries.filter { filter.matches(source(for: $0)) }.count
    }

    private func source(for plugin: PluginHost.PluginSummary) -> PluginSource {
        let pluginURL = URL(fileURLWithPath: plugin.path).standardizedFileURL
        let path = pluginURL.path
        let userPluginsPath = ABGConstants.userPluginsDir.standardizedFileURL.path
        if pluginURL.deletingLastPathComponent().standardizedFileURL.path == userPluginsPath {
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
        coordinator.refreshPluginSummaries()
    }

    private func reloadAuditEntries() {
        guard !isAuditReloading else { return }
        let path = ABGConstants.auditLogPath
        let limit = Self.auditEntryLoadLimit
        isAuditReloading = true
        Task { @MainActor in
            let result = await Task.detached(priority: .userInitiated) {
                AuditLogViewEntry.loadRecent(from: path, limit: limit)
            }.value
            auditEntries = result.entries
            auditLoadError = result.error
            isAuditReloading = false
            if let selectedAuditID,
               !result.entries.contains(where: { $0.id == selectedAuditID }) {
                self.selectedAuditID = nil
            }
        }
    }

    private func reloadGatewaySettings() {
        gatewaySettings = GatewaySettingsStore.load()
        settingsMessage = nil
        settingsError = nil
    }

    private func saveGatewaySettings() {
        do {
            gatewaySettings = gatewaySettings.normalized
            try GatewaySettingsStore.save(gatewaySettings)
            settingsError = nil
            settingsMessage = "Settings saved."
        } catch {
            settingsMessage = nil
            settingsError = error.localizedDescription
        }
    }

    private func addDomainPolicy() {
        guard let domain = GatewaySettings.normalizedDomain(newPolicyDomain) else {
            settingsMessage = nil
            settingsError = "Enter a valid domain."
            return
        }
        let policy = GatewayDomainPolicy(
            domain: domain,
            action: newPolicyAction,
            approvalMode: newPolicyApprovalMode,
            timeoutMs: newPolicyTimeoutMs,
            appliesToSubdomains: newPolicyAppliesToSubdomains
        )
        gatewaySettings.domainPolicies.removeAll { $0.domain == domain }
        gatewaySettings.domainPolicies.append(policy)
        gatewaySettings.domainPolicies = GatewaySettings.normalizedDomainPolicies(gatewaySettings.domainPolicies)
        newPolicyDomain = ""
        newPolicyTimeoutMs = gatewaySettings.defaultTimeoutMs
        clearSettingsFeedback()
    }

    private func policyActionColor(_ action: GatewayDomainPolicyAction) -> Color {
        switch action {
        case .allow:
            return .green
        case .ask:
            return .orange
        case .deny:
            return .red
        }
    }

    private func removeDomainPolicy(_ policy: GatewayDomainPolicy) {
        gatewaySettings.domainPolicies.removeAll { $0.id == policy.id }
        clearSettingsFeedback()
    }

    private func clearSettingsFeedback() {
        settingsMessage = nil
        settingsError = nil
    }

    @MainActor
    private func installPlugin(source: String, name: String?, force: Bool) async throws {
        let result = try await Task.detached(priority: .userInitiated) {
            try ABGPluginInstaller.install(source: source, name: name, force: force)
        }.value

        let reloadResult = coordinator.pluginHost.reload(plugin: result.name)
        let didReload = reloadResult.contains { row in
            (row["status"] as? String) == "reloaded"
        }
        if !didReload, result.installName != result.name {
            _ = coordinator.pluginHost.reload(plugin: result.installName)
        }
        coordinator.refreshPluginSummaries()
        selectedFilter = .all
        selectedPluginID = result.path
    }

    @MainActor
    private func updateUserPlugin(_ plugin: PluginHost.PluginSummary) async {
        guard source(for: plugin) == .user else { return }
        pluginOperation = .updating(plugin.id)
        pluginManagementMessage = nil
        let result = await Task.detached(priority: .userInitiated) {
            ABGPluginInstaller.updatePlugin(at: URL(fileURLWithPath: plugin.path))
        }.value

        pluginOperation = nil
        guard result.status == "updated" else {
            let message = result.error ?? result.reason ?? "Plugin update failed."
            pluginManagementAlert = .error(message)
            return
        }
        if plugin.isEnabled {
            reloadLoadedPlugin(plugin)
        }
        coordinator.refreshPluginSummaries()
        selectedPluginID = plugin.id
        if !plugin.isEnabled {
            pluginManagementMessage = "Plugin updated while disabled."
        } else {
            pluginManagementMessage = result.output?.isEmpty == false ? result.output : "Plugin is up to date."
        }
    }

    @MainActor
    private func enableUserPlugin(_ plugin: PluginHost.PluginSummary) async {
        guard source(for: plugin) == .user else { return }
        pluginOperation = .enabling(plugin.id)
        pluginManagementMessage = nil
        do {
            _ = try await Task.detached(priority: .userInitiated) {
                try ABGPluginStateStore.enable(at: URL(fileURLWithPath: plugin.path))
            }.value
            reloadLoadedPlugin(plugin)
            coordinator.refreshPluginSummaries()
            selectedPluginID = plugin.id
            pluginManagementMessage = "Plugin enabled."
        } catch {
            pluginManagementAlert = .error(error.localizedDescription)
        }
        pluginOperation = nil
    }

    @MainActor
    private func disableUserPlugin(_ plugin: PluginHost.PluginSummary) async {
        guard source(for: plugin) == .user else { return }
        pluginOperation = .disabling(plugin.id)
        pluginManagementMessage = nil
        do {
            _ = try await Task.detached(priority: .userInitiated) {
                try ABGPluginStateStore.disable(at: URL(fileURLWithPath: plugin.path))
            }.value
            _ = coordinator.pluginHost.unload(at: URL(fileURLWithPath: plugin.path))
            coordinator.refreshPluginSummaries()
            selectedPluginID = plugin.id
            pluginManagementMessage = "Plugin disabled."
        } catch {
            pluginManagementAlert = .error(error.localizedDescription)
        }
        pluginOperation = nil
    }

    @MainActor
    private func uninstallUserPlugin(_ plugin: PluginHost.PluginSummary) async {
        guard source(for: plugin) == .user else { return }
        pluginOperation = .uninstalling(plugin.id)
        pluginManagementMessage = nil
        do {
            _ = try await Task.detached(priority: .userInitiated) {
                try ABGPluginInstaller.uninstall(at: URL(fileURLWithPath: plugin.path))
            }.value
            _ = coordinator.pluginHost.unload(plugin: plugin.name)
            coordinator.refreshPluginSummaries()
            selectedPluginID = nil
            selectedFilter = .all
        } catch {
            pluginManagementAlert = .error(error.localizedDescription)
        }
        pluginOperation = nil
    }

    private func reloadLoadedPlugin(_ plugin: PluginHost.PluginSummary) {
        let installName = URL(fileURLWithPath: plugin.path).lastPathComponent
        let reloadResult = coordinator.pluginHost.reload(plugin: plugin.name)
        let didReload = reloadResult.contains { row in
            (row["status"] as? String) == "reloaded"
        }
        if !didReload, installName != plugin.name {
            _ = coordinator.pluginHost.reload(plugin: installName)
        }
    }

    private func isGitBacked(_ plugin: PluginHost.PluginSummary) -> Bool {
        FileManager.default.fileExists(atPath: URL(fileURLWithPath: plugin.path).appendingPathComponent(".git").path)
    }

    private func isOperating(on plugin: PluginHost.PluginSummary) -> Bool {
        pluginOperation?.pluginID == plugin.id
    }

    private func copy(_ value: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(value, forType: .string)
    }

    private var runtimeProfileColor: Color {
        ABGConstants.runtimeProfile == nil ? .secondary : .orange
    }

    private var gatewayEndpointText: String {
        "\(ABGConstants.wsHost):\(String(ABGConstants.wsPort))"
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

private enum PluginManagementOperation: Equatable {
    case updating(String)
    case enabling(String)
    case disabling(String)
    case uninstalling(String)

    var pluginID: String {
        switch self {
        case .updating(let pluginID), .enabling(let pluginID), .disabling(let pluginID), .uninstalling(let pluginID):
            return pluginID
        }
    }

    var title: String {
        switch self {
        case .updating:
            return "Updating plugin..."
        case .enabling:
            return "Enabling plugin..."
        case .disabling:
            return "Disabling plugin..."
        case .uninstalling:
            return "Uninstalling plugin..."
        }
    }
}

private enum PluginManagementAlert: Identifiable {
    case confirmUninstall(PluginHost.PluginSummary)
    case error(String)

    var id: String {
        switch self {
        case .confirmUninstall(let plugin):
            return "uninstall-\(plugin.id)"
        case .error(let message):
            return "error-\(message)"
        }
    }
}

private enum GatewayWindowSection {
    case plugins
    case audit
    case settings
}

private enum AuditTimeFilter: String, CaseIterable, Identifiable {
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

private struct AuditLogDetailRow: Identifiable, Hashable {
    let key: String
    let value: String

    var id: String { "\(key)=\(value)" }
}

private struct AuditLogViewEntry: Identifiable {
    static let allFilterValue = "__all__"

    let id: String
    let timestamp: Date
    let action: String
    let command: String
    let extensionId: String?
    let tabId: Int?
    let url: String?
    let agent: String?
    let origin: String
    let outcome: String
    let selectedTarget: String
    let resultSummary: String
    let detailRows: [AuditLogDetailRow]
    let rawDetails: String?
    let auditDiffPreview: [String]
    let searchBlob: String

    var timeText: String {
        timestamp.formatted(.dateTime.month().day().hour().minute().second())
    }

    var tabDisplay: String {
        tabId.map { String($0) } ?? "none"
    }

    var tabFilterValue: String {
        tabId.map { "Tab \($0)" } ?? "(no tab)"
    }

    var symbol: String {
        switch action {
        case "permit": return "checkmark.shield"
        case "revoke", "revoke_via_cli": return "xmark.shield"
        case "fill", "paste", "clear", "replace_dom", "type_text", "keyboard_insert_text": return "square.and.pencil"
        case "click_selector", "click_ref", "click_described", "click_at": return "cursorarrow.click"
        case "eval_script": return "chevron.left.forwardslash.chevron.right"
        case "plugin_command_run": return "puzzlepiece.extension"
        case "har_export", "state_inspect", "read_dom": return "doc.text.magnifyingglass"
        default: return "waveform.path.ecg"
        }
    }

    var color: Color {
        switch outcome {
        case "failed": return .red
        case "changed": return .orange
        case "unchanged": return .secondary
        case "ok": return .green
        default: return .blue
        }
    }

    var outcomeColor: Color { color }

    static func loadRecent(from path: String, limit: Int) -> (entries: [AuditLogViewEntry], error: String?) {
        guard FileManager.default.fileExists(atPath: path) else {
            return ([], nil)
        }
        guard let lines = try? AuditLog.tailLineData(from: path, maxLines: limit) else {
            return ([], "Cannot read \(path)")
        }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let entries = lines.compactMap { line -> AuditLogViewEntry? in
            guard let entry = try? decoder.decode(AuditLog.Entry.self, from: line.data) else {
                return nil
            }
            return AuditLogViewEntry(entry: entry, idSeed: "offset-\(line.byteOffset)")
        }
        return (entries.reversed(), nil)
    }

    init(entry: AuditLog.Entry, idSeed: String) {
        let details = entry.details?.mapValues(\.value)
        let rawDetails = details.flatMap(Self.prettyJSONString)
        let rows = Self.detailRows(from: details)
        let command = (details?["command"] as? String) ?? entry.action
        let origin = Self.originLabel(for: entry.url)
        let outcome = Self.outcomeLabel(action: entry.action, details: details)
        let selectedTarget = Self.selectedTargetLabel(tabId: entry.tabId, details: details)
        let resultSummary = Self.resultSummaryLabel(outcome: outcome, details: details)
        let auditDiffPreview = ((details?["auditDiff"] as? [String: Any])?["preview"] as? [String]) ?? []
        let tabIDText = entry.tabId.map(String.init) ?? ""
        let detailSearchText = rows.map { "\($0.key) \($0.value)" }.joined(separator: " ")
        let searchBlobParts: [String] = [
            entry.action,
            command,
            entry.extensionId ?? "",
            tabIDText,
            entry.url ?? "",
            entry.agent ?? "",
            origin,
            outcome,
            selectedTarget,
            resultSummary,
            rawDetails ?? "",
            detailSearchText,
        ]
        let searchBlob = searchBlobParts.joined(separator: " ")

        self.id = "\(idSeed)-\(entry.ts.timeIntervalSince1970)-\(entry.action)"
        self.timestamp = entry.ts
        self.action = entry.action
        self.command = command
        self.extensionId = entry.extensionId
        self.tabId = entry.tabId
        self.url = entry.url
        self.agent = entry.agent
        self.origin = origin
        self.outcome = outcome
        self.selectedTarget = selectedTarget
        self.resultSummary = resultSummary
        self.detailRows = rows
        self.rawDetails = rawDetails
        self.auditDiffPreview = auditDiffPreview
        self.searchBlob = searchBlob
    }

    private static func originLabel(for url: String?) -> String {
        guard let url, let host = URL(string: url)?.host, !host.isEmpty else {
            return "(no origin)"
        }
        return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }

    private static func outcomeLabel(action: String, details: [String: Any]?) -> String {
        if let auditDiff = details?["auditDiff"] as? [String: Any],
           let changed = auditDiff["changed"] as? Bool {
            return changed ? "changed" : "unchanged"
        }
        if let ok = details?["ok"] as? Bool {
            return ok ? "ok" : "failed"
        }
        if details?["error"] != nil {
            return "failed"
        }
        if let approval = details?["approval"] as? [String: Any],
           let decision = approval["decision"] as? String,
           !decision.isEmpty {
            return decision
        }
        if action.contains("disconnect") || action.contains("revoke") {
            return "closed"
        }
        return "recorded"
    }

    private static func selectedTargetLabel(tabId: Int?, details: [String: Any]?) -> String {
        if let selector = details?["selector"] as? String, !selector.isEmpty {
            return selector
        }
        if let command = details?["command"] as? String, !command.isEmpty {
            return command
        }
        if let targetTabId = details?["targetTabId"] as? Int {
            return "Tab \(targetTabId)"
        }
        if let id = details?["id"] as? Int {
            return "Element \(id)"
        }
        if let x = details?["x"] as? Int, let y = details?["y"] as? Int {
            return "Point \(x),\(y)"
        }
        return tabId.map { "Tab \($0)" } ?? "Gateway"
    }

    private static func resultSummaryLabel(outcome: String, details: [String: Any]?) -> String {
        if let error = details?["error"] as? String, !error.isEmpty {
            return clipped(error)
        }
        if let policyAction = details?["policyAction"] as? String,
           let policyDomain = details?["policyDomain"] as? String {
            return "\(outcome) by \(policyAction) \(policyDomain)"
        }
        if let auditDiff = details?["auditDiff"] as? [String: Any],
           let changed = auditDiff["changed"] as? Bool {
            return changed ? "changed" : "unchanged"
        }
        return outcome
    }

    private static func detailRows(from details: [String: Any]?) -> [AuditLogDetailRow] {
        guard let details else { return [] }
        return flatten(details, prefix: nil).prefix(36).map { AuditLogDetailRow(key: $0.key, value: $0.value) }
    }

    private static func flatten(_ value: Any, prefix: String?) -> [(key: String, value: String)] {
        if let dict = value as? [String: Any] {
            return dict.keys.sorted().flatMap { key in
                flatten(dict[key] ?? NSNull(), prefix: [prefix, key].compactMap { $0 }.joined(separator: "."))
            }
        }
        if let array = value as? [Any] {
            return [(prefix ?? "value", compactJSONString(array))]
        }
        return [(prefix ?? "value", clipped(displayValue(value)))]
    }

    private static func displayValue(_ value: Any) -> String {
        switch value {
        case let string as String:
            return string
        case let bool as Bool:
            return bool ? "true" : "false"
        case let int as Int:
            return String(int)
        case let double as Double:
            return String(double)
        case is NSNull:
            return "null"
        default:
            return compactJSONString(value)
        }
    }

    private static func prettyJSONString(_ value: Any) -> String? {
        guard JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys])
        else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private static func compactJSONString(_ value: Any) -> String {
        guard JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]),
              let text = String(data: data, encoding: .utf8)
        else { return String(describing: value) }
        return clipped(text)
    }

    private static func clipped(_ value: String, limit: Int = 260) -> String {
        value.count > limit ? "\(value.prefix(limit))..." : value
    }
}

private struct PluginInstallSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var sourceText = ""
    @State private var installName = ""
    @State private var replaceExisting = false
    @State private var trustSource = false
    @State private var isInstalling = false
    @State private var errorMessage: String?

    let onInstall: (String, String?, Bool) async throws -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(Color.blue.opacity(0.13))
                    Image(systemName: "square.and.arrow.down")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(.blue)
                }
                .frame(width: 42, height: 42)

                VStack(alignment: .leading, spacing: 3) {
                    Text("Install Plugin")
                        .font(.system(size: 20, weight: .semibold))
                    Text("Private repositories use your local git credentials.")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(.secondary)
                }

                Spacer(minLength: 0)
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("Repository")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.secondary)
                TextField("user/repo or https://github.com/user/repo.git", text: $sourceText)
                    .textFieldStyle(.roundedBorder)
                    .disabled(isInstalling)
                    .onSubmit(startInstall)
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("Install Name")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.secondary)
                TextField("Inferred from repository", text: $installName)
                    .textFieldStyle(.roundedBorder)
                    .disabled(isInstalling)
            }

            VStack(alignment: .leading, spacing: 10) {
                Toggle("Replace existing plugin", isOn: $replaceExisting)
                    .disabled(isInstalling)
                Toggle("I trust this plugin source", isOn: $trustSource)
                    .disabled(isInstalling)
            }
            .toggleStyle(.checkbox)

            if let errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.triangle")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack(spacing: 10) {
                Spacer(minLength: 0)
                Button("Cancel") {
                    dismiss()
                }
                .disabled(isInstalling)

                Button {
                    startInstall()
                } label: {
                    if isInstalling {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Label("Install", systemImage: "square.and.arrow.down")
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(!canInstall)
            }
        }
        .padding(22)
        .frame(width: 460)
    }

    private var canInstall: Bool {
        !trimmedSource.isEmpty && trustSource && !isInstalling
    }

    private var trimmedSource: String {
        sourceText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var trimmedName: String? {
        let value = installName.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }

    private func startInstall() {
        guard canInstall else { return }
        isInstalling = true
        errorMessage = nil
        Task {
            do {
                try await onInstall(trimmedSource, trimmedName, replaceExisting)
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
            isInstalling = false
        }
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

    var badgeTitle: String {
        switch self {
        case .bundled: return "Built-in"
        case .user: return "User"
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
                        if !plugin.isEnabled {
                            PluginStatusBadge(text: "OFF", color: .secondary)
                        }
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
            .opacity(plugin.isEnabled ? 1 : 0.62)
        }
        .buttonStyle(PluginListButtonStyle(isSelected: isSelected))
    }
}

private struct AuditLogListRow: View {
    let entry: AuditLogViewEntry
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 11) {
                AuditLogIcon(entry: entry, size: 34)

                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Text(entry.command)
                            .font(.system(size: 14, weight: .semibold))
                            .lineLimit(1)
                        PluginStatusBadge(text: entry.outcome.uppercased(), color: entry.outcomeColor)
                    }

                    HStack(spacing: 6) {
                        Text(entry.timeText)
                        Text(entry.tabFilterValue)
                        Text(entry.origin)
                    }
                    .font(.system(size: 11, weight: .medium))
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

private struct AuditLogIcon: View {
    let entry: AuditLogViewEntry
    let size: CGFloat

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(entry.color.opacity(0.16))
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(Color.white.opacity(0.16), lineWidth: 1)
                )
            Image(systemName: entry.symbol)
                .font(.system(size: size * 0.42, weight: .semibold))
                .foregroundStyle(entry.color)
        }
        .frame(width: size, height: size)
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
        Text(source.badgeTitle.uppercased())
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

private struct PluginStatusBadge: View {
    let text: String
    let color: Color

    var body: some View {
        Text(text)
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(color)
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .background(
                Capsule(style: .continuous)
                    .fill(color.opacity(0.12))
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
                Text(verbatim: value)
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

private struct PluginSecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(.primary)
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(configuration.isPressed ? Color.primary.opacity(0.14) : Color.primary.opacity(0.08))
            )
    }
}

private struct PluginDestructiveButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(.red)
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(configuration.isPressed ? Color.red.opacity(0.20) : Color.red.opacity(0.11))
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
