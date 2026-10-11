import { useEffect, useRef, useState, type FormEvent } from "react";

const apiUrl = import.meta.env?.VITE_API_URL ?? "http://localhost:3000";

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export function messagesForChatApi(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((m) => m.role === "user" || m.role === "assistant");
}

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
  const [isThinking, setIsThinking] = useState(false);
  const [healthResult, setHealthResult] = useState("");
  const feedRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = feedRef.current;
    if (el === null) {
      return;
    }
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, isThinking]);

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
    if (isThinking) {
      return;
    }
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
    setIsThinking(true);
    try {
      const response = await fetch(`${apiUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subdomainSlug: slug,
          messages: messagesForChatApi(nextMessages),
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
      setIsThinking(false);
    }
  }

  async function uploadDocument(file: File): Promise<void> {
    if (isThinking) {
      return;
    }
    setChatError("");
    const slug = subdomainSlug.trim();
    if (slug === "") {
      setChatError("Enter a subdomain slug");
      if (fileInputRef.current !== null) {
        fileInputRef.current.value = "";
      }
      return;
    }

    setIsThinking(true);
    try {
      const formData = new FormData();
      formData.append("subdomainSlug", slug);
      formData.append("files", file);
      const response = await fetch(`${apiUrl}/api/documents/upload`, {
        method: "POST",
        body: formData
      });
      const body = (await response.json()) as { message?: string };
      if (!response.ok) {
        setChatError(body.message ?? `Upload failed (${response.status})`);
        return;
      }
      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          content: `📎 Successfully uploaded ${file.name} — RAG context updated!`
        }
      ]);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setIsThinking(false);
      if (fileInputRef.current !== null) {
        fileInputRef.current.value = "";
      }
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

      <div ref={feedRef} className="flex-1 space-y-3 overflow-auto p-4">
        {messages.length === 0 && !isThinking ? (
          <p className="text-sm text-slate-400">No messages yet.</p>
        ) : (
          messages.map((msg, i) => (
            <div
              key={`${msg.role}-${i}`}
              className={`rounded p-3 text-sm ${
                msg.role === "user"
                  ? "bg-slate-800"
                  : msg.role === "system"
                    ? "bg-slate-900/60 text-slate-300"
                    : "bg-slate-900"
              }`}
            >
              <p className="mb-1 text-xs uppercase tracking-wide text-slate-400">
                {msg.role}
              </p>
              <p className="whitespace-pre-wrap">{msg.content}</p>
            </div>
          ))
        )}
        {isThinking ? (
          <div
            className="rounded bg-slate-900 p-3 text-sm"
            aria-live="polite"
            aria-label="Thinking"
          >
            <p className="mb-1 text-xs uppercase tracking-wide text-slate-400">
              assistant
            </p>
            <div className="flex items-center gap-1 px-1 py-1">
              <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.2s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.1s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400" />
            </div>
          </div>
        ) : null}
      </div>

      <form
        onSubmit={(e) => void sendChat(e)}
        className="space-y-2 border-t border-slate-800 p-4"
      >
        {chatError ? <p className="text-sm text-red-400">{chatError}</p> : null}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.txt"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file === undefined) {
              return;
            }
            void uploadDocument(file);
          }}
        />
        <label className="block text-sm">
          Message
          <div className="mt-1 flex items-stretch gap-2">
            <input
              className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-2"
              value={userMessage}
              onChange={(e) => setUserMessage(e.target.value)}
              disabled={isThinking}
            />
            <button
              type="button"
              disabled={isThinking}
              aria-label="Upload document"
              title="Upload PDF or TXT"
              className="rounded border border-slate-700 bg-slate-900 px-3 text-slate-200 disabled:opacity-50"
              onClick={() => fileInputRef.current?.click()}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5"
                aria-hidden="true"
              >
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <button
              type="submit"
              disabled={isThinking}
              className="rounded bg-emerald-600 px-4 py-2 text-sm disabled:opacity-50"
            >
              {isThinking ? "Sending…" : "Send"}
            </button>
          </div>
        </label>
      </form>
    </div>
  );
}
