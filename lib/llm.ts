import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

let client: Anthropic | undefined; // lazy: constructing throws without a key
const MODEL = process.env.GG_MODEL || "claude-sonnet-5-5";

type Effort = "low" | "medium" | "high";

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
  const messages: [Anthropic.MessageParam] = [{ role: "user", content: opts.prompt }];
  let lastError = "";
  for (let attempt = 0; attempt < (opts.check ? 3 : 2); attempt++) {
    const res = await (client ??= new Anthropic()).messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: opts.system,
      messages,
      output_config: { format: zodOutputFormat(opts.schema), effort: opts.effort ?? "medium" },
    });
    if (res.stop_reason === "refusal") throw new Error("The model declined this request.");
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    const r = opts.schema.safeParse(parsed);
    lastError = r.success ? (opts.check?.(r.data) ?? "") : `Schema validation failed: ${r.error.message}`;
    if (!lastError) return r.data as z.infer<S>;
    if (res.stop_reason === "max_tokens") lastError = "Output was truncated (max_tokens). Be more concise.";
    // Retry as a fresh single-turn request (no replayed assistant turn, so no thinking-block bookkeeping).
    messages[0] = { role: "user", content: `${opts.prompt}\n\n<previous_attempt>\n${text}\n</previous_attempt>\nThat attempt was rejected: ${lastError}\nFix it.` };
  }
  throw new Error(`LLM returned invalid output twice: ${lastError}`);
}
