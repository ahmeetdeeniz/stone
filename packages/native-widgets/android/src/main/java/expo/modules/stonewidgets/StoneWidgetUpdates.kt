package expo.modules.stonewidgets

import android.content.Context
import androidx.glance.appwidget.updateAll

internal object StoneWidgetUpdates {
  suspend fun updateAll(context: Context) {
    TodayTasksWidget().updateAll(context)
    AgendaWidget().updateAll(context)
    FocusWidget().updateAll(context)
    QuickCaptureWidget().updateAll(context)
  }
}
