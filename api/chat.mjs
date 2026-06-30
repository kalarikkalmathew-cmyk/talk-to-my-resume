import { readFileSync } from "fs";
import { join } from "path";

let SYSTEM_PROMPT, SYSTEM_REMINDER;
try {
  // system-prompt.md is bundled via vercel.json -> functions.includeFiles
  const raw = readFileSync(join(process.cwd(), "system-prompt.md"), "utf8");
  const mainMatch = raw.match(/# System Prompt\n([\s\S]*?)## Reminder/);
  SYSTEM_PROMPT = mainMatch ? mainMatch[1].trim() : raw;
  const reminderMatch = raw.match(/## Reminder\n([\s\S]*?)$/);
  SYSTEM_REMINDER = reminderMatch ? reminderMatch[1].trim() : "";
} catch (err) {
  console.error("Failed to read system-prompt.md:", err.message);
  SYSTEM_PROMPT = "You are an AI assistant. Answer questions briefly.";
  SYSTEM_REMINDER = "";
}

const MAX_INPUT_LENGTH = 12000;
const MAX_HISTORY_MSG_LENGTH = 1200;
const MAX_TOKENS = 2048;

// Production origin for cross-origin (agent-to-agent) access. Same-origin
// requests from the resume UI work regardless of this list.
// TODO: set to the final Vercel domain once the project is created.
const ALLOWED_ORIGINS = new Set(
  [
    process.env.PUBLIC_ORIGIN, // e.g. https://talk-to-my-resume.vercel.app
  ].filter(Boolean)
);

const PROVIDER = "anthropic"; // anthropic or groq
const API_KEY = process.env.ANTHROPIC_API_KEY;

function isOriginAllowed(origin) {
  if (!origin) return true; // Same-origin requests (Samsung Internet strips Origin header)
  if (ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const hostname = new URL(origin).hostname;
    if (hostname === "localhost" || hostname === "127.0.0.1") return true;
    if (hostname.endsWith(".vercel.app")) return true; // preview + prod deploys
  } catch { /* invalid origin */ }
  return false;
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": isOriginAllowed(origin) ? (origin || "*") : "",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts)/i,
  /(what|tell\s+me)\s+(is|are)?\s*your\s+(system|initial|exact)\s*(prompt|instructions)/i,
  /reveal\s+your\s+(prompt|instructions|system|rules|setup)/i,
  /repeat\s+(the|your)\s+(above|system|initial)/i,
  /(show|print|display|output)\s+(me\s+)?your\s+(prompt|instructions|system)/i,
  /\bDAN\b|do\s+anything\s+now/i,
  /(pretend|act|roleplay)\s+(you\s+are|as|like)/i,
  /write\s+(me\s+)?(a\s+)?(poem|story|code|song|essay|joke|limerick)/i,
];

function isInjectionAttempt(text) {
  return INJECTION_PATTERNS.some((p) => p.test(text));
}

function looksLikeJobFitAnalysis(text) {
  const lc = text.toLowerCase();
  const fitSignals = [
    "good fit",
    "right fit",
    "fit for this role",
    "fit for this job",
    "job description",
    "job spec",
    "role description",
    "requirements",
    "responsibilities",
    "qualifications",
    "what more can",
    "how would Mathew fit",
  ];
  const jdSignals = [
    "about the role",
    "key responsibilities",
    "what you'll do",
    "what you will do",
    "what you bring",
    "must have",
    "nice to have",
    "who we are",
    "we are looking for",
    "the role",
  ];
  if (fitSignals.some((s) => lc.includes(s))) return true;
  if (jdSignals.some((s) => lc.includes(s))) return true;
  return text.split("\n").length >= 6 && text.length >= 400;
}

function buildAnthropicRequest(system, messages) {
  return fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      system,
      messages,
      max_tokens: MAX_TOKENS,
      stream: true,
    }),
  });
}

function buildGroqRequest(system, messages) {
  return fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "system", content: system }, ...messages],
      max_tokens: MAX_TOKENS,
      stream: true,
    }),
  });
}

