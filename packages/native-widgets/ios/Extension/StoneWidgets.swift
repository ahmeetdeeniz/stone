import SwiftUI
import WidgetKit

@main
struct StoneWidgetBundle: WidgetBundle {
  var body: some Widget {
    StoneTodayWidget()
    StoneAgendaWidget()
    StoneFocusWidget()
    StoneQuickCaptureWidget()
    if #available(iOS 16.1, *) {
      StoneFocusLiveActivity()
    }
  }
}

struct StoneTodayWidget: Widget {
  let kind = "StoneTodayWidget"
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: StoneTimelineProvider()) { entry in
      StoneTodayView(entry: entry)
        .background(Color.clear)
        .widgetURL(URL(string: "stone://today"))
    }
    .configurationDisplayName("Stone Today")
    .description("Bounded Today and overdue tasks.")
    .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
  }
}

struct StoneTodayView: View {
  let entry: StoneWidgetEntry

  var body: some View {
    let locale = entry.snapshot?.locale ?? "en"
    VStack(alignment: .leading, spacing: 6) {
      Label(StoneL10n.text("today", locale: locale), systemImage: "checkmark.circle")
        .font(.headline)
      if let snapshot = entry.snapshot, snapshot.authenticated {
        Text("\(snapshot.todayRemainingCount) \(StoneL10n.text("remaining", locale: locale))")
          .font(.caption)
          .accessibilityLabel("\(snapshot.todayRemainingCount) \(StoneL10n.text("remaining", locale: locale))")
        if snapshot.privacy == "counts_only" {
          Text(StoneL10n.text("private", locale: locale)).font(.caption2)
        } else {
          ForEach(snapshot.todayTasks.prefix(4)) { task in
            HStack {
              Text(task.title).font(.caption).lineLimit(1)
              Spacer()
              if #available(iOS 17.0, *) {
                Button(intent: StoneWidgetActionIntent(
                  action: "complete_task",
                  targetId: task.id,
                  revision: task.revision
                )) {
                  Image(systemName: "circle")
                }
                .buttonStyle(.plain)
                .accessibilityLabel(task.title)
              }
            }
          }
        }
        if snapshot.isStale {
          Text(StoneL10n.text("stale", locale: locale)).font(.caption2)
        }
      } else {
        Text(StoneL10n.text("unavailable", locale: locale)).font(.caption)
      }
    }
  }
}

struct StoneAgendaWidget: Widget {
  let kind = "StoneAgendaWidget"
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: StoneTimelineProvider()) { entry in
      StoneAgendaView(entry: entry)
        .background(Color.clear)
        .widgetURL(URL(string: "stone://calendar/\(dateRoute())"))
    }
    .configurationDisplayName("Stone Agenda")
    .description("Bounded local agenda.")
    .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
  }

  private func dateRoute() -> String {
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: Date())
  }
}

struct StoneAgendaView: View {
  let entry: StoneWidgetEntry
  var body: some View {
    let locale = entry.snapshot?.locale ?? "en"
    VStack(alignment: .leading, spacing: 6) {
      Label(StoneL10n.text("agenda", locale: locale), systemImage: "calendar")
        .font(.headline)
      if let snapshot = entry.snapshot, snapshot.authenticated {
        if snapshot.agenda.isEmpty {
          Text(StoneL10n.text("emptyAgenda", locale: locale)).font(.caption)
        } else if snapshot.privacy == "counts_only" {
          Text("\(snapshot.agenda.count)").font(.title2)
          Text(StoneL10n.text("private", locale: locale)).font(.caption2)
        } else {
          ForEach(snapshot.agenda.prefix(5)) { item in
            Link(destination: URL(string: "stone://event/\(item.id)")!) {
              HStack {
                Image(systemName: item.kind == "task_block" ? "clock" : "calendar")
                Text(item.title).font(.caption).lineLimit(1)
              }
            }
          }
        }
      } else {
        Text(StoneL10n.text("unavailable", locale: locale)).font(.caption)
      }
    }
  }
}

