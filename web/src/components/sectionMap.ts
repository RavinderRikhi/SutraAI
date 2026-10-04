export type SectionType =
  | "header"
  | "hero"
  | "services"
  | "contact"
  | "faq"
  | "gallery"
  | "footer";

export type RenderableSection = {
  id: string;
  type: SectionType;
  content: Record<string, unknown>;
};

const RENDERABLE = new Set<string>([
  "header",
  "hero",
  "services",
  "contact",
  "faq",
  "gallery",
  "footer"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function filterRenderableSections(
  jsonState: Record<string, unknown>
): RenderableSection[] {
  const sections = jsonState.sections;
  if (!Array.isArray(sections)) {
    return [];
  }
  const out: RenderableSection[] = [];
  for (const item of sections) {
    if (!isRecord(item)) {
      continue;
    }
    const type = item.type;
    if (typeof type !== "string" || !RENDERABLE.has(type)) {
      continue;
    }
    const id =
      typeof item.id === "string" && item.id !== ""
        ? item.id
        : `${type}-${out.length}`;
    const content = isRecord(item.content) ? item.content : {};
    out.push({ id, type: type as SectionType, content });
  }
  return out;
}
