import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createApp } from "../src/server.js";
import { createMetricsRegistry } from "../src/observability/metrics.js";
import { AppError } from "../src/utils/errors.js";

function createFakeService(overrides = {}) {
  return {
    async runTurn({ requestId }) {
      return {
        requestId,
        transcript: { text: "hello", provider: "fake", model: "fake-stt" },
        query: "hello",
        searchResults: [{ title: "A", link: "https://example.com", snippet: "x" }],
        answer: { text: "world", provider: "openai", model: "gpt-3.5-turbo" },
        speech: { audioBuffer: Buffer.from("abc"), mimeType: "audio/mpeg", provider: "openai", model: "tts", voice: "alloy" },
        observability: {
          stageLatencyMs: { stt: 5, search: 4, llm: 10, tts: 7 },
          retriesByStage: { stt: 0, search: 0, llm: 1, tts: 0 },
          totalMs: 30
        }
      };
    },
    async runTurnStream(_input, emitEvent) {
      emitEvent("status", { stage: "transcribing" });
      emitEvent("transcript", { text: "hello" });
      emitEvent("search_results", { query: "hello", items: [] });
      emitEvent("answer", { text: "world", provider: "openai", model: "gpt-3.5-turbo" });
      emitEvent("tts_audio_chunk", { index: 0, dataBase64: Buffer.from("abc").toString("base64") });
      emitEvent("tts_complete", { mimeType: "audio/mpeg" });
      emitEvent("done", { ok: true, requestId: "stream-req" });
    },
    ...overrides
  };
}

async function withServer(service, fn) {
  const app = createApp({
    service,
    metrics: createMetricsRegistry(),
    runtimeConfig: {},
    capabilities: {
      providers: ["openai"],
      modelsByProvider: { openai: ["gpt-3.5-turbo"] },
      disabledModelsByProvider: { openai: ["gpt-4.1-mini"] }
    }
  });
  const server = app.listen(0);
  await once(server, "listening");
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await fn(baseUrl);
  } finally {
    server.close();
  }
}

function buildAudioForm(mimeType = "audio/webm") {
  const form = new FormData();
  form.append("audio", new Blob([new Uint8Array([1, 2, 3])], { type: mimeType }), `sample.${mimeType.split("/")[1] || "webm"}`);
  form.append("llmProvider", "openai");
  form.append("llmModel", "gpt-3.5-turbo");
  return form;
}

test("POST /api/agent/turn returns observability metadata", async () => {
  await withServer(createFakeService(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/agent/turn`, {
      method: "POST",
      body: buildAudioForm()
    });
    assert.equal(response.status, 200);
    const json = await response.json();
    assert.equal(typeof json.requestId, "string");
    assert.equal(json.transcript, "hello");
    assert.equal(json.observability.stageLatencyMs.llm, 10);
    assert.equal(json.observability.retriesByStage.llm, 1);
  });
});

test("POST /api/agent/turn rejects unsupported mime type", async () => {
  await withServer(createFakeService(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/agent/turn`, {
      method: "POST",
      body: buildAudioForm("text/plain")
    });
    assert.equal(response.status, 415);
    const json = await response.json();
    assert.equal(json.code, "UNSUPPORTED_AUDIO_MIME");
  });
});

test("POST /api/agent/stream emits structured stage errors", async () => {
  await withServer(
    createFakeService({
      async runTurnStream() {
        throw new AppError("STT timeout while transcribing.", {
          code: "STT_TIMEOUT",
          status: 504,
          stage: "stt",
          retryable: true
        });
      }
    }),
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/agent/stream`, {
        method: "POST",
        body: buildAudioForm()
      });
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.match(text, /event: error/);
      assert.match(text, /"code":"STT_TIMEOUT"/);
      assert.match(text, /"stage":"stt"/);
    }
  );
});
