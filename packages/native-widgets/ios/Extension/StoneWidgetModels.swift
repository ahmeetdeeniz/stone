import ActivityKit
import Foundation
import WidgetKit

struct StoneTaskSummary: Codable, Identifiable {
  let id: String
  let title: String
  let completed: Bool
  let revision: Int
  let dueLabel: String?
}

struct StoneAgendaSummary: Codable, Identifiable {
  let id: String
  let kind: String
  let title: String
  let startAt: String?
  let endAt: String?
  let allDay: Bool
}

struct StoneFocusSummary: Codable {
  let sessionId: String
  let mode: String
  let phase: String
  let status: String
  let startedAt: String
  let plannedDurationSeconds: Int?
  let accumulatedPausedSeconds: Int
  let pausedAt: String?
  let contextTitle: String?
  let revision: Int
}

struct StoneWidgetSnapshot: Codable {
  let schemaVersion: Int
  let generatedAt: String
  let staleAfter: String
  let locale: String
  let privacy: String
  let authenticated: Bool
  let todayRemainingCount: Int
  let todayTasks: [StoneTaskSummary]
  let agenda: [StoneAgendaSummary]
  let focus: StoneFocusSummary?
  let dailyGoalSeconds: Int
  let dailyFocusedSeconds: Int

  var isStale: Bool {
    (ISO8601DateFormatter().date(from: staleAfter) ?? .distantPast) <= Date()
  }
}

struct StoneWidgetEntry: TimelineEntry {
  let date: Date
  let snapshot: StoneWidgetSnapshot?
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
