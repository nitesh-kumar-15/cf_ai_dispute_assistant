
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return new Response(renderHtml(), {
        headers: {
          "content-type": "text/html; charset=utf-8"
        }
      });
    }

    if (url.pathname === "/api/chat" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return new Response(JSON.stringify({ error: "Invalid JSON" }), {
          status: 400,
          headers: { "content-type": "application/json" }
        });
      }

      const userMessage = (body && body.message) ? String(body.message) : "";
      if (!userMessage.trim()) {
        return new Response(JSON.stringify({ error: "Message is required" }), {
          status: 400,
          headers: { "content-type": "application/json" }
        });
      }

      const { sessionId, setCookieHeader } = getOrCreateSessionId(request);

      const id = env.SESSION_DO.idFromName(sessionId);
      const stub = env.SESSION_DO.get(id);

      const doResponse = await stub.fetch("https://do.internal/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: userMessage })
      });

      const json = await doResponse.json();

      const headers = {
        "content-type": "application/json"
      };
      if (setCookieHeader) {
        headers["set-cookie"] = setCookieHeader;
      }

      return new Response(JSON.stringify(json), {
        status: doResponse.status,
        headers
      });
    }

    return new Response("Not found", { status: 404 });
  }
};

function getOrCreateSessionId(request) {
  const cookieHeader = request.headers.get("cookie") || "";
  const cookies = Object.fromEntries(
    cookieHeader
      .split(";")
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => {
        const [name, ...rest] = c.split("=");
        return [name, rest.join("=")];
      })
  );

  let sessionId = cookies["cf_ai_session_id"];
  let setCookieHeader = null;

  if (!sessionId) {
    sessionId = (globalThis.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    setCookieHeader = `cf_ai_session_id=${sessionId}; Path=/; SameSite=Lax`;
  }

  return { sessionId, setCookieHeader };
}

