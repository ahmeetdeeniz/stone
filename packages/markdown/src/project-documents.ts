import {
  normalizeMarkdown,
  parseMarkdown,
  serializeMarkdown,
  type FrontmatterValue,
} from "./index.js";

export type ProjectTemplate =
  "blank" | "general" | "mobile_app" | "game" | "website" | "programming_tooling";

export interface ProjectFrontmatter {
  schema: 1;
  type: "project";
  id: string;
  status: string;
  priority: string;
  tags: readonly string[];
  currentVersion: string | null;
  nextVersion: string | null;
  targetDate: string | null;
  platforms: readonly string[];
  repositoryUrl: string | null;
  nextAction: string | null;
  readonly [key: string]: FrontmatterValue;
}

export interface VersionFrontmatter {
  schema: 1;
  type: "version";
  id: string;
  projectId: string;
  version: string;
  status: string;
  targetDate: string | null;
  platforms: {
    android: string;
    ios: string;
    readonly [key: string]: FrontmatterValue;
  };
  readonly [key: string]: FrontmatterValue;
}

export interface ProjectDocumentInput {
  id: string;
  title: string;
  template: ProjectTemplate;
  status?: string;
  priority?: string;
  tags?: readonly string[];
  currentVersion?: string | null;
  nextVersion?: string | null;
  targetDate?: string | null;
  platforms?: readonly string[];
  repositoryUrl?: string | null;
  nextAction?: string | null;
}

export interface VersionDocumentInput {
  id: string;
  projectId: string;
  version: string;
  status?: string;
  targetDate?: string | null;
  androidStatus?: string;
  iosStatus?: string;
}

export interface ProjectDocumentSet {
  project: string;
  inbox: string;
  decisions: string;
  releaseChecklist: string;
}

const templateSections: Readonly<Record<ProjectTemplate, string>> = {
  blank: "",
  general:
    "## Roadmap\n\n- [ ] MVP kapsamını netleştir\n- [ ] Teknik mimariyi seç\n- [ ] İlk çalışan sürümü hazırla\n",
  mobile_app:
    "## Mobil Kapsamı\n\n- [ ] Android akışını doğrula\n- [ ] iOS akışını doğrula\n- [ ] Küçük ekranı kontrol et\n",
  game: "## Oyun Kapsamı\n\n- [ ] Core loop'u doğrula\n- [ ] Oyun hissini test et\n- [ ] İçerik listesini çıkar\n",
  website:
    "## Web Kapsamı\n\n- [ ] Sayfa yapısını planla\n- [ ] Responsive düzeni kontrol et\n- [ ] Production deploy'u doğrula\n",
  programming_tooling:
    "## Tooling Kapsamı\n\n- [ ] Komut satırı arayüzünü tasarla\n- [ ] Dokümantasyon örneklerini yaz\n- [ ] Sürümleme akışını doğrula\n",
};

export const projectTemplateLabels: Readonly<Record<ProjectTemplate, string>> = {
  blank: "Boş Proje",
  general: "Genel Proje",
  mobile_app: "Mobil Uygulama",
  game: "Oyun",
  website: "Web Sitesi",
  programming_tooling: "Programlama Dili / Tooling",
};

export function createProjectMarkdown(input: ProjectDocumentInput): string {
  const frontmatter = {
    stone: {
      schema: 1,
      type: "project" as const,
      id: input.id,
      status: input.status ?? "planning",
      priority: input.priority ?? "medium",
      tags: [...(input.tags ?? [])],
      currentVersion: input.currentVersion ?? null,
      nextVersion: input.nextVersion ?? null,
      targetDate: input.targetDate ?? null,
      platforms: [...(input.platforms ?? [])],
      repositoryUrl: input.repositoryUrl ?? null,
      nextAction: input.nextAction ?? null,
    },
  };
  const body =
    input.template === "blank"
      ? `# ${input.title.trim()}\n`
      : `# ${input.title.trim()}\n\n## Özet\n\nProjenin kısa tanımı.\n\n## Hedef\n\nProjenin başarılı sayılması için gereken sonuç.\n\n## Sonraki İş\n\n- [ ] İlk net işi belirle\n\n## Blocker'lar\n\nHenüz blocker yok.\n\n${templateSections[input.template]}\n## Notlar\n`;
  return serializeMarkdown({ frontmatter, body });
}

