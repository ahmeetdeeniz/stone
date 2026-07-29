import ActivityKit
import SwiftUI
import WidgetKit

@available(iOS 16.1, *)
struct StoneFocusLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: StoneFocusAttributes.self) { context in
      HStack {
        Image(systemName: context.state.phase == "focus" ? "timer" : "cup.and.saucer")
        VStack(alignment: .leading) {
          Text(context.state.phase.replacingOccurrences(of: "_", with: " ").capitalized)
            .font(.caption)
          focusTimer(context.state)
            .font(.title2.monospacedDigit())
          if let title = context.state.contextTitle {
            Text(title).font(.caption).lineLimit(1).privacySensitive()
          }
        }
      }
      .padding()
      .activityBackgroundTint(.black.opacity(0.86))
      .activitySystemActionForegroundColor(.white)
      .widgetURL(URL(string: "stone://focus"))
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Image(systemName: context.state.phase == "focus" ? "timer" : "cup.and.saucer")
            .accessibilityLabel(context.state.phase)
        }
        DynamicIslandExpandedRegion(.center) {
          focusTimer(context.state).monospacedDigit()
        }
        DynamicIslandExpandedRegion(.bottom) {
          Text(context.state.contextTitle ?? context.attributes.mode)
            .lineLimit(1)
            .privacySensitive()
        }
      } compactLeading: {
        Image(systemName: context.state.phase == "focus" ? "timer" : "cup.and.saucer")
      } compactTrailing: {
        focusTimer(context.state).monospacedDigit()
      } minimal: {
        Image(systemName: "timer")
          .accessibilityLabel("Stone Focus")
      }
      .widgetURL(URL(string: "stone://focus"))
      .keylineTint(.green)
    }
  }

  @ViewBuilder
  private func focusTimer(_ state: StoneFocusAttributes.ContentState) -> some View {
    if state.status == "paused" {
      Text("Paused")
    } else if
      let start = ISO8601DateFormatter().date(from: state.startedAt),
      let duration = state.plannedDurationSeconds
    {
      let end = start.addingTimeInterval(TimeInterval(duration + state.accumulatedPausedSeconds))
      Text(timerInterval: Date()...max(Date(), end), countsDown: true)
    } else if let start = ISO8601DateFormatter().date(from: state.startedAt) {
      Text(start, style: .timer)
    }
  }
}
