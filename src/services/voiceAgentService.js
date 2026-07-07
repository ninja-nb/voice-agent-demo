import { AppError } from "../utils/errors.js";
import { executeStage } from "../utils/resilience.js";

export class VoiceAgentService {
  constructor({ sttProvider, llmProviders, ttsProvider, searchTool, defaults }) {
    this.sttProvider = sttProvider;
    this.llmProviders = llmProviders;
    this.ttsProvider = ttsProvider;
    this.searchTool = searchTool;
    this.defaults = defaults;
  }

  async runTurn({ requestId, audioBuffer, audioMimeType, llmProviderName, llmModel, ttsVoice }) {
    const startedAt = Date.now();
    const telemetry = this.createTelemetry();
    const stt = await this.runStage("stt", telemetry, () =>
      this.sttProvider.transcribeAudio(audioBuffer, audioMimeType)
    );
    const query = stt.text?.trim();
    if (!query) {
      throw createNoTranscriptError();
    }

    const searchResults = await this.runStage("search", telemetry, () => this.searchTool.search(query));
    const providerName = llmProviderName || this.defaults.llmProvider;
    const llm = this.llmProviders[providerName];
    if (!llm) {
      throw new AppError(`Unsupported LLM provider: ${providerName}`, {
        code: "LLM_PROVIDER_UNSUPPORTED",
        status: 400
      });
    }

    const resolvedModel = this.resolveModel(providerName, llmModel);
    const answer = await this.runStage("llm", telemetry, () =>
      llm.generateAnswer(query, searchResults, {
        model: resolvedModel,
        allowedModels: this.getAllowedModels(providerName)
      })
    );

    const tts = await this.runStage("tts", telemetry, () =>
      this.ttsProvider.synthesize(answer.text, {
        voice: ttsVoice || this.defaults.ttsVoice
      })
    );

    return {
      requestId,
      transcript: stt,
      query,
      searchResults,
      answer,
      speech: tts,
      observability: {
        stageLatencyMs: telemetry.stageLatencyMs,
        retriesByStage: telemetry.retriesByStage,
        totalMs: Date.now() - startedAt
      }
    };
  }

  async runTurnStream(
    { requestId, audioBuffer, audioMimeType, llmProviderName, llmModel, ttsVoice },
    emitEvent
  ) {
    const startedAt = Date.now();
    const telemetry = this.createTelemetry();
    emitEvent("status", { stage: "transcribing" });
    const stt = await this.runStage("stt", telemetry, () =>
      this.sttProvider.transcribeAudio(audioBuffer, audioMimeType)
    );
    const query = stt.text?.trim();
    if (!query) {
      throw createNoTranscriptError();
    }
    emitEvent("transcript", { text: stt.text, provider: stt.provider, model: stt.model });

    emitEvent("status", { stage: "searching" });
    const searchResults = await this.runStage("search", telemetry, () => this.searchTool.search(query));
    emitEvent("search_results", { query, items: searchResults });

    const providerName = llmProviderName || this.defaults.llmProvider;
    const llm = this.llmProviders[providerName];
    if (!llm) {
      throw new AppError(`Unsupported LLM provider: ${providerName}`, {
        code: "LLM_PROVIDER_UNSUPPORTED",
        status: 400
      });
    }

    emitEvent("status", { stage: "answering" });
    const resolvedModel = this.resolveModel(providerName, llmModel);
    const answer = await this.runStage("llm", telemetry, () =>
      llm.generateAnswer(query, searchResults, {
        model: resolvedModel,
        allowedModels: this.getAllowedModels(providerName)
      })
    );
    emitEvent("answer", {
      text: answer.text,
      provider: answer.provider,
      model: answer.model
    });

    emitEvent("status", { stage: "synthesizing_audio" });
    const tts = await this.runStage("tts", telemetry, () =>
      this.ttsProvider.synthesize(answer.text, {
        voice: ttsVoice || this.defaults.ttsVoice
      })
    );

    const chunkSize = 16 * 1024;
    for (let offset = 0; offset < tts.audioBuffer.length; offset += chunkSize) {
      const chunk = tts.audioBuffer.subarray(offset, Math.min(offset + chunkSize, tts.audioBuffer.length));
      emitEvent("tts_audio_chunk", {
        index: Math.floor(offset / chunkSize),
        dataBase64: chunk.toString("base64")
      });
    }

    emitEvent("tts_complete", {
      mimeType: tts.mimeType,
      provider: tts.provider,
      model: tts.model,
      voice: tts.voice
    });
    emitEvent("done", {
      ok: true,
      requestId,
      observability: {
        stageLatencyMs: telemetry.stageLatencyMs,
        retriesByStage: telemetry.retriesByStage,
        totalMs: Date.now() - startedAt
      }
    });
  }

