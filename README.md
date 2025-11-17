# Cloudflare AI Dispute Assistant

An AI-powered **transaction dispute assistant** built on Cloudflare that helps users describe, refine, and track card or bank transaction disputes via a chat interface.

The app uses:

- **Workers AI** (Llama 3.3) for language understanding and response generation.
- **Durable Objects** for per-session memory and state (chat history + dispute context).
- A **single Worker** that serves both:
  - A minimal web-based **chat UI**.
  - A JSON **/api/chat** endpoint to handle user messages.

This repository is designed to satisfy the Cloudflare AI application assignment requirements:
- LLM: Workers AI (Llama 3.3 instruct model).
- Workflow / coordination: Durable Objects.
- User input via chat: Web UI served by the Worker.
- Memory / state: Per-session Durable Object that stores conversation and dispute context.

---

## Architecture Overview

### High-level flow

1. User opens the root URL `/` in a browser.
2. The Worker serves a simple HTML page with a chat interface.
3. When the user sends a message, the frontend sends a `POST` request to `/api/chat` with the message text.
4. The Worker:
   - Retrieves or creates a **session id** (stored in an HTTP cookie).
   - Routes the request to a **Durable Object instance** associated with that session.
5. The Durable Object:
   - Loads stored session data (chat history + dispute context).
   - Calls **Workers AI (Llama 3.3)** with:
     - A system prompt tailored for a dispute assistant.
     - The existing conversation history.
     - The latest user message.
   - Receives the AI response, appends messages to history, and updates dispute context.
   - Returns the AI’s reply and the current dispute state to the Worker.
6. The Worker forwards the reply back to the frontend, which updates the chat window.

### Components

- **`src/index.js`**
  - Exports the main Worker (`fetch` handler).
  - Exports the `SessionDurableObject` class for Durable Objects.
  - Handles routing for:
    - `GET /` → returns HTML chat UI.
    - `POST /api/chat` → sends messages to the Durable Object.
- **Durable Object (`SessionDurableObject`)**
  - Stores:
    - `messages`: array of `{ role, content }` in chat format.
    - `dispute`: object with lightweight structured state (`summary`, `lastUpdated`, etc.).
  - Calls `env.AI.run` to invoke Workers AI.
  - Persists state in `this.state.storage`.
- **Frontend**
  - Minimal HTML/JS/CSS served inline from `/`.
  - Provides a chat window, input box, send button, and basic loading indication.

---

## Getting Started

### Prerequisites

- Node.js (recommended >= 18)
- `npm` or `pnpm`/`yarn`
- A Cloudflare account
- `wrangler` (installed locally via `npm` or globally)

Install dependencies:

```bash
npm install
```

> This will install `wrangler` locally so you can run `npx wrangler dev` and `npx wrangler deploy`.

---

## Configuration (wrangler.toml)

`wrangler.toml` is configured with:

- `main = "src/index.js"`
- `workers_ai` binding: `AI`
- `durable_objects` binding:
  - `name = "SESSION_DO"`
  - `class_name = "SessionDurableObject"`

You should have a Workers AI model available (for example, `@cf/meta/llama-3.3-70b-instruct`). If Cloudflare updates model names, adjust the model identifier in `src/index.js` where `MODEL_ID` is defined.

### Migrations for Durable Objects

This project includes a basic migration to register the Durable Object:

```toml
[[migrations]]
tag = "v1"
new_classes = ["SessionDurableObject"]
```

If you add further classes or change the Durable Object name, update `wrangler.toml` and add new migrations as needed.

---

## Running the Project Locally

1. **Dev server**

   Start the dev server with:

   ```bash
   npx wrangler dev
   ```

   By default, this will run your Worker on a local dev URL (printed in the console).

2. **Open the app**

   Open the printed URL in your browser (e.g., `http://127.0.0.1:8787/`). You should see the chat interface.

3. **Try a conversation**

   Enter a message like:

   > I was charged twice for a purchase at Store X for $45. How should I describe this in my dispute?

   The model should respond with clarifying questions and/or a helpful dispute summary.

---

## Deploying to Cloudflare

1. Log in to Cloudflare via Wrangler, if you haven’t already:

   ```bash
   npx wrangler login
   ```

2. Deploy:

   ```bash
   npx wrangler deploy
   ```

   This will deploy the Worker and Durable Object to Cloudflare.

3. After deployment, Wrangler will print a public URL. Open that URL to access the app on the internet.

---

## Files Overview

- `wrangler.toml` — Cloudflare Worker & Durable Object configuration (bindings, migrations, etc.).
- `package.json` — Node project metadata and scripts.
- `src/index.js` — Main Worker, Durable Object, and inline HTML chat UI.
- `PROMPTS.md` — Prompts used with AI tools during development and runtime system prompts.

---

## How It Uses AI

- **Model:** The Worker calls **Workers AI** with the model id defined in `MODEL_ID` (default is Llama 3.3 instruct).
- **Conversation format:** Messages are sent in OpenAI-style `{ role, content }` arrays, including:
  - System prompt describing the assistant behavior.
  - Previous user/assistant messages (from Durable Object state).
  - Latest user message.
- **Output:** The assistant reply is extracted from `result.response` or `result.output_text` (with a fallback to `JSON.stringify(result)` if the shape changes).

If Cloudflare changes the response shape for Workers AI, update this extraction logic in `SessionDurableObject._runModel`.

---

## How Memory and State Work

The Durable Object uses `this.state.storage` to persist per-session data:

```js
{
  messages: [ { role: "user" | "assistant", content: string }, ... ],
  dispute: {
    summary: string | null,
    lastUpdated: string | null,
    lastUserMessage: string | null
  }
}
```

- Each time the user sends a message:
  - The message is added to `messages`.
  - The model is called with the full conversation context.
  - The AI reply is stored.
  - A lightweight `dispute.summary` is updated.
- This produces a **stateful AI chat** that remembers prior context for each session.

Sessions are keyed by a cookie named `cf_ai_session_id`. If no cookie is present, a new id is generated and set by the Worker.


---

## License

This project is provided as sample assignment code.
