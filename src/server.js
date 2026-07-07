import express from "express";
import multer from "multer";
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

const service = buildService();

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
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
    console.error("Agent turn failed:", error);
    res.status(500).json({ error: error?.message || "Unknown error." });
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
    console.error("Agent stream failed:", error);
    sendEvent("error", { message: error?.message || "Unknown error." });
    res.end();
  }
});

app.listen(config.port, () => {
  console.log(`Server listening on http://localhost:${config.port}`);
});

function buildService() {
  const sttProvider = new OpenAiSttProvider(config.openaiApiKey);
  const llmProviders = {
    openai: new OpenAiLlmProvider(config.openaiApiKey)
  };
  if (config.anthropicApiKey) {
    llmProviders.anthropic = new AnthropicLlmProvider(config.anthropicApiKey);
  }
  const ttsProvider = new OpenAiTtsProvider(config.openaiApiKey);
  const searchTool = new SerperSearchTool(config.serperApiKey);

  return new VoiceAgentService({
    sttProvider,
    llmProviders,
    ttsProvider,
    searchTool,
    defaults: {
      llmProvider: config.defaultLlmProvider,
      llmModel: config.defaultLlmModel,
      ttsVoice: config.defaultTtsVoice
    }
  });
}