  resolveModel(providerName, requestedModel) {
    const oldModelAllowlist = this.defaults.allowedModelsByProvider || {
      openai: new Set(["gpt-3.5-turbo", "gpt-4-0613"]),
      anthropic: new Set(["claude-3-haiku-20240307"])
    };
    const supportedModelsByProvider = this.defaults.supportedModelsByProvider || {};
    const supportedModels = supportedModelsByProvider[providerName] || [];
    const allowedModels = oldModelAllowlist[providerName];
    const isAllowed = (model) =>
      Array.isArray(allowedModels) ? allowedModels.includes(model) : allowedModels?.has(model);
    const isKnownModel = (model) => (Array.isArray(supportedModels) ? supportedModels.includes(model) : true);

    if (requestedModel) {
      if (!isAllowed(requestedModel)) {
        throw new AppError(
          `Model '${requestedModel}' is disabled for cost control. Select one of: ${this.getAllowedModels(providerName).join(", ")}`,
          {
            code: "MODEL_DISABLED",
            status: 400,
            stage: "llm",
            retryable: false
          }
        );
      }
      return requestedModel;
    }
    if (this.defaults.llmModels?.[providerName]) {
      const defaultModel = this.defaults.llmModels[providerName];
      if (!isAllowed(defaultModel)) {
        if (isKnownModel(defaultModel)) {
          throw new AppError(
            `Default model '${defaultModel}' is disabled for provider '${providerName}'. Update env configuration.`,
            {
              code: "MODEL_DISABLED",
              status: 500,
              stage: "llm",
              retryable: false
            }
          );
        }
        throw new AppError(`Default model '${defaultModel}' is not recognized for provider '${providerName}'.`, {
          code: "MODEL_UNKNOWN",
          status: 500,
          stage: "llm",
          retryable: false
        });
      }
      return defaultModel;
    }
    return this.defaults.llmModel;
  }

  getAllowedModels(providerName) {
    const allowed = this.defaults.allowedModelsByProvider?.[providerName];
    if (!allowed) return [];
    return Array.isArray(allowed) ? allowed : [...allowed];
  }

  createTelemetry() {
    return {
      retriesByStage: { stt: 0, search: 0, llm: 0, tts: 0 },
      stageLatencyMs: { stt: 0, search: 0, llm: 0, tts: 0 }
    };
  }

  async runStage(stage, telemetry, fn) {
    const startedAt = Date.now();
    try {
      return await executeStage({
        stage,
        fn,
        timeoutMs: this.defaults.reliability?.timeoutMsByStage?.[stage],
        retries: this.defaults.reliability?.retriesByStage?.[stage] ?? 0,
        onRetry: () => {
          telemetry.retriesByStage[stage] = (telemetry.retriesByStage[stage] || 0) + 1;
        }
      });
    } finally {
      telemetry.stageLatencyMs[stage] = Date.now() - startedAt;
    }
  }
}

function createNoTranscriptError() {
  const error = new Error("No speech detected. Please record clearer audio and try again.");
  error.code = "NO_TRANSCRIPT_TEXT";
  error.status = 422;
  return error;
}
