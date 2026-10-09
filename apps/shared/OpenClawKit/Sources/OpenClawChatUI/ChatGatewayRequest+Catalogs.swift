import Foundation
import OpenClawProtocol

@MainActor
public protocol OpenClawSidebarCatalogTransport {
    func catalogEvents() async -> AsyncStream<OpenClawSidebarCatalogEvent>
}

public enum OpenClawSidebarCatalogEvent: Sendable {
    case connected(OpenClawSidebarCatalogConnection), changed(String?), disconnected, unavailable
}

@MainActor
public struct OpenClawSidebarCatalogConnection {
    public let profileID: String
    public let changedEvents: Bool
    public let allowsArchive: Bool
    public let allowsContinue: Bool
    public let allowsImport: Bool
    public let request: (OpenClawChatGatewayRequest) async throws -> Data
    public let isCurrent: () -> Bool
    public let openSources: () -> Void

    public init(
        profileID: String,
        changedEvents: Bool,
        allowsArchive: Bool,
        allowsContinue: Bool = false,
        allowsImport: Bool = false,
        request: @escaping @MainActor (OpenClawChatGatewayRequest) async throws -> Data,
        isCurrent: @escaping @MainActor () -> Bool,
        openSources: @escaping @MainActor () -> Void)
    {
        self.profileID = profileID
        self.changedEvents = changedEvents
        self.allowsArchive = allowsArchive
        self.allowsContinue = allowsContinue
        self.allowsImport = allowsImport
        self.request = request
        self.isCurrent = isCurrent
        self.openSources = openSources
    }
}

extension OpenClawChatGatewayRequest {
    public static func catalogList(agentID: String, catalogID: String? = nil, cursors: [String: String] = [:])
        -> OpenClawChatGatewayRequest
    {
        var params: [String: AnyCodable] = ["agentId": .init(agentID), "limitPerHost": .init(40)]
        if let catalogID { params["catalogId"] = .init(catalogID) }
        if !cursors.isEmpty {
            params["cursors"] = .init(cursors)
            params["hostIds"] = .init(cursors.keys.sorted())
        }
        return .init(method: "sessions.catalog.list", params: params, timeoutMs: 30000)
    }

    public static func catalogArchive(agentID: String, catalogID: String, hostID: String, row: SessionCatalogSession)
        -> OpenClawChatGatewayRequest
    {
        var params: [String: AnyCodable] = [
            "agentId": .init(agentID), "catalogId": .init(catalogID), "hostId": .init(hostID),
            "threadId": .init(row.threadid), "confirmNoOtherRunner": .init(true),
        ]
        if let home = row.sourcehomeid { params["sourceHomeId"] = .init(home) }
        return .init(method: "sessions.catalog.archive", params: params, timeoutMs: 30000)
    }
}
