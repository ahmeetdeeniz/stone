import Foundation
import WidgetKit

enum StoneWidgetStore {
  static var defaults: UserDefaults? {
    guard
      let group = Bundle.main.object(forInfoDictionaryKey: "StoneWidgetAppGroup") as? String
    else { return nil }
    return UserDefaults(suiteName: group)
  }

  static func snapshot() -> StoneWidgetSnapshot? {
    guard
      let payload = defaults?.string(forKey: "snapshot"),
      payload.utf8.count <= 131_072,
      let decoded = try? JSONDecoder().decode(
        StoneWidgetSnapshot.self,
        from: Data(payload.utf8)
      ),
      decoded.schemaVersion == 1,
      decoded.todayTasks.count <= 8,
      decoded.agenda.count <= 8
    else { return nil }
    return decoded
  }

  static func enqueue(
    type: String,
    targetId: String?,
    revision: Int
  ) {
    guard
      [
        "complete_task", "reopen_task", "start_focus",
        "pause_focus", "resume_focus", "finish_focus",
      ].contains(type),
      let defaults
    else { return }
    var root = (
      defaults.string(forKey: "actions")
        .flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any] }
    ) ?? ["schemaVersion": 1, "actions": []]
    var actions = root["actions"] as? [[String: Any]] ?? []
    let cutoff = Date().addingTimeInterval(-86_400)
    actions = actions.filter {
      guard
        $0["status"] as? String == "pending",
        let raw = $0["createdAt"] as? String,
        let date = ISO8601DateFormatter().date(from: raw)
      else { return false }
      return date >= cutoff
    }
    if actions.contains(where: {
      $0["type"] as? String == type &&
        $0["targetId"] as? String == targetId &&
        (ISO8601DateFormatter().date(from: $0["createdAt"] as? String ?? "") ?? .distantPast)
          > Date().addingTimeInterval(-5)
    }) { return }
    let id = "widget-\(UUID().uuidString.lowercased())"
    actions.append([
      "schemaVersion": 1,
      "id": id,
      "type": type,
      "targetId": targetId as Any,
      "createdAt": ISO8601DateFormatter().string(from: Date()),
      "expectedRevision": revision,
      "idempotencyKey": id,
      "status": "pending",
    ])
    root["actions"] = Array(actions.suffix(32))
    guard
      let data = try? JSONSerialization.data(withJSONObject: root),
      let payload = String(data: data, encoding: .utf8)
    else { return }
    defaults.set(payload, forKey: "actions")
    WidgetCenter.shared.reloadAllTimelines()
  }
}

struct StoneTimelineProvider: TimelineProvider {
  func placeholder(in context: Context) -> StoneWidgetEntry {
    StoneWidgetEntry(date: Date(), snapshot: nil)
  }

  func getSnapshot(in context: Context, completion: @escaping (StoneWidgetEntry) -> Void) {
    completion(StoneWidgetEntry(date: Date(), snapshot: StoneWidgetStore.snapshot()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<StoneWidgetEntry>) -> Void) {
    let entry = StoneWidgetEntry(date: Date(), snapshot: StoneWidgetStore.snapshot())
    completion(Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(3600))))
  }
}

enum StoneL10n {
  static func text(_ key: String, locale: String) -> String {
    let tr: [String: String] = [
      "today": "Bugün", "agenda": "Ajanda", "focus": "Odak",
      "quick": "Hızlı yakalama", "unavailable": "Yenilemek için Stone’u açın",
      "private": "Başlıklar gizli", "remaining": "kaldı",
      "emptyAgenda": "Planlanmış öğe yok", "emptyFocus": "Etkin odak yok",
      "running": "Çalışıyor", "paused": "Duraklatıldı",
      "pause": "Duraklat", "resume": "Sürdür", "finish": "Bitir",
      "start": "25 dk başlat", "newTask": "Yeni görev", "newNote": "Yeni not",
      "newEvent": "Yeni etkinlik", "shortBreak": "Kısa mola", "longBreak": "Uzun mola",
      "focusPhase": "Odak aşaması", "stale": "Son kaydedilen veri",
    ]
    let en: [String: String] = [
      "today": "Today", "agenda": "Agenda", "focus": "Focus",
      "quick": "Quick capture", "unavailable": "Open Stone to refresh",
      "private": "Titles hidden", "remaining": "remaining",
      "emptyAgenda": "Nothing scheduled", "emptyFocus": "No active focus",
      "running": "Running", "paused": "Paused", "pause": "Pause", "resume": "Resume",
      "finish": "Finish", "start": "Start 25 min", "newTask": "New task",
      "newNote": "New note", "newEvent": "New event", "shortBreak": "Short break",
      "longBreak": "Long break", "focusPhase": "Focus phase", "stale": "Last saved data",
    ]
    return (locale == "tr" ? tr[key] : en[key]) ?? en[key] ?? key
  }
}
