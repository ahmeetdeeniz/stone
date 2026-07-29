package expo.modules.stonewidgets

import android.content.Context
import android.os.SystemClock
import android.widget.RemoteViews
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import androidx.glance.GlanceModifier
import androidx.glance.action.actionParametersOf
import androidx.glance.action.actionStartActivity
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.AndroidRemoteViews
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.defaultWeight
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import androidx.glance.Button
import androidx.glance.action.clickable
import androidx.glance.layout.Alignment
import androidx.glance.layout.SizeMode
import org.json.JSONObject

private val surface = ColorProvider(0xFFF7F4EF.toInt(), 0xFF1E1F22.toInt())
private val text = ColorProvider(0xFF272522.toInt(), 0xFFF1EEE8.toInt())
private val accent = ColorProvider(0xFF46624D.toInt(), 0xFF9EC5A5.toInt())

internal abstract class StoneGlanceWidget : GlanceAppWidget() {
  override val sizeMode = SizeMode.Exact

  abstract fun content(context: Context, snapshot: JSONObject?)

  override suspend fun provideGlance(context: Context, id: androidx.glance.GlanceId) {
    val snapshot = StoneWidgetStore.readSnapshot(context)
    provideContent { content(context, snapshot) }
  }
}

class TodayTasksWidget : StoneGlanceWidget() {
  @Composable
  override fun content(context: Context, snapshot: JSONObject?) {
    Frame(context.getString(R.string.stone_widget_today), "today") {
      if (snapshot == null || !snapshot.optBoolean("authenticated")) {
        Text(context.getString(R.string.stone_widget_unavailable), style = body())
        return@Frame
      }
      val tasks = snapshot.optJSONArray("todayTasks")
      Text(
        context.getString(R.string.stone_widget_tasks_remaining, snapshot.optInt("todayRemainingCount")),
        style = body(true),
      )
      if (snapshot.optString("privacy") == "counts_only") {
        Text(context.getString(R.string.stone_widget_counts_private), style = body())
      } else if (tasks != null) {
        for (index in 0 until minOf(tasks.length(), 4)) {
          val task = tasks.optJSONObject(index) ?: continue
          Row(verticalAlignment = Alignment.CenterVertically) {
            Text(task.optString("title").take(80), modifier = GlanceModifier.defaultWeight(), style = body())
            Button(
              text = "✓",
              onClick = actionRunCallback<QueueStoneActionCallback>(
                actionParametersOf(
                  ActionTypeKey to "complete_task",
                  TargetIdKey to task.optString("id"),
                  RevisionKey to task.optInt("revision"),
                ),
              ),
            )
          }
        }
      }
    }
  }
}

class AgendaWidget : StoneGlanceWidget() {
  @Composable
  override fun content(context: Context, snapshot: JSONObject?) {
    Frame(context.getString(R.string.stone_widget_agenda), "calendar") {
      val agenda = snapshot?.optJSONArray("agenda")
      if (snapshot == null || !snapshot.optBoolean("authenticated")) {
        Text(context.getString(R.string.stone_widget_unavailable), style = body())
      } else if (agenda == null || agenda.length() == 0) {
        Text(context.getString(R.string.stone_widget_no_agenda), style = body())
      } else if (snapshot.optString("privacy") == "counts_only") {
        Text(context.getString(R.string.stone_widget_counts_private), style = body())
      } else {
        for (index in 0 until minOf(agenda.length(), 5)) {
          val item = agenda.optJSONObject(index) ?: continue
          Text(
            "${if (item.optBoolean("allDay")) context.getString(R.string.stone_widget_all_day) else "•"}  ${item.optString("title").take(80)}",
            style = body(),
          )
        }
      }
    }
  }
}

