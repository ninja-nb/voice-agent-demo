import OpenAI from "openai";
import { TextToSpeechProvider } from "./base.js";
import { assertRequired } from "../../config.js";

export class OpenAiTtsProvider extends TextToSpeechProvider {
  constructor(apiKey) {
    super();
    assertRequired(apiKey, "OPENAI_API_KEY");
    this.client = new OpenAI({ apiKey });
  }

  async synthesize(text, opts = {}) {
    const voice = opts.voice || "alloy";
    const model = opts.model || "gpt-4o-mini-tts";
    const format = opts.format || "mp3";

    const audio = await this.client.audio.speech.create({
      model,
      voice,
      input: text,
      format
    });
    const buf = Buffer.from(await audio.arrayBuffer());
    return {
      audioBuffer: buf,
      mimeType: "audio/mpeg",
      provider: "openai",
      model,
      voice
    };
  }
}
