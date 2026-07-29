package expo.modules.stonewidgets

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.glance.GlanceId
import androidx.glance.action.ActionParameters
import androidx.glance.appwidget.action.ActionCallback

internal val ActionTypeKey = ActionParameters.Key<String>("stone_action_type")
internal val TargetIdKey = ActionParameters.Key<String>("stone_target_id")
internal val RevisionKey = ActionParameters.Key<Int>("stone_expected_revision")

class QueueStoneActionCallback : ActionCallback {
  override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
    val type = parameters[ActionTypeKey] ?: return
    val target = parameters[TargetIdKey]?.ifBlank { null }
    val revision = parameters[RevisionKey] ?: 0
    StoneWidgetStore.enqueue(context, type, target, revision)
    StoneWidgetUpdates.updateAll(context)
  }
}

internal fun deepLinkIntent(context: Context, route: String): Intent =
  (
    context.packageManager.getLaunchIntentForPackage(context.packageName)
      ?: Intent(Intent.ACTION_VIEW)
  ).apply {
      data = Uri.parse("stone://$route")
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
      setPackage(context.packageName)
    }
