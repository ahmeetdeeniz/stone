package expo.modules.stonewidgets

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.util.UUID

internal object StoneWidgetStore {
  private const val STORE = "stone.widgets.private.v1"
  private const val SNAPSHOT = "snapshot"
  private const val ACTIONS = "actions"
  private const val MAX_ACTIONS = 32

  fun writeSnapshot(context: Context, payload: String) {
    val value = JSONObject(payload)
    require(value.optInt("schemaVersion") == 1) { "Unsupported widget snapshot." }
    context.getSharedPreferences(STORE, Context.MODE_PRIVATE).edit().putString(SNAPSHOT, value.toString()).commit()
  }

  fun readSnapshot(context: Context): JSONObject? {
    val payload = context.getSharedPreferences(STORE, Context.MODE_PRIVATE).getString(SNAPSHOT, null)
      ?: return null
    return runCatching { JSONObject(payload).takeIf { it.optInt("schemaVersion") == 1 } }.getOrNull()
  }

  @Synchronized
  fun enqueue(
    context: Context,
    type: String,
    targetId: String?,
    expectedRevision: Int,
  ) {
    require(type in setOf("complete_task", "reopen_task", "start_focus", "pause_focus", "resume_focus", "finish_focus"))
    val now = Instant.now()
    val queue = readActionsObject(context)
    val existing = queue.getJSONArray("actions")
    val retained = JSONArray()
    for (index in 0 until existing.length()) {
      val candidate = existing.optJSONObject(index) ?: continue
      val created = runCatching { Instant.parse(candidate.getString("createdAt")) }.getOrNull() ?: continue
      if (candidate.optString("status") == "pending" && now.minusSeconds(86_400).isBefore(created)) {
        if (
          candidate.optString("type") == type &&
          candidate.optString("targetId").ifBlank { null } == targetId &&
          now.minusSeconds(5).isBefore(created)
        ) return
        retained.put(candidate)
      }
    }
    val id = "widget-${UUID.randomUUID()}"
    retained.put(
      JSONObject()
        .put("schemaVersion", 1)
        .put("id", id)
        .put("type", type)
        .put("targetId", targetId ?: JSONObject.NULL)
        .put("createdAt", now.toString())
        .put("expectedRevision", expectedRevision)
        .put("idempotencyKey", id)
        .put("status", "pending"),
    )
    val bounded = JSONArray()
    val start = (retained.length() - MAX_ACTIONS).coerceAtLeast(0)
    for (index in start until retained.length()) bounded.put(retained.get(index))
    writeActions(context, JSONObject().put("schemaVersion", 1).put("actions", bounded))
  }

  fun readActions(context: Context): String = readActionsObject(context).toString()

  @Synchronized
  fun acknowledge(context: Context, ids: List<String>) {
    if (ids.isEmpty()) return
    val source = readActionsObject(context).getJSONArray("actions")
    val retained = JSONArray()
    for (index in 0 until source.length()) {
      val action = source.optJSONObject(index) ?: continue
      if (action.optString("id") !in ids) retained.put(action)
    }
    writeActions(context, JSONObject().put("schemaVersion", 1).put("actions", retained))
  }

  fun clear(context: Context) {
    context.getSharedPreferences(STORE, Context.MODE_PRIVATE).edit().clear().commit()
  }

  private fun readActionsObject(context: Context): JSONObject {
    val payload = context.getSharedPreferences(STORE, Context.MODE_PRIVATE).getString(ACTIONS, null)
    return runCatching {
      JSONObject(payload ?: "").takeIf { it.optInt("schemaVersion") == 1 }
    }.getOrNull() ?: JSONObject().put("schemaVersion", 1).put("actions", JSONArray())
  }

  private fun writeActions(context: Context, value: JSONObject) {
    context.getSharedPreferences(STORE, Context.MODE_PRIVATE).edit().putString(ACTIONS, value.toString()).commit()
  }
}
