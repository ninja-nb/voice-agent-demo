export class LlmProvider {
  async generateAnswer(_question, _searchResults, _opts) {
    throw new Error("LlmProvider.generateAnswer must be implemented");
  }
}
