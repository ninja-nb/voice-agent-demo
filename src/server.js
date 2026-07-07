import express from "express";
import multer from "multer";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { AccessToken } from "livekit-server-sdk";
import { config } from "./config.js";
import { createMetricsRegistry } from "./observability/metrics.js";
import { OpenAiSttProvider } from "./providers/stt/openai.js";
import { OpenAiLlmProvider } from "./providers/llm/openai.js";
import { AnthropicLlmProvider } from "./providers/llm/anthropic.js";
import { OpenAiTtsProvider } from "./providers/tts/openai.js";
import { SerperSearchTool } from "./tools/search/serper.js";
import { VoiceAgentService } from "./services/voiceAgentService.js";
import { AppError } from "./utils/errors.js";
import { normalizeError } from "./utils/errors.js";

const ALLOWED_AUDIO_MIME_TYPES = new Set([
  "audio/webm",
  "audio/wav",
  "audio/x-wav",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/m4a",
  "audio/ogg"
]);

export function createApp({ service, capabilities, metrics, runtimeConfig = config }) {
  const app = express();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

  app.use(express.json());
  app.use(express.static("public"));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/capabilities", (_req, res) => {
    res.json(capabilities);
  });

  app.get("/api/metrics", (_req, res) => {
    res.json(metrics.snapshot());
  });

  app.post("/api/livekit/token", async (req, res) => {
  try {
    if (!runtimeConfig.livekitUrl || !runtimeConfig.livekitApiKey || !runtimeConfig.livekitApiSecret) {
      return res.status(503).json({
        error: "LiveKit is not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET."
      });
    }

    const room = String(req.body?.room || runtimeConfig.livekitDefaultRoom).trim();
    const identity = String(req.body?.identity || `user-${crypto.randomUUID()}`).trim();
    const name = String(req.body?.name || identity).trim();

    if (!room) {
      return res.status(400).json({ error: "Field 'room' must not be empty." });
    }
    if (!identity) {
      return res.status(400).json({ error: "Field 'identity' must not be empty." });
    }

    const token = new AccessToken(runtimeConfig.livekitApiKey, runtimeConfig.livekitApiSecret, {
      identity,
      name,
      ttl: "10m"
    });
    token.addGrant({
      roomJoin: true,
      room,
      canPublish: true,
      canSubscribe: true
    });

    res.json({
      url: runtimeConfig.livekitUrl,
      room,
      identity,
      name,
      token: await token.toJwt()
    });
  } catch (error) {
    console.error("LiveKit token creation failed:", error);
    res.status(500).json({ error: "Failed to create LiveKit token." });
  }
  });

  app.post("/api/agent/turn", upload.single("audio"), async (req, res) => {
  try {
    const file = req.file;
    const requestId = createRequestId();
    if (!file?.buffer) {
      return res.status(400).json({ error: "Missing audio file in form field 'audio'." });
    }
    validateAudioMimeType(file.mimetype);

    const result = await service.runTurn({
      requestId,
      audioBuffer: file.buffer,
      audioMimeType: file.mimetype || "audio/webm",
      llmProviderName: req.body.llmProvider,
      llmModel: req.body.llmModel,
      ttsVoice: req.body.ttsVoice
    });

    res.json({
      requestId: result.requestId || requestId,
      transcript: result.transcript.text,
      query: result.query,
      searchResults: result.searchResults,
      answer: result.answer.text,
      llm: {
        provider: result.answer.provider,
        model: result.answer.model
      },
      tts: {
        provider: result.speech.provider,
        model: result.speech.model,
        voice: result.speech.voice
      },
      observability: result.observability,
      audioBase64: result.speech.audioBuffer.toString("base64"),
      audioMimeType: result.speech.mimeType
    });
    console.log(
      `[${requestId}] turn complete totalMs=${result.observability?.totalMs || 0} sttMs=${result.observability?.stageLatencyMs?.stt || 0} searchMs=${result.observability?.stageLatencyMs?.search || 0} llmMs=${result.observability?.stageLatencyMs?.llm || 0} ttsMs=${result.observability?.stageLatencyMs?.tts || 0}`
    );
  } catch (error) {
    const normalized = normalizeError(error);
    const statusCode = Number(normalized.status) || 500;
    metrics.incrementFailure(normalized.code);
    if (statusCode >= 500) {
      console.error("Agent turn failed:", normalized);
    } else {
      console.warn("Agent turn validation issue:", normalized.message || normalized);
    }
    res.status(statusCode).json({
      error: normalized.message || "Unknown error.",
      code: normalized.code || "INTERNAL_ERROR",
      stage: normalized.stage || null
    });
  }
  });

  app.post("/api/agent/stream", upload.single("audio"), async (req, res) => {
  const file = req.file;
  const requestId = createRequestId();
  if (!file?.buffer) {
    return res.status(400).json({ error: "Missing audio file in form field 'audio'." });
  }
  try {
    validateAudioMimeType(file.mimetype);
  } catch (error) {
    const normalized = normalizeError(error);
    metrics.incrementFailure(normalized.code);
    return res.status(normalized.status).json({
      error: normalized.message,
      code: normalized.code,
      stage: normalized.stage || null
    });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    sendEvent("status", { stage: "starting", requestId });
    await service.runTurnStream(
      {
        requestId,
        audioBuffer: file.buffer,
        audioMimeType: file.mimetype || "audio/webm",
        llmProviderName: req.body.llmProvider,
        llmModel: req.body.llmModel,
        ttsVoice: req.body.ttsVoice
      },
      sendEvent
    );
    console.log(`[${requestId}] stream complete`);
    res.end();
  } catch (error) {
    const normalized = normalizeError(error);
    const statusCode = Number(normalized.status) || 500;
    metrics.incrementFailure(normalized.code);
    if (statusCode >= 500) {
      console.error("Agent stream failed:", normalized);
    } else {
      console.warn("Agent stream validation issue:", normalized.message || normalized);
    }
    sendEvent("error", {
      message: normalized.message || "Unknown error.",
      code: normalized.code || "INTERNAL_ERROR",
      stage: normalized.stage || null,
      requestId
    });
    res.end();
  }
  });

  return app;
}

