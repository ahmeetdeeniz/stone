import ActivityKit
import ExpoModulesCore
import WidgetKit

public final class StoneWidgetsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("StoneWidgets")

    AsyncFunction("writeSnapshot") { (payload: String) in
      try StoneSharedStore.writeSnapshot(payload)
    }

    AsyncFunction("readActions") {
      StoneSharedStore.readActions()
    }

    AsyncFunction("acknowledgeActions") { (ids: [String]) in
      StoneSharedStore.acknowledge(ids)
    }

    AsyncFunction("clearAll") {
      StoneSharedStore.clear()
      WidgetCenter.shared.reloadAllTimelines()
      if #available(iOS 16.1, *) {
        Task { await StoneFocusActivity.endAll() }
      }
    }

    AsyncFunction("refreshAll") {
      WidgetCenter.shared.reloadAllTimelines()
    }

    AsyncFunction("reconcileFocusActivity") { (payload: String?) in
      guard #available(iOS 16.1, *) else { return }
      Task { await StoneFocusActivity.reconcile(payload) }
    }
  }
}

private enum StoneSharedStore {
  static var suite: UserDefaults {
    let group = Bundle.main.object(forInfoDictionaryKey: "StoneWidgetAppGroup") as? String
    guard let group, let defaults = UserDefaults(suiteName: group) else {
      return .standard
    }
    return defaults
  }

  static func writeSnapshot(_ payload: String) throws {
    let data = Data(payload.utf8)
    let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
    guard object?["schemaVersion"] as? Int == 1 else {
      throw NSError(domain: "StoneWidgets", code: 1)
    }
    suite.set(payload, forKey: "snapshot")
  }

  static func readActions() -> String {
    suite.string(forKey: "actions") ?? #"{"schemaVersion":1,"actions":[]}"#
  }

  static func acknowledge(_ ids: [String]) {
    guard
      let data = readActions().data(using: .utf8),
      var object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let actions = object["actions"] as? [[String: Any]]
    else { return }
    object["actions"] = actions.filter { !ids.contains($0["id"] as? String ?? "") }
    guard
      let encoded = try? JSONSerialization.data(withJSONObject: object),
      let payload = String(data: encoded, encoding: .utf8)
    else { return }
    suite.set(payload, forKey: "actions")
  }

  static func clear() {
    suite.removeObject(forKey: "snapshot")
    suite.removeObject(forKey: "actions")
  }
}

@available(iOS 16.1, *)
private enum StoneFocusActivity {
  static func reconcile(_ payload: String?) async {
    guard
      let payload,
      let data = payload.data(using: .utf8),
      let focus = try? JSONDecoder().decode(StoneFocusPayload.self, from: data)
    else {
      await endAll()
      return
    }
    let state = StoneFocusAttributes.ContentState(
      status: focus.status,
      phase: focus.phase,
      startedAt: focus.startedAt,
      plannedDurationSeconds: focus.plannedDurationSeconds,
      accumulatedPausedSeconds: focus.accumulatedPausedSeconds,
      contextTitle: focus.contextTitle
    )
    if let current = Activity<StoneFocusAttributes>.activities.first {
      await current.update(ActivityContent(state: state, staleDate: nil))
    } else if ActivityAuthorizationInfo().areActivitiesEnabled {
      _ = try? Activity.request(
        attributes: StoneFocusAttributes(sessionId: focus.sessionId, mode: focus.mode),
        content: ActivityContent(state: state, staleDate: nil)
      )
    }
  }

  static func endAll() async {
    for activity in Activity<StoneFocusAttributes>.activities {
      await activity.end(nil, dismissalPolicy: .immediate)
    }
  }
}

@available(iOS 16.1, *)
private struct StoneFocusPayload: Codable {
  let sessionId: String
  let mode: String
  let phase: String
  let status: String
  let startedAt: String
  let plannedDurationSeconds: Int?
  let accumulatedPausedSeconds: Int
  let contextTitle: String?
}

@available(iOS 16.1, *)
struct StoneFocusAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    let status: String
    let phase: String
    let startedAt: String
    let plannedDurationSeconds: Int?
    let accumulatedPausedSeconds: Int
    let contextTitle: String?
  }

  let sessionId: String
  let mode: String
}
