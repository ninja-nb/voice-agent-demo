import OpenAI from "openai";
import { LlmProvider } from "./base.js";
import { assertRequired } from "../../config.js";

export class OpenAiLlmProvider extends LlmProvider {
  constructor(apiKey) {
    super();
    assertRequired(apiKey, "OPENAI_API_KEY");
    this.client = new OpenAI({ apiKey });
  }

  async generateAnswer(question, searchResults, opts = {}) {
    const model = opts.model || "gpt-4.1-mini";
    const prompt = buildPrompt(question, searchResults);
    const res = await this.client.responses.create({
      model,
      input: prompt
    });
    const text = res.output_text || "I could not generate a response.";
    return { text, provider: "openai", model };
  }
}

function buildPrompt(question, searchResults) {
  const snippets = (searchResults || [])
    .map((r, idx) => `[${idx + 1}] ${r.title}\n${r.snippet}\nURL: ${r.link}`)
    .join("\n\n");
  return [
    "You are a helpful assistant.",
    "Answer the user's question using search context when relevant.",
    "If context is insufficient, say what is missing.",
    "",
    `Question: ${question}`,
    "",
    "Search context:",
    snippets || "No search results."
  ].join("\n");
}