export function createVersionMarkdown(input: VersionDocumentInput): string {
  return serializeMarkdown({
    frontmatter: {
      stone: {
        schema: 1,
        type: "version",
        id: input.id,
        projectId: input.projectId,
        version: input.version,
        status: input.status ?? "development",
        targetDate: input.targetDate ?? null,
        platforms: {
          android: input.androidStatus ?? "not_planned",
          ios: input.iosStatus ?? "not_planned",
        },
      },
    },
    body: `# v${input.version}\n\n## Hedef\n\nBu sürümün tek cümlelik hedefi.\n\n## Özellikler\n\n- [ ]\n\n## Hatalar\n\n- [ ]\n\n## Test\n\n- [ ] Temel akış testi\n- [ ] Gerçek cihaz testi\n- [ ] Offline/zayıf bağlantı testi\n\n## Store\n\n- [ ] Store metinleri\n- [ ] Ekran görüntüleri\n- [ ] Gizlilik ve formlar\n- [ ] Production build\n\n## Release Notları\n`,
  });
}

export function createProjectDocumentSet(): Omit<ProjectDocumentSet, "project"> {
  return {
    inbox: normalizeMarkdown("# Inbox\n\nAklına gelen fikirleri hızlıca aşağıya ekle.\n\n-\n"),
    decisions: normalizeMarkdown(
      "# Kararlar\n\n## YYYY-MM-DD — Karar başlığı\n\n### Karar\n\nAlınan karar.\n\n### Neden\n\n- Neden 1\n- Neden 2\n\n### Alternatifler\n\n- Alternatif ve nedeni\n\n### Sonuç\n\nBu kararın projeye etkisi.\n",
    ),
    releaseChecklist: normalizeMarkdown(
      "# Release Checklist\n\n## Geliştirme\n\n- [ ] Planlanan özellikler tamamlandı\n- [ ] Kritik bug kalmadı\n- [ ] Test/debug kısayolları production'dan kaldırıldı\n- [ ] Secret ve development endpoint kontrol edildi\n\n## Test\n\n- [ ] Android fiziksel cihaz\n- [ ] iPhone fiziksel cihaz\n- [ ] Tablet\n- [ ] Küçük ekran\n- [ ] Offline\n- [ ] Zayıf internet\n- [ ] Uygulama kapanma/recovery\n- [ ] Upgrade/migration\n\n## Store\n\n- [ ] Uygulama adı ve açıklama\n- [ ] Anahtar kelimeler\n- [ ] Ekran görüntüleri\n- [ ] Uygulama ikonu\n- [ ] Gizlilik politikası\n- [ ] Yaş derecelendirmesi\n- [ ] Veri güvenliği formları\n- [ ] Test grubu\n- [ ] Production gönderimi\n\n## Yayın Sonrası\n\n- [ ] Crash ve hata kontrolü\n- [ ] Kullanıcı geri bildirimi\n- [ ] İlk hotfix adayları\n- [ ] Sonraki sürüm notu\n",
    ),
  };
}

export function parseProjectFrontmatter(source: string): ProjectFrontmatter {
  const value = parseMarkdown(source).frontmatter.stone;
  if (!isRecord(value) || value.type !== "project")
    throw new Error("Project frontmatter is invalid.");
  return value as ProjectFrontmatter;
}

export function parseVersionFrontmatter(source: string): VersionFrontmatter {
  const value = parseMarkdown(source).frontmatter.stone;
  if (!isRecord(value) || value.type !== "version")
    throw new Error("Version frontmatter is invalid.");
  return value as VersionFrontmatter;
}

export function updateProjectFrontmatter(
  source: string,
  patch: Partial<ProjectFrontmatter>,
): string {
  const document = parseMarkdown(source);
  const stone = document.frontmatter.stone;
  if (!isRecord(stone) || stone.type !== "project")
    throw new Error("Project frontmatter is invalid.");
  return serializeMarkdown({
    frontmatter: {
      ...document.frontmatter,
      stone: { ...stone, ...patch } as unknown as FrontmatterValue,
    },
    body: document.body,
  });
}

export function updateVersionFrontmatter(
  source: string,
  patch: Partial<VersionFrontmatter>,
): string {
  const document = parseMarkdown(source);
  const stone = document.frontmatter.stone;
  if (!isRecord(stone) || stone.type !== "version")
    throw new Error("Version frontmatter is invalid.");
  const platforms =
    isRecord(stone.platforms) && isRecord(patch.platforms)
      ? { ...stone.platforms, ...patch.platforms }
      : (patch.platforms ?? stone.platforms);
  return serializeMarkdown({
    frontmatter: {
      ...document.frontmatter,
      stone: { ...stone, ...patch, platforms } as unknown as FrontmatterValue,
    },
    body: document.body,
  });
}

function isRecord(value: FrontmatterValue | undefined): value is Record<string, FrontmatterValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