function buildService() {
  const sttProvider = new OpenAiSttProvider(config.openaiApiKey);
  const enabledModelsByProvider = {
    openai: config.openaiEnabledModels,
    anthropic: config.anthropicEnabledModels
  };
  const supportedModelsByProvider = {
    openai: config.openaiSupportedModels,
    anthropic: config.anthropicEnabledModels
  };
  const llmProviders = {
    openai: new OpenAiLlmProvider(config.openaiApiKey)
  };
  if (config.anthropicApiKey && enabledModelsByProvider.anthropic.length) {
    llmProviders.anthropic = new AnthropicLlmProvider(config.anthropicApiKey);
  }
  const ttsProvider = new OpenAiTtsProvider(config.openaiApiKey);
  const searchTool = new SerperSearchTool(config.serperApiKey);

  const capabilities = {
    providers: Object.keys(llmProviders),
    modelsByProvider: Object.fromEntries(
      Object.keys(llmProviders).map((provider) => [provider, enabledModelsByProvider[provider] || []])
    ),
    disabledModelsByProvider: Object.fromEntries(
      Object.keys(llmProviders).map((provider) => {
        const supported = supportedModelsByProvider[provider] || [];
        const enabled = enabledModelsByProvider[provider] || [];
        return [provider, supported.filter((model) => !enabled.includes(model))];
      })
    )
  };

  return {
    service: new VoiceAgentService({
    sttProvider,
    llmProviders,
    ttsProvider,
    searchTool,
    defaults: {
      llmProvider: config.defaultLlmProvider,
      llmModel: config.defaultLlmModel,
      llmModels: {
        openai: config.defaultOpenAiModel,
        anthropic: config.defaultAnthropicModel
      },
      supportedModelsByProvider,
      allowedModelsByProvider: enabledModelsByProvider,
      ttsVoice: config.defaultTtsVoice,
      reliability: config.reliability
    }
    }),
    capabilities
  };
}

function createRequestId() {
  return crypto.randomUUID();
}

function validateAudioMimeType(mimeType) {
  const normalized = String(mimeType || "").toLowerCase();
  if (ALLOWED_AUDIO_MIME_TYPES.has(normalized)) return;
  throw new AppError(`Unsupported audio mime type '${mimeType || "unknown"}'.`, {
    code: "UNSUPPORTED_AUDIO_MIME",
    status: 415,
    stage: "input_validation"
  });
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  const { service, capabilities } = buildService();
  const metrics = createMetricsRegistry();
  const app = createApp({ service, capabilities, metrics, runtimeConfig: config });
  app.listen(config.port, () => {
    console.log(`Server listening on http://localhost:${config.port}`);
  });
}
