export class TextToSpeechProvider {
  async synthesize(_text, _opts) {
    throw new Error("TextToSpeechProvider.synthesize must be implemented");
  }
}
