# Voice AI Agent Design and Architecture

## 1) Purpose

This project is a reference implementation for a **voice AI agent** that:

1. Accepts audio input from a user.
2. Converts speech to text using a third-party STT provider.
3. Performs search/tool retrieval to ground responses.
4. Generates an answer through a selectable LLM provider.
5. Converts the final answer back to speech with a third-party TTS provider.

The architecture is designed so provider integrations are replaceable with minimal code changes.

## 2) System Goals

- Provider-agnostic design for STT, LLM, search, and TTS.
- Fast local testing with a single Node service and browser client.
- Clear extension points for new model vendors and tools.
- Explicit, observable request flow for debugging and reliability.

## 3) High-Level Architecture

```mermaid
flowchart TD
    userClient[WebClient] --> agentApi[AgentAPI]
    agentApi --> sttProvider[SpeechToTextProvider]
    sttProvider --> transcript[TranscriptText]
    transcript --> searchTool[SearchTool]
    searchTool --> contextResults[SearchContext]
    contextResults --> llmProvider[LlmProvider]
    llmProvider --> answerText[AnswerText]
    answerText --> ttsProvider[TextToSpeechProvider]
    ttsProvider --> audioOut[AudioOutput]
    audioOut --> userClient
```

## 4) Components

### 4.1 Frontend

- **File**: `public/index.html`
- Responsibilities:
  - Capture microphone audio or accept uploaded audio files.
  - Submit multipart requests to `/api/agent/turn` (single payload) or `/api/agent/stream` (SSE stream).
  - Display transcript, search results, generated answer, and streaming status stages.
  - Reconstruct audio from streamed chunks and play final synthesized output.

### 4.2 API Layer

- **File**: `src/server.js`
- Responsibilities:
  - Expose health and agent endpoints.
  - Validate audio request payload.
  - Coordinate service execution through `VoiceAgentService`.
  - Support both response modes:
    - Non-streaming JSON payload (`/api/agent/turn`).
    - `text/event-stream` SSE event delivery (`/api/agent/stream`).

### 4.3 Orchestration Service

- **File**: `src/services/voiceAgentService.js`
- Responsibilities:
  - Execute the full agent turn pipeline.
  - Resolve selected provider and model options.
  - Enforce deterministic sequence:
    - STT -> Search -> LLM -> TTS.

### 4.4 Provider Adapters

- STT interface + OpenAI adapter:
  - `src/providers/stt/base.js`
  - `src/providers/stt/openai.js`
- LLM interface + adapters:
  - `src/providers/llm/base.js`
  - `src/providers/llm/openai.js`
  - `src/providers/llm/anthropic.js`
- TTS interface + OpenAI adapter:
  - `src/providers/tts/base.js`
  - `src/providers/tts/openai.js`
- Search tool interface + Serper adapter:
  - `src/tools/search/base.js`
  - `src/tools/search/serper.js`

## 5) API Contract

### `POST /api/agent/turn`

- Content type: `multipart/form-data`
- Fields:
  - `audio` (required)
  - `llmProvider` (optional, example: `openai`, `anthropic`)
  - `llmModel` (optional override)
  - `ttsVoice` (optional override)

Response payload:

- `transcript`
- `query`
- `searchResults`
- `answer`
- `llm` metadata
- `tts` metadata
- `audioBase64`
- `audioMimeType`

### `POST /api/agent/stream`

- Content type (request): `multipart/form-data`
- Content type (response): `text/event-stream`
- Fields:
  - `audio` (required)
  - `llmProvider` (optional, example: `openai`, `anthropic`)
  - `llmModel` (optional override)
  - `ttsVoice` (optional override)

SSE event sequence:

- `status`: stage transitions such as `starting`, `transcribing`, `searching`, `answering`, `synthesizing_audio`
- `transcript`: transcript text + STT metadata
- `search_results`: query + result list
- `answer`: generated answer + LLM metadata
- `tts_audio_chunk`: base64 audio chunks with index
- `tts_complete`: TTS metadata and mime type
- `done`: terminal success event
- `error`: terminal error event

