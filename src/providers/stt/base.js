export class SpeechToTextProvider {
  async transcribeAudio(_audioBuffer, _mimeType) {
    throw new Error("SpeechToTextProvider.transcribeAudio must be implemented");
  }
}