export class SessionDurableObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/chat" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return new Response(JSON.stringify({ error: "Invalid JSON" }), {
          status: 400,
          headers: { "content-type": "application/json" }
        });
      }

      const userMessage = (body && body.message) ? String(body.message) : "";
      if (!userMessage.trim()) {
        return new Response(JSON.stringify({ error: "Message is required" }), {
          status: 400,
          headers: { "content-type": "application/json" }
        });
      }

      let session = await this.state.storage.get("session");
      if (!session) {
        session = {
          messages: [],
          dispute: {
            summary: null,
            lastUpdated: null,
            lastUserMessage: null
          }
        };
      }

      session.messages.push({ role: "user", content: userMessage });

      const systemPrompt = [
        "You are an AI assistant that helps users describe and track bank and credit card transaction disputes.",
        "Ask clear follow-up questions when needed, help the user organize the important facts (merchant, date, amount, what went wrong),",
        "and draft concise, polite dispute explanations.",
        "Keep answers practical, user-friendly, and avoid giving legal or financial advice.",
        "When appropriate, summarize the dispute details you have so far in 3–5 bullet points."
      ].join(" ");

      const modelMessages = [
        { role: "system", content: systemPrompt },
        ...session.messages
      ];

      const modelId = this.env.MODEL_ID || "@cf/meta/llama-3-8b-instruct";

      let aiReplyText;
      try {
        aiReplyText = await this._runModel(modelId, modelMessages);
      } catch (err) {
        console.error("Workers AI call failed:", err);
        aiReplyText =
          "AI call failed in this environment. If you're running `wrangler dev --local`, " +
          "this is expected because AI bindings are not available locally. " +
          "Deploy the Worker or use remote dev to get real AI responses.\n\n" +
          "Echoing your last message so you can still test the flow:\n" +
          userMessage;
      }

      session.messages.push({ role: "assistant", content: aiReplyText });

      session.dispute.lastUserMessage = userMessage;
      session.dispute.lastUpdated = new Date().toISOString();
      session.dispute.summary = this._summarizeDispute(session);

      await this.state.storage.put("session", session);

      return new Response(
        JSON.stringify({
          reply: aiReplyText,
          dispute: session.dispute,
          messages: session.messages.slice(-20)
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    }

    if (url.pathname === "/state" && request.method === "GET") {
      const session = (await this.state.storage.get("session")) || null;
      return new Response(JSON.stringify(session), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }

    return new Response("Not found", { status: 404 });
  }

  async _runModel(modelId, messages) {
    if (!this.env.AI || typeof this.env.AI.run !== "function") {
      throw new Error("Workers AI binding is not available in this environment.");
    }

    const result = await this.env.AI.run(modelId, { messages });

    const text =
      (result && (result.response || result.output_text)) ||
      (typeof result === "string" ? result : null);

    if (!text) {
      return JSON.stringify(result);
    }

    return text;
  }

  _summarizeDispute(session) {
    const lastUser = [...session.messages]
      .reverse()
      .find((m) => m.role === "user");
    if (!lastUser) {
      return session.dispute.summary || null;
    }

    const maxLen = 280;
    const base = `Latest dispute description: ${lastUser.content}`;
    if (base.length <= maxLen) return base;
    return base.slice(0, maxLen - 3) + "...";
  }
}

function renderHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Cloudflare AI Dispute Assistant</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #111827;
      background: #f3f4f6;
    }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: radial-gradient(circle at top, #e5e7eb, #f9fafb);
    }
    .app {
      width: 100%;
      max-width: 720px;
      height: 80vh;
      background: #ffffff;
      border-radius: 16px;
      box-shadow: 0 20px 40px rgba(15, 23, 42, 0.15);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .app-header {
      padding: 16px 20px;
      border-bottom: 1px solid #e5e7eb;
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: linear-gradient(to right, #0f172a, #1e293b);
      color: #f9fafb;
    }
    .app-header-title {
      font-size: 1rem;
      font-weight: 600;
    }
    .app-header-subtitle {
      font-size: 0.8rem;
      opacity: 0.8;
    }
    .badge {
      font-size: 0.7rem;
      padding: 4px 8px;
      border-radius: 999px;
      background: rgba(15, 23, 42, 0.9);
      border: 1px solid rgba(148, 163, 184, 0.7);
    }
    .chat {
      flex: 1;
      overflow-y: auto;
      padding: 16px 20px;
      background: #f9fafb;
    }
    .message {
      margin-bottom: 12px;
      display: flex;
      gap: 8px;
    }
    .message.user {
      justify-content: flex-end;
    }
    .bubble {
      max-width: 80%;
      padding: 10px 12px;
      border-radius: 12px;
      font-size: 0.9rem;
      line-height: 1.4;
      white-space: pre-wrap;
    }
    .message.user .bubble {
      background: #2563eb;
      color: #f9fafb;
      border-bottom-right-radius: 4px;
    }
    .message.assistant .bubble {
      background: #e5e7eb;
      color: #111827;
      border-bottom-left-radius: 4px;
    }
    .timestamp {
      font-size: 0.7rem;
      color: #6b7280;
      margin-top: 2px;
    }
    .input-area {
      padding: 10px 16px;
      border-top: 1px solid #e5e7eb;
      background: #ffffff;
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .input-area textarea {
      flex: 1;
      resize: none;
      min-height: 44px;
      max-height: 96px;
      border-radius: 10px;
      border: 1px solid #d1d5db;
      padding: 8px 10px;
      font-size: 0.9rem;
      font-family: inherit;
      outline: none;
    }
    .input-area textarea:focus {
      border-color: #2563eb;
      box-shadow: 0 0 0 1px rgba(37, 99, 235, 0.4);
    }
    .send-btn {
      border: none;
      border-radius: 999px;
      padding: 10px 20px;
      font-size: 0.9rem;
      font-weight: 500;
      background: #2563eb;
      color: #f9fafb;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: background 0.15s ease, transform 0.05s ease;
    }
    .send-btn:hover {
      background: #1d4ed8;
      transform: translateY(-1px);
    }
    .send-btn:disabled {
      opacity: 0.5;
      cursor: default;
      transform: none;
    }
    .status {
      font-size: 0.75rem;
      color: #6b7280;
      padding: 0 18px 6px;
    }
    .status span.dot {
      display: inline-block;
      width: 6px;
      height: 6px;
      border-radius: 999px;
      background: #22c55e;
      margin-right: 6px;
    }
    @media (max-width: 640px) {
      .app {
        height: 100vh;
        border-radius: 0;
        max-width: 100%;
      }
    }
  </style>
</head>
<body>
  <div class="app">
    <div class="app-header">
      <div>
        <div class="app-header-title">Cloudflare AI Dispute Assistant</div>
        <div class="app-header-subtitle">Describe what went wrong, and I’ll help you structure a clear dispute.</div>
      </div>
      <div class="badge">Workers AI · Durable Objects</div>
    </div>
    <div class="status">
      <span class="dot"></span>
      Ready to chat
    </div>
    <div id="chat" class="chat"></div>
    <form id="chat-form" class="input-area">
      <textarea id="message-input" placeholder="Explain your issue, e.g. 'I was charged twice for a purchase at Store X for $45'"></textarea>
      <button type="submit" id="send-btn" class="send-btn">
        <span>Send</span>
        <span>➤</span>
      </button>
    </form>
  </div>

  <script>
    const chatEl = document.getElementById("chat");
    const formEl = document.getElementById("chat-form");
    const inputEl = document.getElementById("message-input");
    const sendBtn = document.getElementById("send-btn");
    const statusEl = document.querySelector(".status");

    const messages = [];

    function addMessage(role, content) {
      messages.push({ role, content, ts: new Date() });
      renderMessages();
    }

    function renderMessages() {
      chatEl.innerHTML = "";
      for (const msg of messages) {
        const item = document.createElement("div");
        item.className = "message " + (msg.role === "user" ? "user" : "assistant");

        const bubble = document.createElement("div");
        bubble.className = "bubble";
        bubble.textContent = msg.content;

        const meta = document.createElement("div");
        meta.className = "timestamp";
        meta.textContent = msg.role === "user" ? "You" : "Assistant";

        const wrapper = document.createElement("div");
        wrapper.appendChild(bubble);
        wrapper.appendChild(meta);

        item.appendChild(wrapper);
        chatEl.appendChild(item);
      }
      chatEl.scrollTop = chatEl.scrollHeight;
    }

    async function sendMessage(content) {
      addMessage("user", content);
      setLoading(true);
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({ message: content })
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          const msg = err && err.error ? err.error : "Something went wrong.";
          addMessage("assistant", "Error: " + msg);
          return;
        }

        const data = await res.json();
        addMessage("assistant", data.reply || "[No reply received]");
      } catch (e) {
        console.error(e);
        addMessage("assistant", "Network error while contacting the assistant.");
      } finally {
        setLoading(false);
      }
    }

    function setLoading(isLoading) {
      if (isLoading) {
        statusEl.innerHTML = '<span class="dot"></span>Thinking...';
        sendBtn.disabled = true;
      } else {
        statusEl.innerHTML = '<span class="dot"></span>Ready to chat';
        sendBtn.disabled = false;
      }
    }

    formEl.addEventListener("submit", (e) => {
      e.preventDefault();
      const value = inputEl.value.trim();
      if (!value) return;
      inputEl.value = "";
      sendMessage(value);
    });

    addMessage(
      "assistant",
      "Hi! I can help you describe and organize a transaction dispute. Tell me what happened, including where you were charged, the amount, and what went wrong."
    );
  </script>
</body>
</html>`;
}
