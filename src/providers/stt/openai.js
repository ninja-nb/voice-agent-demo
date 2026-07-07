import OpenAI from "openai";
import { SpeechToTextProvider } from "./base.js";
import { assertRequired } from "../../config.js";

export class OpenAiSttProvider extends SpeechToTextProvider {
  constructor(apiKey) {
    super();
    assertRequired(apiKey, "OPENAI_API_KEY");
    this.client = new OpenAI({ apiKey });
  }

  async transcribeAudio(audioBuffer, mimeType = "audio/webm") {
    const file = await OpenAI.toFile(audioBuffer, `input.${extFromMime(mimeType)}`, {
      type: mimeType
    });
    const result = await this.client.audio.transcriptions.create({
      model: "gpt-4o-mini-transcribe",
      file
    });
    return {
      text: result.text || "",
      provider: "openai",
      model: "gpt-4o-mini-transcribe"
    };
  }
}

function extFromMime(mimeType) {
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("mp3")) return "mp3";
  if (mimeType.includes("mpeg")) return "mp3";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("webm")) return "webm";
  return "bin";
}
