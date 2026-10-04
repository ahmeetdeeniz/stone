import { Directory, File, Paths } from "expo-file-system";
import type { AppServices } from "../services/composition-root";
import type { WorkspaceRestoreTarget } from "./workspace-restore";
import { writeLocalAttachmentBase64 } from "../attachments/expo-attachment-files";

/** Binds the full-workspace restore to this device's local repositories. */
export function createWorkspaceRestoreTarget(
  services: AppServices,
  ownerId: string,
): WorkspaceRestoreTarget {
  return {
    ownerId,
    deviceId: services.deviceId,
    now: new Date().toISOString(),
    getDocument: (id) => services.notes.getById(ownerId, id, true),
    createDocument: (document) => services.notes.create(document),
    getProject: (id) => services.projects.getById(ownerId, id),
    createProject: (project, documents) => services.projects.create({ project, documents }),
    getVersion: (id) => services.projects.getVersion(ownerId, id),
    createVersion: (version, document) => services.projects.createVersion({ version, document }),
    getTask: (id) => services.tasks.getById(ownerId, id, true),
    createTask: (task) => services.tasks.create(task),
    getDrawing: (id) => services.drawings.getById(ownerId, id, true),
    writeDrawingPreview: (id, base64) => {
      const directory = new Directory(Paths.document, "drawings");
      directory.create({ idempotent: true, intermediates: true });
      const file = new File(directory, `${id}.png`);
      file.write(base64, { encoding: "base64" });
      return Promise.resolve(file.uri);
    },
    createDrawing: (drawing, source, previewPath) =>
      services.drawings.save(drawing, source, previewPath, services.deviceId),
    writeAttachment: async (fileName, base64) => {
      const created = writeLocalAttachmentBase64(ownerId, fileName, base64);
      await services.attachments.enqueueExisting(ownerId, fileName);
      return created;
    },
    calendar: services.calendar,
    focus: services.focus,
    relationshipIds: async () => {
      const [tasks, projects, documents, calendar] = await Promise.all([
        services.taskUseCases.list(ownerId),
        services.projectUseCases.list(ownerId),
        services.noteUseCases.list(ownerId),
        services.calendar.listForExport(ownerId),
      ]);
      return {
        taskIds: new Set(tasks.map((task) => task.id)),
        projectIds: new Set(projects.map((project) => project.id)),
        documentIds: new Set(documents.map((document) => document.id)),
        calendarItemIds: new Set(calendar.map((item) => item.id)),
      };
    },
  };
}