struct StoneFocusWidget: Widget {
  let kind = "StoneFocusWidget"
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: StoneTimelineProvider()) { entry in
      StoneFocusView(entry: entry)
        .background(Color.clear)
        .widgetURL(URL(string: "stone://focus"))
    }
    .configurationDisplayName("Stone Focus")
    .description("Current durable focus state.")
    .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular])
  }
}

struct StoneFocusView: View {
  let entry: StoneWidgetEntry
  var body: some View {
    let locale = entry.snapshot?.locale ?? "en"
    VStack(alignment: .leading, spacing: 7) {
      Label(StoneL10n.text("focus", locale: locale), systemImage: "timer")
        .font(.headline)
      if let focus = entry.snapshot?.focus {
        Text(phase(focus.phase, locale: locale)).font(.caption)
        timer(focus)
          .font(.title2.monospacedDigit())
          .accessibilityLabel(
            "\(phase(focus.phase, locale: locale)), \(StoneL10n.text(focus.status, locale: locale))"
          )
        if let title = focus.contextTitle, !title.isEmpty {
          Text(title).font(.caption).lineLimit(1).privacySensitive()
        }
        if #available(iOS 17.0, *) {
          HStack {
            Button(intent: StoneWidgetActionIntent(
              action: focus.status == "paused" ? "resume_focus" : "pause_focus",
              targetId: focus.sessionId,
              revision: focus.revision
            )) {
              Image(systemName: focus.status == "paused" ? "play.fill" : "pause.fill")
            }
            Button(intent: StoneWidgetActionIntent(
              action: "finish_focus",
              targetId: focus.sessionId,
              revision: focus.revision
            )) {
              Image(systemName: "stop.fill")
            }
          }.buttonStyle(.plain)
        }
      } else {
        Text(StoneL10n.text("emptyFocus", locale: locale)).font(.caption)
        if #available(iOS 17.0, *) {
          Button(
            StoneL10n.text("start", locale: locale),
            intent: StoneWidgetActionIntent(action: "start_focus", targetId: nil, revision: 0)
          )
        }
      }
    }
  }

  @ViewBuilder
  private func timer(_ focus: StoneFocusSummary) -> some View {
    if focus.status == "paused" {
      Text(StoneL10n.text("paused", locale: entry.snapshot?.locale ?? "en"))
    } else if
      let start = ISO8601DateFormatter().date(from: focus.startedAt),
      let duration = focus.plannedDurationSeconds
    {
      let end = start.addingTimeInterval(TimeInterval(duration + focus.accumulatedPausedSeconds))
      Text(timerInterval: Date()...max(Date(), end), countsDown: true)
    } else if let start = ISO8601DateFormatter().date(from: focus.startedAt) {
      Text(start, style: .timer)
    }
  }

  private func phase(_ value: String, locale: String) -> String {
    StoneL10n.text(
      value == "short_break" ? "shortBreak" : value == "long_break" ? "longBreak" : "focusPhase",
      locale: locale
    )
  }
}

struct StoneQuickCaptureWidget: Widget {
  let kind = "StoneQuickCaptureWidget"
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: StoneTimelineProvider()) { entry in
      StoneQuickCaptureView(entry: entry)
        .background(Color.clear)
    }
    .configurationDisplayName("Stone Quick Capture")
    .description("Open a bounded Stone creation flow.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}

struct StoneQuickCaptureView: View {
  let entry: StoneWidgetEntry
  var body: some View {
    let locale = entry.snapshot?.locale ?? "en"
    VStack(alignment: .leading, spacing: 8) {
      Label(StoneL10n.text("quick", locale: locale), systemImage: "plus.circle")
        .font(.headline)
      Link(StoneL10n.text("newTask", locale: locale), destination: URL(string: "stone://new_task")!)
      Link(StoneL10n.text("newNote", locale: locale), destination: URL(string: "stone://new_note")!)
      Link(StoneL10n.text("newEvent", locale: locale), destination: URL(string: "stone://new_event")!)
    }
    .font(.caption)
  }
}
