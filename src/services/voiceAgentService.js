export class VoiceAgentService {
  constructor({ sttProvider, llmProviders, ttsProvider, searchTool, defaults }) {
    this.sttProvider = sttProvider;
    this.llmProviders = llmProviders;
    this.ttsProvider = ttsProvider;
    this.searchTool = searchTool;
    this.defaults = defaults;
  }

  async runTurn({ audioBuffer, audioMimeType, llmProviderName, llmModel, ttsVoice }) {
    const stt = await this.sttProvider.transcribeAudio(audioBuffer, audioMimeType);
    const query = stt.text?.trim();
    if (!query) {
      throw createNoTranscriptError();
    }

    const searchResults = await this.searchTool.search(query);
    const providerName = llmProviderName || this.defaults.llmProvider;
    const llm = this.llmProviders[providerName];
    if (!llm) {
      throw new Error(`Unsupported LLM provider: ${providerName}`);
    }

    const resolvedModel = this.resolveModel(providerName, llmModel);
    const answer = await llm.generateAnswer(query, searchResults, {
      model: resolvedModel,
      allowedModels: this.getAllowedModels(providerName)
    });

    const tts = await this.ttsProvider.synthesize(answer.text, {
      voice: ttsVoice || this.defaults.ttsVoice
    });

    return {
      transcript: stt,
      query,
      searchResults,
      answer,
      speech: tts
    };
  }

  async runTurnStream(
    { audioBuffer, audioMimeType, llmProviderName, llmModel, ttsVoice },
    emitEvent
  ) {
    emitEvent("status", { stage: "transcribing" });
    const stt = await this.sttProvider.transcribeAudio(audioBuffer, audioMimeType);
    const query = stt.text?.trim();
    if (!query) {
      throw createNoTranscriptError();
    }
    emitEvent("transcript", { text: stt.text, provider: stt.provider, model: stt.model });

    emitEvent("status", { stage: "searching" });
    const searchResults = await this.searchTool.search(query);
    emitEvent("search_results", { query, items: searchResults });

    const providerName = llmProviderName || this.defaults.llmProvider;
    const llm = this.llmProviders[providerName];
    if (!llm) {
      throw new Error(`Unsupported LLM provider: ${providerName}`);
    }

    emitEvent("status", { stage: "answering" });
    const resolvedModel = this.resolveModel(providerName, llmModel);
    const answer = await llm.generateAnswer(query, searchResults, {
      model: resolvedModel,
      allowedModels: this.getAllowedModels(providerName)
    });
    emitEvent("answer", {
      text: answer.text,
      provider: answer.provider,
      model: answer.model
    });

    emitEvent("status", { stage: "synthesizing_audio" });
    const tts = await this.ttsProvider.synthesize(answer.text, {
      voice: ttsVoice || this.defaults.ttsVoice
    });

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
    emitEvent("done", { ok: true });
  }

  resolveModel(providerName, requestedModel) {
    const oldModelAllowlist = this.defaults.allowedModelsByProvider || {
      openai: new Set(["gpt-3.5-turbo", "gpt-4-0613"]),
      anthropic: new Set(["claude-3-haiku-20240307"])
    };
    const allowedModels = oldModelAllowlist[providerName];
    const isAllowed = (model) =>
      Array.isArray(allowedModels) ? allowedModels.includes(model) : allowedModels?.has(model);

    if (requestedModel) {
      if (!isAllowed(requestedModel)) {
        throw new Error(`Model '${requestedModel}' is disabled. Select one of the allowed old models.`);
      }
      return requestedModel;
    }
    if (this.defaults.llmModels?.[providerName]) {
      const defaultModel = this.defaults.llmModels[providerName];
      if (!isAllowed(defaultModel)) {
        return Array.isArray(allowedModels) ? allowedModels[0] : [...(allowedModels || [])][0];
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
}

function createNoTranscriptError() {
  const error = new Error("No speech detected. Please record clearer audio and try again.");
  error.code = "NO_TRANSCRIPT_TEXT";
  error.status = 422;
  return error;
}
