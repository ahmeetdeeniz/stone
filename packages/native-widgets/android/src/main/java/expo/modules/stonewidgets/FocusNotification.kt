package expo.modules.stonewidgets

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject

internal object FocusNotification {
  private const val CHANNEL = "stone_active_focus"
  private const val ID = 2404

  fun reconcile(context: Context, payload: String?) {
    if (payload == null) {
      NotificationManagerCompat.from(context).cancel(ID)
      return
    }
    if (
      Build.VERSION.SDK_INT >= 33 &&
      context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) return
    val focus = runCatching { JSONObject(payload) }.getOrNull() ?: return
    val manager = context.getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= 26) {
      manager.createNotificationChannel(
        NotificationChannel(
          CHANNEL,
          context.getString(R.string.stone_focus_channel),
          NotificationManager.IMPORTANCE_LOW,
        ).apply { description = context.getString(R.string.stone_focus_channel_description) },
      )
    }
    val paused = focus.optString("status") == "paused"
    val sessionId = focus.optString("sessionId")
    val revision = focus.optInt("revision")
    val startedAt = runCatching {
      java.time.Instant.parse(focus.optString("startedAt")).toEpochMilli()
    }.getOrDefault(System.currentTimeMillis())
    val elapsedMillis =
      (System.currentTimeMillis() - startedAt -
        focus.optLong("accumulatedPausedSeconds") * 1_000L).coerceAtLeast(0L)
    val plannedMillis = focus.optLong("plannedDurationSeconds", 0L) * 1_000L
    val builder = NotificationCompat.Builder(context, CHANNEL)
      .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
      .setContentTitle(context.getString(R.string.stone_widget_focus))
      .setContentText(
        context.getString(
          if (paused) R.string.stone_widget_paused else R.string.stone_widget_running,
        ),
      )
      .setOngoing(!paused)
      .setOnlyAlertOnce(true)
      .setContentIntent(openIntent(context))
      .addAction(
        0,
        context.getString(if (paused) R.string.stone_widget_resume else R.string.stone_widget_pause),
        actionIntent(context, if (paused) "resume_focus" else "pause_focus", sessionId, revision),
      )
      .addAction(
        0,
        context.getString(R.string.stone_widget_finish),
        actionIntent(context, "finish_focus", sessionId, revision),
      )
    if (!paused) {
      builder.setUsesChronometer(true)
      if (plannedMillis > 0L) {
        builder.setWhen(System.currentTimeMillis() + (plannedMillis - elapsedMillis).coerceAtLeast(0L))
        builder.setChronometerCountDown(true)
      } else {
        builder.setWhen(System.currentTimeMillis() - elapsedMillis)
      }
    }
    NotificationManagerCompat.from(context).notify(ID, builder.build())
  }

  fun cancel(context: Context) = NotificationManagerCompat.from(context).cancel(ID)

  private fun openIntent(context: Context): PendingIntent =
    PendingIntent.getActivity(
      context,
      0,
      deepLinkIntent(context, "focus"),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

  private fun actionIntent(
    context: Context,
    type: String,
    targetId: String,
    revision: Int,
  ): PendingIntent =
    PendingIntent.getBroadcast(
      context,
      type.hashCode(),
      Intent(context, FocusNotificationActionReceiver::class.java)
        .putExtra("type", type)
        .putExtra("targetId", targetId)
        .putExtra("revision", revision),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
}

class FocusNotificationActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val type = intent.getStringExtra("type") ?: return
    StoneWidgetStore.enqueue(
      context,
      type,
      intent.getStringExtra("targetId"),
      intent.getIntExtra("revision", 0),
    )
  }
}