## 6) Runtime Sequence

```mermaid
sequenceDiagram
    participant UI as WebClient
    participant API as AgentAPI
    participant STT as STTProvider
    participant SRCH as SearchTool
    participant LLM as LLMProvider
    participant TTS as TTSProvider

    UI->>API: POST /api/agent/turn (audio)
    API->>STT: transcribeAudio(buffer,mimeType)
    STT-->>API: transcript text
    API->>SRCH: search(transcript)
    SRCH-->>API: top results
    API->>LLM: generateAnswer(query,searchResults)
    LLM-->>API: answer text
    API->>TTS: synthesize(answer text)
    TTS-->>API: audio buffer
    API-->>UI: transcript + answer + audioBase64
```

### Streaming flow (`/api/agent/stream`)

```mermaid
sequenceDiagram
    participant UI as WebClient
    participant API as AgentAPI
    participant SVC as VoiceAgentService
    participant STT as STTProvider
    participant SRCH as SearchTool
    participant LLM as LLMProvider
    participant TTS as TTSProvider

    UI->>API: POST /api/agent/stream (audio)
    API-->>UI: event status(starting)
    API->>SVC: runTurnStream(input,emitEvent)
    SVC->>STT: transcribeAudio()
    STT-->>SVC: transcript
    SVC-->>UI: event transcript
    SVC->>SRCH: search(query)
    SRCH-->>SVC: results
    SVC-->>UI: event search_results
    SVC->>LLM: generateAnswer(query,results)
    LLM-->>SVC: answer text
    SVC-->>UI: event answer
    SVC->>TTS: synthesize(answer)
    TTS-->>SVC: full audio buffer
    loop chunked delivery
      SVC-->>UI: event tts_audio_chunk
    end
    SVC-->>UI: event tts_complete
    SVC-->>UI: event done
```

## 7) Configuration

- **File**: `src/config.js`
- Environment variables:
  - `OPENAI_API_KEY`
  - `ANTHROPIC_API_KEY`
  - `SERPER_API_KEY`
  - `DEFAULT_LLM_PROVIDER`
  - `DEFAULT_LLM_MODEL`
  - `DEFAULT_TTS_VOICE`

Configuration is centralized so behavior can be changed without touching orchestration logic.

## 8) Extensibility Model

To add a new provider:

1. Implement the relevant interface (`SpeechToTextProvider`, `LlmProvider`, `TextToSpeechProvider`, or `SearchTool`).
2. Register the implementation in `buildService()` in `src/server.js`.
3. Expose provider selection in request options/UI if needed.
4. Add adapter-level tests and one end-to-end test path.

Because orchestration depends on interfaces (not concrete SDKs), provider swaps are low-impact.

## 9) Reliability and Security Considerations

- Validate file size and mime type for uploads.
- Add request and provider timeouts to avoid hanging turns.
- Avoid logging raw API keys or full sensitive payloads.
- Add request IDs for traceability across STT/search/LLM/TTS steps.
- Prefer `/api/agent/stream` for larger responses to avoid a large single JSON payload.

## 10) Known Limitations in Current Sample

- TTS provider call currently returns a full audio buffer before chunk emission starts (transport is streamed, generation is not provider-level incremental).
- Search currently uses one web adapter.
- No persistence layer for chat history or conversation memory.
- Minimal test coverage in this first iteration.

## 11) Suggested Next Architecture Iteration

- Upgrade to true provider-level streaming TTS (incremental synthesis + playback).
- Add optional streaming speech-to-text partial transcripts.
- Add tool-call policy controls (max tool hops, allow-list, timeout budgets).
- Add memory abstraction for multi-turn conversations.
- Add structured telemetry and dashboard-friendly logs.
