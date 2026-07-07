import express from "express";
import multer from "multer";
import { AccessToken } from "livekit-server-sdk";
import { config } from "./config.js";
import { OpenAiSttProvider } from "./providers/stt/openai.js";
import { OpenAiLlmProvider } from "./providers/llm/openai.js";
import { AnthropicLlmProvider } from "./providers/llm/anthropic.js";
import { OpenAiTtsProvider } from "./providers/tts/openai.js";
import { SerperSearchTool } from "./tools/search/serper.js";
import { VoiceAgentService } from "./services/voiceAgentService.js";

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

app.use(express.json());
app.use(express.static("public"));

const { service, capabilities } = buildService();

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/capabilities", (_req, res) => {
  res.json(capabilities);
});

app.post("/api/livekit/token", async (req, res) => {
  try {
    if (!config.livekitUrl || !config.livekitApiKey || !config.livekitApiSecret) {
      return res.status(503).json({
        error: "LiveKit is not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET."
      });
    }

    const room = String(req.body?.room || config.livekitDefaultRoom).trim();
    const identity = String(req.body?.identity || `user-${crypto.randomUUID()}`).trim();
    const name = String(req.body?.name || identity).trim();

    if (!room) {
      return res.status(400).json({ error: "Field 'room' must not be empty." });
    }
    if (!identity) {
      return res.status(400).json({ error: "Field 'identity' must not be empty." });
    }

    const token = new AccessToken(config.livekitApiKey, config.livekitApiSecret, {
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
      url: config.livekitUrl,
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
    if (!file?.buffer) {
      return res.status(400).json({ error: "Missing audio file in form field 'audio'." });
    }

    const result = await service.runTurn({
      audioBuffer: file.buffer,
      audioMimeType: file.mimetype || "audio/webm",
      llmProviderName: req.body.llmProvider,
      llmModel: req.body.llmModel,
      ttsVoice: req.body.ttsVoice
    });

    res.json({
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
      audioBase64: result.speech.audioBuffer.toString("base64"),
      audioMimeType: result.speech.mimeType
    });
  } catch (error) {
    const statusCode = Number(error?.status) || 500;
    if (statusCode >= 500) {
      console.error("Agent turn failed:", error);
    } else {
      console.warn("Agent turn validation issue:", error?.message || error);
    }
    res.status(statusCode).json({ error: error?.message || "Unknown error." });
  }
});

app.post("/api/agent/stream", upload.single("audio"), async (req, res) => {
  const file = req.file;
  if (!file?.buffer) {
    return res.status(400).json({ error: "Missing audio file in form field 'audio'." });
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
    sendEvent("status", { stage: "starting" });
    await service.runTurnStream(
      {
        audioBuffer: file.buffer,
        audioMimeType: file.mimetype || "audio/webm",
        llmProviderName: req.body.llmProvider,
        llmModel: req.body.llmModel,
        ttsVoice: req.body.ttsVoice
      },
      sendEvent
    );
    res.end();
  } catch (error) {
    const statusCode = Number(error?.status) || 500;
    if (statusCode >= 500) {
      console.error("Agent stream failed:", error);
    } else {
      console.warn("Agent stream validation issue:", error?.message || error);
    }
    sendEvent("error", { message: error?.message || "Unknown error." });
    res.end();
  }
});

app.listen(config.port, () => {
  console.log(`Server listening on http://localhost:${config.port}`);
});

function buildService() {
  const sttProvider = new OpenAiSttProvider(config.openaiApiKey);
  const enabledModelsByProvider = {
    openai: ["gpt-3.5-turbo", "gpt-4-0613"],
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
      allowedModelsByProvider: enabledModelsByProvider,
      ttsVoice: config.defaultTtsVoice
    }
    }),
    capabilities
  };
}
