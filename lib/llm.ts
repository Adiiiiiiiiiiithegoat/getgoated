import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

// Provider: Groq if GROQ_API_KEY is set, else Anthropic.
const GROQ = !!process.env.GROQ_API_KEY;
const MODEL = process.env.GG_MODEL || (GROQ ? "openai/gpt-oss-120b" : "claude-sonnet-5-5");

type Effort = "low" | "medium" | "high";

// ponytail: Groq free tier caps at 8k tokens/minute, so prompts with transcripts must stay small. Raise if you upgrade tiers.
export const TRANSCRIPT_CHARS = GROQ ? 3000 : Infinity;
type Out = { text: string; truncated: boolean };

let anthropic: Anthropic | undefined; // lazy: constructing throws without a key

async function callAnthropic(system: string, prompt: string, schema: z.ZodType, effort: Effort): Promise<Out> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("No LLM key: set GROQ_API_KEY or ANTHROPIC_API_KEY in .env.local (see README → Setup).");
  const res = await (anthropic ??= new Anthropic()).messages.create({
    model: MODEL,
    max_tokens: 16000,
    system,
    messages: [{ role: "user", content: prompt }],
    output_config: { format: zodOutputFormat(schema), effort },
  });
  if (res.stop_reason === "refusal") throw new Error("The model declined this request.");
  return { text: res.content.map((b) => (b.type === "text" ? b.text : "")).join(""), truncated: res.stop_reason === "max_tokens" };
}

/** Compact JSON schema text for the prompt ($schema key dropped: the model sometimes echoed it back as "data"). */
const schemaText = (schema: z.ZodType) => JSON.stringify(z.toJSONSchema(schema), (k, v) => (k === "$schema" ? undefined : v));

// Groq's OpenAI-compatible endpoint; plain fetch, no extra SDK.
async function callGroq(system: string, prompt: string, schema: z.ZodType, effort: Effort, waits = 0): Promise<Out> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_completion_tokens: 16000,
      reasoning_effort: effort,
      messages: [
        {
          role: "system",
          content: `${system}\n\nReply with a single JSON object that is an INSTANCE of this JSON Schema (fill in real values; do not repeat the schema itself):\n${schemaText(schema)}`,
        },
        { role: "user", content: prompt },
      ],
      // ponytail: json_object mode; Groq's json_schema mode only post-validates (no constrained decoding) and failed more often. zod is the gate.
      response_format: { type: "json_object" },
    }),
  });
  const body = await res.json();
  if (res.status === 429) {
    // Free tier is 8k tokens/minute: wait it out (a few times) instead of failing.
    const wait = Number(res.headers.get("retry-after") ?? 20);
    if (waits >= 4 || wait > 90) throw new Error("Groq rate limit hit. Wait a minute and try again.");
    await new Promise((r) => setTimeout(r, (wait + 1) * 1000));
    return callGroq(system, prompt, schema, effort, waits + 1);
  }
  if (!res.ok) {
    // Groq rejects schema-violating output with 400 json_validate_failed; hand it back as text so askJSON retries.
    if (body?.error?.code === "json_validate_failed") return { text: body.error.failed_generation ?? "", truncated: false };
    throw new Error(`Groq error (${res.status}): ${body?.error?.message ?? "unknown"}`);
  }
  const choice = body.choices[0];
  return { text: choice.message.content ?? "", truncated: choice.finish_reason === "length" };
}

/**
 * Structured JSON call validated by zod. `check` adds semantic validation (e.g. "ID must be a candidate").
 * Any failure is fed back to the model; schema errors get one retry, semantic errors two.
 */
export async function askJSON<S extends z.ZodType>(opts: {
  schema: S;
  system: string;
  prompt: string;
  effort?: Effort;
  check?: (data: z.infer<S>) => string | null;
}): Promise<z.infer<S>> {
  let prompt = opts.prompt;
  let lastError = "";
  for (let attempt = 0; attempt < (opts.check ? 3 : 2); attempt++) {
    const { text, truncated } = await (GROQ ? callGroq : callAnthropic)(opts.system, prompt, opts.schema, opts.effort ?? "medium");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    const r = opts.schema.safeParse(parsed);
    lastError = r.success ? (opts.check?.(r.data) ?? "") : `Schema validation failed: ${r.error.message}`;
    if (!lastError) return r.data as z.infer<S>;
    if (truncated) lastError = "Output was truncated (max tokens). Be more concise.";
    // Retry as a fresh single-turn request with the rejected attempt and the reason.
    prompt = `${opts.prompt}\n\n<previous_attempt>\n${text}\n</previous_attempt>\nThat attempt was rejected: ${lastError}\nFix it.`;
  }
  throw new Error(`LLM returned invalid output twice: ${lastError}`);
}
