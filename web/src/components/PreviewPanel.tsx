import { filterRenderableSections, type RenderableSection } from "./sectionMap";

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function accent(jsonState: Record<string, unknown>): {
  primary: string;
  secondary: string;
} {
  const colors = jsonState.accentColors;
  if (typeof colors === "object" && colors !== null && !Array.isArray(colors)) {
    const c = colors as Record<string, unknown>;
    return {
      primary: str(c.primary, "#0ea5e9"),
      secondary: str(c.secondary, "#334155")
    };
  }
  return { primary: "#0ea5e9", secondary: "#334155" };
}

function HeaderSection({
  section,
  jsonState
}: {
  section: RenderableSection;
  jsonState: Record<string, unknown>;
}) {
  const title =
    str(section.content.title) ||
    str(section.content.businessName) ||
    str(jsonState.businessName, "Site");
  const nav = Array.isArray(section.content.links)
    ? section.content.links.filter((l): l is string => typeof l === "string")
    : [];
  return (
    <header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
      <p className="text-lg font-semibold text-slate-900">{title}</p>
      {nav.length > 0 ? (
        <nav className="flex gap-4 text-sm text-slate-600">
          {nav.map((link) => (
            <span key={link}>{link}</span>
          ))}
        </nav>
      ) : null}
    </header>
  );
}

function HeroSection({
  section,
  jsonState,
  primary
}: {
  section: RenderableSection;
  jsonState: Record<string, unknown>;
  primary: string;
}) {
  const headline =
    str(section.content.headline) ||
    str(section.content.title) ||
    str(jsonState.businessName, "Welcome");
  const tagline =
    str(section.content.tagline) ||
    str(section.content.subtitle) ||
    str(jsonState.tagline, "");
  return (
    <section className="px-6 py-16" style={{ backgroundColor: `${primary}14` }}>
      <h1 className="text-4xl font-bold text-slate-900">{headline}</h1>
      {tagline ? <p className="mt-3 max-w-xl text-lg text-slate-600">{tagline}</p> : null}
    </section>
  );
}

function ServicesSection({ section }: { section: RenderableSection }) {
  const heading = str(section.content.heading, "Services");
  const raw = section.content.items;
  const items = Array.isArray(raw)
    ? raw
        .map((item) => {
          if (typeof item === "string") {
            return { title: item, description: "" };
          }
          if (typeof item === "object" && item !== null && !Array.isArray(item)) {
            const rec = item as Record<string, unknown>;
            return {
              title: str(rec.title, "Service"),
              description: str(rec.description)
            };
          }
          return null;
        })
        .filter((x): x is { title: string; description: string } => x !== null)
    : [];
  return (
    <section className="px-6 py-12">
      <h2 className="text-2xl font-semibold text-slate-900">{heading}</h2>
      <ul className="mt-6 grid gap-4 sm:grid-cols-2">
        {items.map((item, i) => (
          <li key={`${item.title}-${i}`} className="rounded border border-slate-200 p-4">
            <p className="font-medium text-slate-900">{item.title}</p>
            {item.description ? (
              <p className="mt-1 text-sm text-slate-600">{item.description}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ContactSection({ section }: { section: RenderableSection }) {
  const heading = str(section.content.heading, "Contact");
  const email = str(section.content.email);
  return (
    <section className="px-6 py-12 bg-slate-50">
      <h2 className="text-2xl font-semibold text-slate-900">{heading}</h2>
      {email ? <p className="mt-2 text-sm text-slate-600">{email}</p> : null}
      <form
        className="mt-6 max-w-md space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
        }}
      >
        <label className="block text-sm text-slate-700">
          Name
          <input
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
            name="name"
            type="text"
          />
        </label>
        <label className="block text-sm text-slate-700">
          Message
          <textarea
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
            name="message"
            rows={3}
          />
        </label>
        <button
          type="submit"
          className="rounded bg-slate-900 px-4 py-2 text-sm text-white"
        >
          Send
        </button>
      </form>
    </section>
  );
}

export default function PreviewPanel({
  jsonState
}: {
  jsonState: Record<string, unknown>;
}) {
  const sections = filterRenderableSections(jsonState);
  const { primary } = accent(jsonState);

  if (sections.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-white text-slate-500 text-sm p-8">
        No previewable sections yet. Chat to build the site, or Apply JSON in the debug drawer.
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-white text-slate-900">
      {sections.map((section) => {
        switch (section.type) {
          case "header":
            return (
              <HeaderSection key={section.id} section={section} jsonState={jsonState} />
            );
          case "hero":
            return (
              <HeroSection
                key={section.id}
                section={section}
                jsonState={jsonState}
                primary={primary}
              />
            );
          case "services":
            return <ServicesSection key={section.id} section={section} />;
          case "contact":
            return <ContactSection key={section.id} section={section} />;
          default:
            return null;
        }
      })}
    </div>
  );
}
