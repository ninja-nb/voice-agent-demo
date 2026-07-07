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
      throw new Error("No transcript text produced from audio.");
    }

    const searchResults = await this.searchTool.search(query);
    const providerName = llmProviderName || this.defaults.llmProvider;
    const llm = this.llmProviders[providerName];
    if (!llm) {
      throw new Error(`Unsupported LLM provider: ${providerName}`);
    }

    const answer = await llm.generateAnswer(query, searchResults, {
      model: llmModel || this.defaults.llmModel
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
      throw new Error("No transcript text produced from audio.");
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
    const answer = await llm.generateAnswer(query, searchResults, {
      model: llmModel || this.defaults.llmModel
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
}
