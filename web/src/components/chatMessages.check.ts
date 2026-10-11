import assert from "node:assert/strict";
import { messagesForChatApi, type ChatMessage } from "./ChatPanel.tsx";

const input: ChatMessage[] = [
  { role: "system", content: "📎 Successfully uploaded a.txt — RAG context updated!" },
  { role: "user", content: "Hi" },
  { role: "assistant", content: "Hello" },
  { role: "system", content: "noise" },
  { role: "user", content: "Again" }
];

const out = messagesForChatApi(input);
assert.deepEqual(out, [
  { role: "user", content: "Hi" },
  { role: "assistant", content: "Hello" },
  { role: "user", content: "Again" }
]);
assert.equal(messagesForChatApi([]).length, 0);
assert.deepEqual(
  messagesForChatApi([{ role: "system", content: "only" }]),
  []
);

console.log("chatMessages.check: ok");
