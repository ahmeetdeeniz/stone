import * as Crypto from "expo-crypto";
import type { Document, Project, ProjectVersion } from "@stone/domain";
import {
  createProjectDocumentSet,
  createProjectMarkdown,
  createVersionMarkdown,
  type ProjectTemplate,
} from "@stone/markdown";

export interface NewProjectInput {
  ownerId: string;
  title: string;
  template: ProjectTemplate;
  deviceId: string;
}

export interface NewProjectWorkspace {
  project: Project;
  documents: readonly Document[];
}

export function createNewProjectWorkspace(input: NewProjectInput): NewProjectWorkspace {
  const now = new Date().toISOString();
  const id = Crypto.randomUUID();
  const slug = slugify(input.title);
  const projectDocumentId = Crypto.randomUUID();
  const companion = createProjectDocumentSet();
  const project: Project = {
    id,
    ownerId: input.ownerId,
    canonicalDocumentId: projectDocumentId,
    title: input.title.trim(),
    slug,
    status: "planning",
    priority: "medium",
    tags: [],
    targetDate: null,
    currentVersion: null,
    nextVersion: null,
    nextAction: "İlk net işi belirle",
    repositoryUrl: null,
    platforms: [],
    health: "good",
    revision: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    updatedByDeviceId: input.deviceId,
  };
  const documents: Document[] = [
    makeDocument({
      id: projectDocumentId,
      ownerId: input.ownerId,
      kind: "project",
      title: project.title,
      markdown: createProjectMarkdown({ id, title: project.title, template: input.template }),
      path: `Projects/${slug}/Project.md`,
      projectId: id,
      now,
      deviceId: input.deviceId,
    }),
    makeDocument({
      id: Crypto.randomUUID(),
      ownerId: input.ownerId,
      kind: "inbox",
      title: "Inbox",
      markdown: companion.inbox,
      path: `Projects/${slug}/Inbox.md`,
      projectId: id,
      now,
      deviceId: input.deviceId,
    }),
    makeDocument({
      id: Crypto.randomUUID(),
      ownerId: input.ownerId,
      kind: "decision_log",
      title: "Decisions",
      markdown: companion.decisions,
      path: `Projects/${slug}/Decisions.md`,
      projectId: id,
      now,
      deviceId: input.deviceId,
    }),
    makeDocument({
      id: Crypto.randomUUID(),
      ownerId: input.ownerId,
      kind: "release_checklist",
      title: "Release Checklist",
      markdown: companion.releaseChecklist,
      path: `Projects/${slug}/Release-Checklist.md`,
      projectId: id,
      now,
      deviceId: input.deviceId,
    }),
  ];
  return { project, documents };
}

export function createNewVersion(
  project: Project,
  version: string,
  deviceId: string,
): { version: ProjectVersion; document: Document } {
  const now = new Date().toISOString();
  const id = Crypto.randomUUID();
  const documentId = Crypto.randomUUID();
  const document = makeDocument({
    id: documentId,
    ownerId: project.ownerId,
    kind: "version",
    title: `v${version}`,
    markdown: createVersionMarkdown({ id, projectId: project.id, version }),
    path: `Projects/${project.slug}/Versions/${version}.md`,
    projectId: project.id,
    now,
    deviceId,
  });
  return {
    version: {
      id,
      ownerId: project.ownerId,
      projectId: project.id,
      canonicalDocumentId: documentId,
      version,
      status: "development",
      targetDate: null,
      androidStatus: "not_planned",
      iosStatus: "not_planned",
      completedTasks: 0,
      totalTasks: 0,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      updatedByDeviceId: deviceId,
    },
    document,
  };
}

function makeDocument(input: {
  id: string;
  ownerId: string;
  kind: Document["kind"];
  title: string;
  markdown: string;
  path: string;
  projectId: string;
  now: string;
  deviceId: string;
}): Document {
  return {
    id: input.id,
    ownerId: input.ownerId,
    kind: input.kind,
    title: input.title,
    markdown: input.markdown,
    path: input.path,
    projectId: input.projectId,
    isPinned: false,
    revision: 1,
    createdAt: input.now,
    updatedAt: input.now,
    deletedAt: null,
    updatedByDeviceId: input.deviceId,
  };
}

function slugify(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 80) || "project"
  );
}
