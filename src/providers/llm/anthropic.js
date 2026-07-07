import Anthropic from "@anthropic-ai/sdk";
import { LlmProvider } from "./base.js";
import { assertRequired } from "../../config.js";

export class AnthropicLlmProvider extends LlmProvider {
  constructor(apiKey) {
    super();
    assertRequired(apiKey, "ANTHROPIC_API_KEY");
    this.client = new Anthropic({ apiKey });
  }

  async generateAnswer(question, searchResults, opts = {}) {
    const model = opts.model || "claude-3-5-sonnet-latest";
    const prompt = buildPrompt(question, searchResults);
    const res = await this.client.messages.create({
      model,
      max_tokens: 700,
      messages: [{ role: "user", content: prompt }]
    });
    const first = res.content.find((c) => c.type === "text");
    return {
      text: first?.text || "I could not generate a response.",
      provider: "anthropic",
      model
    };
  }
}

function buildPrompt(question, searchResults) {
  const snippets = (searchResults || [])
    .map((r, idx) => `[${idx + 1}] ${r.title}\n${r.snippet}\nURL: ${r.link}`)
    .join("\n\n");
  return [
    "You are a helpful assistant.",
    "Use provided context to answer accurately and cite source numbers like [1], [2].",
    "",
    `Question: ${question}`,
    "",
    "Search context:",
    snippets || "No search results."
  ].join("\n");
}
