import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: Number(process.env.PORT || 3000),
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  serperApiKey: process.env.SERPER_API_KEY || "",
  defaultLlmProvider: process.env.DEFAULT_LLM_PROVIDER || "openai",
  // Backward-compatible default used if provider-specific defaults are not set.
  defaultLlmModel: process.env.DEFAULT_LLM_MODEL || "gpt-4.1-mini",
  defaultOpenAiModel: process.env.DEFAULT_OPENAI_MODEL || process.env.DEFAULT_LLM_MODEL || "gpt-4.1-mini",
  defaultAnthropicModel:
    process.env.DEFAULT_ANTHROPIC_MODEL || "claude-3-haiku-20240307",
  anthropicEnabledModels: parseCsv(process.env.ANTHROPIC_ENABLED_MODELS || ""),
  defaultTtsVoice: process.env.DEFAULT_TTS_VOICE || "alloy"
};

export function assertRequired(value, label) {
  if (!value) {
    throw new Error(`Missing required configuration: ${label}`);
  }
}

function parseCsv(value) {
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}
