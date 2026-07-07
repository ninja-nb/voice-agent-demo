import { SearchTool } from "./base.js";

export class SerperSearchTool extends SearchTool {
  constructor(apiKey) {
    super();
    this.apiKey = apiKey;
  }

  async search(query) {
    if (!this.apiKey) return [];

    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": this.apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ q: query, num: 5 })
    });

    if (!res.ok) {
      throw new Error(`Serper request failed: ${res.status}`);
    }

    const json = await res.json();
    return (json.organic || []).slice(0, 3).map((r) => ({
      title: r.title || "Untitled",
      link: r.link || "",
      snippet: r.snippet || ""
    }));
  }
}