class FocusWidget : StoneGlanceWidget() {
  @Composable
  override fun content(context: Context, snapshot: JSONObject?) {
    Frame(context.getString(R.string.stone_widget_focus), "focus") {
      val focus = snapshot?.optJSONObject("focus")
      if (focus == null) {
        Text(context.getString(R.string.stone_widget_no_focus), style = body())
        Button(
          context.getString(R.string.stone_widget_start_focus),
          actionRunCallback<QueueStoneActionCallback>(
            actionParametersOf(ActionTypeKey to "start_focus", TargetIdKey to "", RevisionKey to 0),
          ),
        )
      } else {
        val phase = when (focus.optString("phase")) {
          "short_break" -> R.string.stone_widget_short_break
          "long_break" -> R.string.stone_widget_long_break
          else -> R.string.stone_widget_focus_phase
        }
        Text(context.getString(phase), style = body(true))
        FocusChronometer(context, focus)
        Text(
          if (focus.optString("status") == "paused") context.getString(R.string.stone_widget_paused)
          else context.getString(R.string.stone_widget_running),
          style = body(),
        )
        Row {
          val paused = focus.optString("status") == "paused"
          Button(
            context.getString(if (paused) R.string.stone_widget_resume else R.string.stone_widget_pause),
            actionRunCallback<QueueStoneActionCallback>(
              actionParametersOf(
                ActionTypeKey to if (paused) "resume_focus" else "pause_focus",
                TargetIdKey to focus.optString("sessionId"),
                RevisionKey to focus.optInt("revision"),
              ),
            ),
          )
          Spacer(GlanceModifier.width(8.dp))
          Button(
            context.getString(R.string.stone_widget_finish),
            actionRunCallback<QueueStoneActionCallback>(
              actionParametersOf(
                ActionTypeKey to "finish_focus",
                TargetIdKey to focus.optString("sessionId"),
                RevisionKey to focus.optInt("revision"),
              ),
            ),
          )
        }
      }
    }
  }
}

@Composable
private fun FocusChronometer(context: Context, focus: JSONObject) {
  val paused = focus.optString("status") == "paused"
  val startedAt = runCatching {
    java.time.Instant.parse(focus.optString("startedAt")).toEpochMilli()
  }.getOrNull() ?: return
  val pausedAt = runCatching {
    java.time.Instant.parse(focus.optString("pausedAt")).toEpochMilli()
  }.getOrNull()
  val now = if (paused && pausedAt != null) pausedAt else System.currentTimeMillis()
  val elapsedMillis =
    (now - startedAt - focus.optLong("accumulatedPausedSeconds") * 1_000L).coerceAtLeast(0L)
  val plannedMillis = focus.optLong("plannedDurationSeconds", 0L) * 1_000L
  val views = RemoteViews(context.packageName, R.layout.stone_widget_chronometer)
  if (plannedMillis > 0L) {
    views.setChronometer(
      R.id.stone_widget_chronometer,
      SystemClock.elapsedRealtime() + (plannedMillis - elapsedMillis).coerceAtLeast(0L),
      null,
      !paused,
    )
    views.setChronometerCountDown(R.id.stone_widget_chronometer, true)
  } else {
    views.setChronometer(
      R.id.stone_widget_chronometer,
      SystemClock.elapsedRealtime() - elapsedMillis,
      null,
      !paused,
    )
  }
  AndroidRemoteViews(remoteViews = views)
}

class QuickCaptureWidget : StoneGlanceWidget() {
  @Composable
  override fun content(context: Context, snapshot: JSONObject?) {
    Frame(context.getString(R.string.stone_widget_quick_capture), "today") {
      Row {
        QuickButton(context.getString(R.string.stone_widget_new_task), context, "new_task")
        QuickButton(context.getString(R.string.stone_widget_new_note), context, "new_note")
        QuickButton(context.getString(R.string.stone_widget_new_event), context, "new_event")
      }
    }
  }
}

@Composable
private fun Frame(title: String, route: String, children: @Composable () -> Unit) {
  Column(
    modifier = GlanceModifier
      .fillMaxSize()
      .background(surface)
      .padding(14.dp),
  ) {
    Text(
      title,
      modifier = GlanceModifier.clickable(
        actionStartActivity(deepLinkIntent(androidx.glance.LocalContext.current, route)),
      ),
      style = TextStyle(color = accent, fontWeight = FontWeight.Bold),
    )
    Spacer(GlanceModifier.height(8.dp))
    children()
  }
}

@Composable
private fun QuickButton(label: String, context: Context, route: String) {
  Button(label, actionStartActivity(deepLinkIntent(context, route)))
}

private fun body(bold: Boolean = false) =
  TextStyle(color = text, fontWeight = if (bold) FontWeight.Bold else FontWeight.Normal)

class TodayTasksWidgetReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = TodayTasksWidget()
}
class AgendaWidgetReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = AgendaWidget()
}
class FocusWidgetReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = FocusWidget()
}
class QuickCaptureWidgetReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = QuickCaptureWidget()
}
