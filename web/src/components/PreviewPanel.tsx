import { useState } from "react";
import { filterRenderableSections, type RenderableSection } from "./sectionMap";

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstString(...values: unknown[]): string {
  for (const v of values) {
    const s = str(v);
    if (s !== "") {
      return s;
    }
  }
  return "";
}

function normalizeLinks(raw: unknown): { label: string; href: string }[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: { label: string; href: string }[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item !== "") {
      out.push({ label: item, href: "#" });
      continue;
    }
    if (!isRecord(item)) {
      continue;
    }
    const href = str(item.href) || str(item.url) || "#";
    const label = str(item.label) || str(item.platform) || str(item.name);
    if (label === "") {
      continue;
    }
    out.push({ label, href });
  }
  return out;
}

function normalizeFaqItems(
  raw: unknown
): { question: string; answer: string }[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: { question: string; answer: string }[] = [];
  for (const item of raw) {
    if (!isRecord(item)) {
      continue;
    }
    out.push({
      question: str(item.question, "Question"),
      answer: str(item.answer)
    });
  }
  return out;
}

function normalizeImages(raw: unknown): { url: string; caption: string }[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: { url: string; caption: string }[] = [];
  for (const item of raw) {
    if (!isRecord(item)) {
      continue;
    }
    const url = str(item.url);
    if (url === "") {
      continue;
    }
    out.push({ url, caption: str(item.caption) });
  }
  return out;
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

function ContactSection({
  section,
  jsonState,
  primary
}: {
  section: RenderableSection;
  jsonState: Record<string, unknown>;
  primary: string;
}) {
  const heading = str(section.content.heading, "Contact");
  const phone = firstString(section.content.phone, jsonState.phone);
  const email = firstString(
    section.content.email,
    jsonState.contactEmail,
    jsonState.email
  );
  const address = firstString(section.content.address, jsonState.address);
  const fieldStyle = {
    borderColor: "#cbd5e1",
    ["--tw-ring-color" as string]: primary
  };
  return (
    <section className="px-6 py-12 bg-slate-50">
      <h2 className="text-2xl font-semibold text-slate-900">{heading}</h2>
      <div className="mt-3 space-y-1 text-sm text-slate-600">
        {phone ? (
          <p>
            <a href={`tel:${phone}`} className="hover:underline">
              {phone}
            </a>
          </p>
        ) : null}
        {email ? (
          <p>
            <a href={`mailto:${email}`} className="hover:underline">
              {email}
            </a>
          </p>
        ) : null}
        {address ? <p>{address}</p> : null}
      </div>
      <form
        className="mt-6 max-w-md space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
        }}
      >
        <label className="block text-sm text-slate-700">
          Name
          <input
            className="mt-1 w-full rounded border px-3 py-2 outline-none focus:ring-2"
            style={fieldStyle}
            name="name"
            type="text"
          />
        </label>
        <label className="block text-sm text-slate-700">
          Email
          <input
            className="mt-1 w-full rounded border px-3 py-2 outline-none focus:ring-2"
            style={fieldStyle}
            name="email"
            type="email"
          />
        </label>
        <label className="block text-sm text-slate-700">
          Message
          <textarea
            className="mt-1 w-full rounded border px-3 py-2 outline-none focus:ring-2"
            style={fieldStyle}
            name="message"
            rows={3}
          />
        </label>
        <button
          type="submit"
          className="rounded px-4 py-2 text-sm text-white"
          style={{ backgroundColor: primary }}
        >
          Send
        </button>
      </form>
    </section>
  );
}

