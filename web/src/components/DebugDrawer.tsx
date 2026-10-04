import { useEffect, useState } from "react";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export default function DebugDrawer({
  open,
  jsonState,
  onJsonStateChange,
  onClose
}: {
  open: boolean;
  jsonState: Record<string, unknown>;
  onJsonStateChange: (next: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("{}");
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setText(JSON.stringify(jsonState, null, 2));
      setError("");
    }
  }, [open, jsonState]);

  function apply() {
    setError("");
    try {
      const parsed: unknown = JSON.parse(text);
      if (!isRecord(parsed)) {
        setError("jsonState must be a JSON object");
        return;
      }
      onJsonStateChange(parsed);
    } catch {
      setError("Invalid JSON");
    }
  }

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
        aria-hidden={!open}
      />
      <aside
        className={`fixed top-0 right-0 z-50 flex h-full w-full max-w-md flex-col border-l border-slate-700 bg-slate-950 text-slate-50 shadow-xl transition-transform duration-200 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        aria-hidden={!open}
      >
        <div className="flex items-center justify-between border-b border-slate-800 p-4">
          <h2 className="text-sm font-medium">Debug: site state (JSON)</h2>
          <button
            type="button"
            className="rounded px-2 py-1 text-sm text-slate-300 hover:bg-slate-800"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="flex flex-1 flex-col gap-3 p-4">
          <textarea
            className="min-h-0 flex-1 w-full rounded border border-slate-700 bg-slate-900 p-3 font-mono text-sm"
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
          />
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          <button
            type="button"
            className="rounded bg-amber-600 px-4 py-2 text-sm"
            onClick={apply}
          >
            Apply
          </button>
        </div>
      </aside>
    </>
  );
}