async function pipeAnthropicSSE(apiRes, controller) {
  const reader = apiRes.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;
        try {
          const ev = JSON.parse(data);
          if (
            ev.type === "content_block_delta" &&
            ev.delta?.type === "text_delta" &&
            ev.delta.text
          ) {
            controller.enqueue(
              new TextEncoder().encode(`data: ${JSON.stringify({ text: ev.delta.text })}\n\n`)
            );
          }
        } catch { /* skip malformed lines */ }
      }
    }
    controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
    controller.close();
  } catch (err) {
    controller.enqueue(
      new TextEncoder().encode(`data: ${JSON.stringify({ error: err.message })}\n\n`)
    );
    controller.close();
  }
}

async function pipeGroqSSE(apiRes, controller) {
  const reader = apiRes.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;
        try {
          const ev = JSON.parse(data);
          if (ev.choices?.[0]?.delta?.content) {
            controller.enqueue(
              new TextEncoder().encode(`data: ${JSON.stringify({ text: ev.choices[0].delta.content })}\n\n`)
            );
          }
        } catch { /* skip malformed lines */ }
      }
    }
    controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
    controller.close();
  } catch (err) {
    controller.enqueue(
      new TextEncoder().encode(`data: ${JSON.stringify({ error: err.message })}\n\n`)
    );
    controller.close();
  }
}

export async function OPTIONS(request) {
  const origin = request.headers.get("origin") || "";
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function POST(request) {
  const origin = request.headers.get("origin") || "";
  const cors = corsHeaders(origin);

  try {
    const body = await request.json();
    const input = String(body.input || "").trim().slice(0, MAX_INPUT_LENGTH);
    if (!input) {
      return new Response(JSON.stringify({ error: "Empty input" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    if (isInjectionAttempt(input)) {
      return new Response(JSON.stringify({ text: "nice try. ask me about Mathew." }), {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Build system string (Anthropic takes system as a top-level field, not a message)
    const systemParts = [SYSTEM_PROMPT];
    if (looksLikeJobFitAnalysis(input)) {
      systemParts.push(
        [
          "This is a recruiter fit-analysis request.",
          "Break the answer into: role summary, Mathew profile, overlap/synergies, gaps or risks, verdict, and what more Mathew can bring to the table.",
          "Be optimistic first, then honest. If fit is weak, suggest adjacent roles in the same company where Mathew is a stronger match.",
          "Use bullets when helpful and keep the answer structured.",
        ].join(" ")
      );
    }
    if (SYSTEM_REMINDER) systemParts.push(SYSTEM_REMINDER);
    const system = systemParts.join("\n\n");

    // Build messages array — Anthropic only allows user/assistant roles
    const history = Array.isArray(body.history) ? body.history.slice(-6) : [];
    const messages = [];
    for (const msg of history) {
      if (msg.role === "user" || msg.role === "assistant") {
        const limit = msg.role === "assistant" ? MAX_HISTORY_MSG_LENGTH : MAX_INPUT_LENGTH;
        const content = String(msg.content || "").slice(0, limit);
        if (content && (msg.role === "assistant" || !isInjectionAttempt(content))) {
          messages.push({ role: msg.role, content });
        }
      }
    }
    messages.push({ role: "user", content: input });

    const isGroq = PROVIDER === "groq";
    const apiRes = await (isGroq ? buildGroqRequest(system, messages) : buildAnthropicRequest(system, messages));

    if (!apiRes.ok) {
      const err = await apiRes.json().catch(() => ({}));
      console.error(`${isGroq ? "Groq" : "Anthropic"} API error:`, apiRes.status, err);
      return new Response(
        JSON.stringify({ error: `API unavailable. Check your ANTHROPIC_API_KEY.` }),
        { status: 503, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const readable = new ReadableStream({
      start(controller) {
        if (isGroq) {
          pipeGroqSSE(apiRes, controller);
        } else {
          pipeAnthropicSSE(apiRes, controller);
        }
      },
    });

    return new Response(readable, {
      status: 200,
      headers: {
        ...cors,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    console.error("Handler error:", err);
    return new Response(JSON.stringify({ error: "Something went wrong." }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
}
