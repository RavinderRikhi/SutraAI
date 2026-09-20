import { useState } from "react";

const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export default function App() {
  const [healthResult, setHealthResult] = useState<string>("");
  const [subdomainSlug, setSubdomainSlug] = useState("acme");
  const [jsonStateText, setJsonStateText] = useState("{}");
  const [userMessage, setUserMessage] = useState("");
  const [reply, setReply] = useState("");
  const [chatError, setChatError] = useState("");

  async function checkHealth() {
    try {
      const response = await fetch(`${apiUrl}/health`);
      const body: unknown = await response.json();
      setHealthResult(JSON.stringify(body, null, 2));
    } catch (error) {
      setHealthResult(error instanceof Error ? error.message : "Request failed");
    }
  }

  async function sendChat() {
    setChatError("");
    setReply("");
    let jsonState: Record<string, unknown>;
    try {
      jsonState = JSON.parse(jsonStateText) as Record<string, unknown>;
      if (
        typeof jsonState !== "object" ||
        jsonState === null ||
        Array.isArray(jsonState)
      ) {
        throw new Error("jsonState must be a JSON object");
      }
    } catch {
      setChatError("Invalid JSON in site state");
      return;
    }
    const content = userMessage.trim();
    if (content === "") {
      setChatError("Enter a message");
      return;
    }
    const slug = subdomainSlug.trim();
    if (slug === "") {
      setChatError("Enter a subdomain slug");
      return;
    }
    try {
      const response = await fetch(`${apiUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subdomainSlug: slug,
          messages: [{ role: "user", content }],
          jsonState
        })
      });
      const body = (await response.json()) as {
        message?: string;
        reply?: string;
        jsonState?: Record<string, unknown>;
      };
      if (!response.ok) {
        setChatError(body.message ?? `Request failed (${response.status})`);
        return;
      }
      setReply(body.reply ?? "");
      if (body.jsonState) {
        setJsonStateText(JSON.stringify(body.jsonState, null, 2));
      }
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Request failed");
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 p-8 max-w-2xl">
      <h1 className="text-3xl font-semibold">SutraAI</h1>
      <button
        type="button"
        className="mt-6 rounded bg-sky-600 px-4 py-2"
        onClick={() => {
          void checkHealth();
        }}
      >
        Check API health
      </button>
      {healthResult ? (
        <pre className="mt-6 overflow-auto rounded bg-slate-900 p-4 text-sm">
          {healthResult}
        </pre>
      ) : null}

      <section className="mt-10 space-y-3">
        <h2 className="text-xl font-medium">Chat</h2>
        <label className="block text-sm">
          Subdomain slug
          <input
            className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2"
            value={subdomainSlug}
            onChange={(e) => setSubdomainSlug(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          Site state (JSON)
          <textarea
            className="mt-1 h-32 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm"
            value={jsonStateText}
            onChange={(e) => setJsonStateText(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          Message
          <input
            className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2"
            value={userMessage}
            onChange={(e) => setUserMessage(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="rounded bg-emerald-600 px-4 py-2"
          onClick={() => {
            void sendChat();
          }}
        >
          Send
        </button>
        {chatError ? <p className="text-red-400 text-sm">{chatError}</p> : null}
        {reply ? (
          <div className="rounded bg-slate-900 p-4 text-sm">
            <p className="font-medium text-slate-300">Reply</p>
            <p className="mt-2">{reply}</p>
          </div>
        ) : null}
      </section>
    </main>
  );
}
