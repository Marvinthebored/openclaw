import OpenClawChatUI
import SwiftUI

/// Native edit-mode drag handles; a session's descendants move with its root.
struct RootSidebarOrganizer: View {
    @Environment(\.dismiss) private var dismiss
    @State private var groups: [OpenClawChatSessionGroup]
    @State private var sections: [ChatSessionSidebarModel.Section]
    @State private var isSavingGroups = false
    let onReorderGroups: ([String]) async -> Bool
    let onReorderSessions: ([String]) -> Void

    init(
        groups: [OpenClawChatSessionGroup],
        sections: [ChatSessionSidebarModel.Section],
        onReorderGroups: @escaping ([String]) async -> Bool,
        onReorderSessions: @escaping ([String]) -> Void)
    {
        self._groups = State(initialValue: groups)
        self._sections = State(initialValue: sections)
        self.onReorderGroups = onReorderGroups
        self.onReorderSessions = onReorderSessions
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(self.groups, id: \.name) { group in
                        Text(verbatim: group.name).font(OpenClawType.body)
                    }
                    .onMove { source, destination in
                        let previous = self.groups
                        self.groups.move(fromOffsets: source, toOffset: destination)
                        self.isSavingGroups = true
                        Task {
                            if await !(self.onReorderGroups(self.groups.map(\.name))) {
                                self.groups = previous
                            }
                            self.isSavingGroups = false
                        }
                    }
                    .moveDisabled(self.isSavingGroups)
                } header: {
                    Text("Groups").font(OpenClawType.captionSemiBold)
                }
                ForEach(self.sections) { section in
                    Section {
                        ForEach(section.nodes) { node in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(verbatim: ChatSessionSidebarModel.displayName(for: node.session))
                                    .font(OpenClawType.body)
                                if !node.children.isEmpty {
                                    Text("Children move with this session").font(OpenClawType.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                        .onMove { source, destination in
                            guard let index = self.sections.firstIndex(where: { $0.id == section.id }) else { return }
                            var nodes = self.sections[index].nodes
                            nodes.move(fromOffsets: source, toOffset: destination)
                            self.sections[index] = .init(id: section.id, title: section.title, nodes: nodes)
                            self.onReorderSessions(self.sections.flatMap(\.nodes).map(\.id))
                        }
                    } header: {
                        Text(verbatim: section.title ?? String(localized: "Sessions"))
                            .font(OpenClawType.captionSemiBold)
                    }
                }
            }
            .environment(\.editMode, .constant(.active))
            .navigationTitle(String(localized: "Reorder Sidebar"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button { self.dismiss() } label: { Text("Done").font(OpenClawType.subheadSemiBold) }
                        .disabled(self.isSavingGroups)
                }
            }
            .interactiveDismissDisabled(self.isSavingGroups)
        }
    }
}
