import { useState } from "react";
import ChatPanel from "./ChatPanel";
import PreviewPanel from "./PreviewPanel";
import DebugDrawer from "./DebugDrawer";

export default function Dashboard() {
  const [jsonState, setJsonState] = useState<Record<string, unknown>>({});
  const [debugOpen, setDebugOpen] = useState(false);

  return (
    <div className="relative h-screen overflow-hidden bg-slate-900">
      <button
        type="button"
        className="absolute top-3 right-3 z-30 rounded bg-slate-700 px-3 py-1.5 text-sm text-white"
        onClick={() => setDebugOpen(true)}
      >
        Show JSON
      </button>
      <div className="grid h-full grid-cols-1 md:grid-cols-2">
        <ChatPanel jsonState={jsonState} onJsonStateChange={setJsonState} />
        <div className="min-h-0 border-l border-slate-800">
          <PreviewPanel jsonState={jsonState} />
        </div>
      </div>
      <DebugDrawer
        open={debugOpen}
        jsonState={jsonState}
        onJsonStateChange={setJsonState}
        onClose={() => setDebugOpen(false)}
      />
    </div>
  );
}
