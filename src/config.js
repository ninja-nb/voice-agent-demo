import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: Number(process.env.PORT || 3000),
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  serperApiKey: process.env.SERPER_API_KEY || "",
  livekitUrl: process.env.LIVEKIT_URL || "",
  livekitApiKey: process.env.LIVEKIT_API_KEY || "",
  livekitApiSecret: process.env.LIVEKIT_API_SECRET || "",
  livekitDefaultRoom: process.env.LIVEKIT_DEFAULT_ROOM || "voice-agent-room",
  defaultLlmProvider: process.env.DEFAULT_LLM_PROVIDER || "openai",
  // Backward-compatible default used if provider-specific defaults are not set.
  defaultLlmModel: process.env.DEFAULT_LLM_MODEL || "gpt-3.5-turbo",
  defaultOpenAiModel: process.env.DEFAULT_OPENAI_MODEL || process.env.DEFAULT_LLM_MODEL || "gpt-3.5-turbo",
  defaultAnthropicModel:
    process.env.DEFAULT_ANTHROPIC_MODEL || "claude-3-haiku-20240307",
  anthropicEnabledModels: parseCsv(process.env.ANTHROPIC_ENABLED_MODELS || ""),
  openaiSupportedModels: parseCsv(
    process.env.OPENAI_SUPPORTED_MODELS || "gpt-3.5-turbo,gpt-4-0613,gpt-4.1-mini,gpt-4o-mini,gpt-4.1"
  ),
  openaiEnabledModels: parseCsv(process.env.OPENAI_ENABLED_MODELS || "gpt-3.5-turbo,gpt-4-0613"),
  defaultTtsVoice: process.env.DEFAULT_TTS_VOICE || "alloy",
  reliability: {
    timeoutMsByStage: {
      stt: Number(process.env.STT_TIMEOUT_MS || 15000),
      search: Number(process.env.SEARCH_TIMEOUT_MS || 6000),
      llm: Number(process.env.LLM_TIMEOUT_MS || 20000),
      tts: Number(process.env.TTS_TIMEOUT_MS || 15000)
    },
    retriesByStage: {
      stt: Number(process.env.STT_RETRIES || 1),
      search: Number(process.env.SEARCH_RETRIES || 1),
      llm: Number(process.env.LLM_RETRIES || 1),
      tts: Number(process.env.TTS_RETRIES || 1)
    }
  }
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
