import { describe, expect, it } from "vitest";
import {
  buildTodayItems,
  calculateProjectHealth,
  canTransitionProjectStatus,
  daysUntil,
  isOverdue,
  projectStatuses,
  type Project,
  type ProjectTask,
} from "./index.js";

const baseProject: Project = {
  id: "prj_1",
  ownerId: "owner",
  canonicalDocumentId: "doc_1",
  title: "Stone",
  slug: "stone",
  status: "development",
  priority: "high",
  tags: ["mobile"],
  targetDate: "2026-08-01",
  currentVersion: "0.1.0",
  nextVersion: "0.2.0",
  nextAction: "Test akışını tamamla",
  repositoryUrl: null,
  platforms: ["android", "ios"],
  health: "good",
  revision: 1,
  createdAt: "2026-07-26T00:00:00.000Z",
  updatedAt: "2026-07-26T00:00:00.000Z",
  deletedAt: null,
  updatedByDeviceId: "device",
};

function task(input: Partial<ProjectTask>): ProjectTask {
  return {
    id: "tsk_1",
    ownerId: "owner",
    documentId: "doc_1",
    projectId: "prj_1",
    versionId: null,
    lineAnchor: "line:1",
    text: "Görevi tamamla",
    completed: false,
    priority: "high",
    dueDate: null,
    blocked: false,
    blockerText: null,
    canceled: false,
    revision: 1,
    updatedAt: "2026-07-26T00:00:00.000Z",
    ...input,
  };
}

describe("project tracking domain logic", () => {
  it("accepts every documented status and transition", () => {
    expect(projectStatuses).toHaveLength(10);
    for (const from of projectStatuses) {
      for (const to of projectStatuses) expect(canTransitionProjectStatus(from, to)).toBe(true);
    }
  });

  it("calculates date boundaries without local timezone drift", () => {
    expect(daysUntil("2026-08-01", "2026-07-26")).toBe(6);
    expect(isOverdue("2026-07-25", "2026-07-26")).toBe(true);
  });

  it("returns deterministic health explanations", () => {
    expect(
      calculateProjectHealth(
        baseProject,
        {
          openTasks: 4,
          openCriticalBlockers: 1,
          missingStoreChecklist: false,
          lastUpdatedAt: baseProject.updatedAt,
        },
        "2026-08-02",
      ),
    ).toEqual({
      health: "risk",
      reasons: ["Açık kritik blocker var.", "Hedef tarih geçti ve açık görevler bulunuyor."],
    });
    expect(
      calculateProjectHealth(
        { ...baseProject, status: "paused" },
        {
          openTasks: 4,
          openCriticalBlockers: 1,
          missingStoreChecklist: true,
          lastUpdatedAt: baseProject.updatedAt,
        },
        "2026-07-26",
      ).health,
    ).toBe("paused");
  });

  it("orders Today items by documented urgency", () => {
    const items = buildTodayItems(
      [baseProject, { ...baseProject, id: "prj_2", title: "Other", nextAction: null }],
      [
        task({ id: "late", text: "Kritik gecikmiş", priority: "critical", dueDate: "2026-07-20" }),
        task({ id: "blocked", text: "Blocker çöz", priority: "medium", blocked: true }),
        task({ id: "today", text: "Bugün", priority: "low", dueDate: "2026-07-26" }),
      ],
      "2026-07-26",
    );
    expect(items.map((item) => item.text).slice(0, 3)).toEqual([
      "Kritik gecikmiş",
      "Bugün",
      "Blocker çöz",
    ]);
    expect(items.some((item) => item.kind === "next_action")).toBe(true);
  });
});
