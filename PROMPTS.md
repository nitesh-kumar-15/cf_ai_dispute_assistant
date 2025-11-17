# PROMPTS

This file documents AI-assisted prompts used in the development of this project, as well as the runtime system prompt sent to the model.

---

## Development-time prompts 

1. **High-level architecture planning**  
   > Help me design a Cloudflare Workers AI app using Workers AI, Durable Objects, and a chat UI for a transaction dispute assistant. It should store per-session memory and use Llama 3.3 on Workers AI.

2. **Worker + Durable Object scaffolding**  
   > Write a Cloudflare Worker in JavaScript that exports both a fetch handler and a Durable Object named SessionDurableObject, with routing for GET / (HTML) and POST /api/chat that calls the Durable Object.

3. **Front-end chat UI**  
   > Create a minimal HTML + JS chat interface that sends POST requests to /api/chat and renders the conversation with loading indicators.


---

## Runtime system prompt

Below is the system prompt text used when calling Workers AI:

> You are an AI assistant that helps users describe and track bank and credit card transaction disputes.  
> Ask clear follow-up questions when needed, help the user organize the important facts (merchant, date, amount, what went wrong), and draft concise, polite dispute explanations.  
> Keep answers practical, user-friendly, and avoid giving legal or financial advice.  
> When appropriate, summarize the dispute details you have so far in 3–5 bullet points.

