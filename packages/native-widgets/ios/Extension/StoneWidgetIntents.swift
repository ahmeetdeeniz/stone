import AppIntents

@available(iOS 17.0, *)
struct StoneWidgetActionIntent: AppIntent {
  static var title: LocalizedStringResource = "Update Stone"
  static var description = IntentDescription("Queues a bounded action for Stone.")
  static var openAppWhenRun = false

  @Parameter(title: "Action")
  var action: String

  @Parameter(title: "Target")
  var targetId: String?

  @Parameter(title: "Revision")
  var revision: Int

  init() {
    action = ""
    targetId = nil
    revision = 0
  }

  init(action: String, targetId: String?, revision: Int) {
    self.action = action
    self.targetId = targetId
    self.revision = revision
  }

  func perform() async throws -> some IntentResult {
    StoneWidgetStore.enqueue(type: action, targetId: targetId, revision: revision)
    return .result()
  }
}
