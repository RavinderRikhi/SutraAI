import { useState, type FormEvent } from "react";

const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export default function ChatPanel({
  jsonState,
  onJsonStateChange
}: {
  jsonState: Record<string, unknown>;
  onJsonStateChange: (next: Record<string, unknown>) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [subdomainSlug, setSubdomainSlug] = useState("acme");
  const [userMessage, setUserMessage] = useState("");
  const [chatError, setChatError] = useState("");
  const [sending, setSending] = useState(false);
  const [healthResult, setHealthResult] = useState("");

  async function checkHealth() {
    try {
      const response = await fetch(`${apiUrl}/health`);
      const body: unknown = await response.json();
      setHealthResult(JSON.stringify(body, null, 2));
    } catch (error) {
      setHealthResult(error instanceof Error ? error.message : "Request failed");
    }
  }

  async function sendChat(event: FormEvent) {
    event.preventDefault();
    setChatError("");
    const content = userMessage.trim();
    const slug = subdomainSlug.trim();
    if (content === "") {
      setChatError("Enter a message");
      return;
    }
    if (slug === "") {
      setChatError("Enter a subdomain slug");
      return;
    }
    const nextMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content }
    ];
    setMessages(nextMessages);
    setUserMessage("");
    setSending(true);
    try {
      const response = await fetch(`${apiUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subdomainSlug: slug,
          messages: nextMessages,
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
      const reply = typeof body.reply === "string" ? body.reply.trim() : "";
      if (reply === "") {
        setChatError("Response missing reply");
      } else {
        setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
      }
      if (isRecord(body.jsonState)) {
        onJsonStateChange(body.jsonState);
      }
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Request failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-full flex-col bg-slate-950 text-slate-50">
      <div className="space-y-2 border-b border-slate-800 p-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-lg font-semibold">SutraAI</h1>
          <button
            type="button"
            className="rounded bg-sky-600 px-3 py-1.5 text-sm"
            onClick={() => {
              void checkHealth();
            }}
          >
            Check API health
          </button>
        </div>
        <label className="block text-sm">
          Subdomain slug
          <input
            className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2"
            value={subdomainSlug}
            onChange={(e) => setSubdomainSlug(e.target.value)}
          />
        </label>
        {healthResult ? (
          <pre className="max-h-24 overflow-auto rounded bg-slate-900 p-2 text-xs">
            {healthResult}
          </pre>
        ) : null}
      </div>

      <div className="flex-1 space-y-3 overflow-auto p-4">
        {messages.length === 0 ? (
          <p className="text-sm text-slate-400">No messages yet.</p>
        ) : (
          messages.map((msg, i) => (
            <div
              key={`${msg.role}-${i}`}
              className={`rounded p-3 text-sm ${
                msg.role === "user" ? "bg-slate-800" : "bg-slate-900"
              }`}
            >
              <p className="mb-1 text-xs uppercase tracking-wide text-slate-400">
                {msg.role}
              </p>
              <p className="whitespace-pre-wrap">{msg.content}</p>
            </div>
          ))
        )}
      </div>

      <form onSubmit={(e) => void sendChat(e)} className="space-y-2 border-t border-slate-800 p-4">
        {chatError ? <p className="text-sm text-red-400">{chatError}</p> : null}
        <label className="block text-sm">
          Message
          <input
            className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2"
            value={userMessage}
            onChange={(e) => setUserMessage(e.target.value)}
            disabled={sending}
          />
        </label>
        <button
          type="submit"
          disabled={sending}
          className="rounded bg-emerald-600 px-4 py-2 text-sm disabled:opacity-50"
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </form>
    </div>
  );
}
