import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: Number(process.env.PORT || 3000),
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  serperApiKey: process.env.SERPER_API_KEY || "",
  defaultLlmProvider: process.env.DEFAULT_LLM_PROVIDER || "openai",
  defaultLlmModel: process.env.DEFAULT_LLM_MODEL || "gpt-4.1-mini",
  defaultTtsVoice: process.env.DEFAULT_TTS_VOICE || "alloy"
};

export function assertRequired(value, label) {
  if (!value) {
    throw new Error(`Missing required configuration: ${label}`);
  }
}
