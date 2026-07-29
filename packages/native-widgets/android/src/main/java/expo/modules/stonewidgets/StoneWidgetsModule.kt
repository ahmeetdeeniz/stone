package expo.modules.stonewidgets

import kotlinx.coroutines.runBlocking
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class StoneWidgetsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("StoneWidgets")

    AsyncFunction("writeSnapshot") { payload: String ->
      val context = requireNotNull(appContext.reactContext)
      StoneWidgetStore.writeSnapshot(context, payload)
    }

    AsyncFunction("readActions") {
      StoneWidgetStore.readActions(requireNotNull(appContext.reactContext))
    }

    AsyncFunction("acknowledgeActions") { actionIds: List<String> ->
      StoneWidgetStore.acknowledge(requireNotNull(appContext.reactContext), actionIds)
    }

    AsyncFunction("clearAll") {
      val context = requireNotNull(appContext.reactContext)
      StoneWidgetStore.clear(context)
      FocusNotification.cancel(context)
      runBlocking { StoneWidgetUpdates.updateAll(context) }
    }

    AsyncFunction("refreshAll") {
      val context = requireNotNull(appContext.reactContext)
      runBlocking { StoneWidgetUpdates.updateAll(context) }
    }

    AsyncFunction("reconcileFocusActivity") { payload: String? ->
      FocusNotification.reconcile(requireNotNull(appContext.reactContext), payload)
    }
  }
}