function FaqSection({ section }: { section: RenderableSection }) {
  const heading = str(section.content.heading, "FAQ");
  const items = normalizeFaqItems(section.content.items);
  const [open, setOpen] = useState<Set<number>>(
    () => new Set(items.length > 0 ? [0] : [])
  );

  function toggle(i: number) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) {
        next.delete(i);
      } else {
        next.add(i);
      }
      return next;
    });
  }

  return (
    <section className="px-6 py-12">
      <h2 className="text-2xl font-semibold text-slate-900">{heading}</h2>
      {items.length > 0 ? (
        <ul className="mt-6 divide-y divide-slate-200 border border-slate-200 rounded">
          {items.map((item, i) => {
            const expanded = open.has(i);
            return (
              <li key={`${item.question}-${i}`}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-slate-900"
                  aria-expanded={expanded}
                  onClick={() => toggle(i)}
                >
                  <span>{item.question}</span>
                  <span className="ml-4 text-slate-400">{expanded ? "−" : "+"}</span>
                </button>
                {expanded ? (
                  <div className="px-4 pb-3 text-sm text-slate-600">{item.answer}</div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

function GallerySection({ section }: { section: RenderableSection }) {
  const heading = str(section.content.heading, "Gallery");
  const images = normalizeImages(section.content.images);
  return (
    <section className="px-6 py-12">
      <h2 className="text-2xl font-semibold text-slate-900">{heading}</h2>
      {images.length > 0 ? (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 md:grid-cols-3">
          {images.map((img, i) => (
            <li key={`${img.url}-${i}`} className="overflow-hidden rounded border border-slate-200">
              <img
                src={img.url}
                alt={img.caption || "Image"}
                className="h-40 w-full object-cover"
              />
              {img.caption ? (
                <p className="px-3 py-2 text-sm text-slate-600">{img.caption}</p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function FooterSection({
  section,
  jsonState,
  primary,
  secondary
}: {
  section: RenderableSection;
  jsonState: Record<string, unknown>;
  primary: string;
  secondary: string;
}) {
  const nav = normalizeLinks(
    section.content.navLinks ??
      section.content.links ??
      section.content.navigation
  );
  const social = normalizeLinks(
    section.content.socialLinks ?? section.content.social
  );
  const copyright =
    firstString(section.content.copyright, section.content.text) ||
    (str(jsonState.businessName) ? `© ${str(jsonState.businessName)}` : "");

  return (
    <footer
      className="border-t px-6 py-10 text-sm text-white"
      style={{ backgroundColor: secondary, borderColor: secondary }}
    >
      <div className="flex flex-col gap-6 sm:flex-row sm:justify-between">
        {nav.length > 0 ? (
          <nav className="flex flex-wrap gap-4">
            {nav.map((link, i) => (
              <a
                key={`${link.label}-${i}`}
                href={link.href}
                className="hover:underline"
                style={{ color: primary }}
                {...(link.href.startsWith("http")
                  ? { rel: "noopener noreferrer", target: "_blank" }
                  : {})}
              >
                {link.label}
              </a>
            ))}
          </nav>
        ) : null}
        {social.length > 0 ? (
          <div className="flex flex-wrap gap-4">
            {social.map((link, i) => (
              <a
                key={`${link.label}-${i}`}
                href={link.href}
                className="hover:underline text-white/90"
                {...(link.href.startsWith("http")
                  ? { rel: "noopener noreferrer", target: "_blank" }
                  : {})}
              >
                {link.label}
              </a>
            ))}
          </div>
        ) : null}
      </div>
      {copyright ? <p className="mt-6 text-white/70">{copyright}</p> : null}
    </footer>
  );
}

export default function PreviewPanel({
  jsonState
}: {
  jsonState: Record<string, unknown>;
}) {
  const sections = filterRenderableSections(jsonState);
  const { primary, secondary } = accent(jsonState);

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
            return (
              <ContactSection
                key={section.id}
                section={section}
                jsonState={jsonState}
                primary={primary}
              />
            );
          case "faq":
            return <FaqSection key={section.id} section={section} />;
          case "gallery":
            return <GallerySection key={section.id} section={section} />;
          case "footer":
            return (
              <FooterSection
                key={section.id}
                section={section}
                jsonState={jsonState}
                primary={primary}
                secondary={secondary}
              />
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
