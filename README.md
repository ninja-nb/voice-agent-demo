# Voice AI Agent Sample

Sample project that accepts audio input, transcribes it, runs search-backed AI answering, and returns synthesized speech.

## Design and Architecture

- Full design/architecture document: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## Features

- Audio input from browser recording or uploaded file.
- Third-party STT (`OpenAI`).
- Search tool adapter (`Serper` web search).
- Pluggable LLM adapters (`OpenAI`, `Anthropic`).
- Third-party TTS (`OpenAI`).

## Quick Start

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create environment file:

   ```bash
   cp .env.example .env
   ```

3. Set keys in `.env`:
   - `OPENAI_API_KEY` (required for STT + TTS + OpenAI LLM)
   - `SERPER_API_KEY` (optional but recommended for live search)
   - `ANTHROPIC_API_KEY` (needed only if selecting anthropic provider)
   - LiveKit (optional, needed for realtime room auth endpoint):
     - `LIVEKIT_URL`
     - `LIVEKIT_API_KEY`
     - `LIVEKIT_API_SECRET`
     - `LIVEKIT_DEFAULT_ROOM=voice-agent-room` (optional default room)
   - Optional model defaults:
     - `DEFAULT_OPENAI_MODEL=gpt-4.1-mini`
     - `DEFAULT_ANTHROPIC_MODEL=claude-haiku-4-5-20251001` (cheaper Anthropic option)
   - Anthropic model gating:
     - `ANTHROPIC_ENABLED_MODELS=claude-haiku-4-5-20251001`
     - Leave empty to hide Anthropic from UI and API capabilities.

4. Start app:

   ```bash
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000)

## API

### `POST /api/agent/turn`

`multipart/form-data` fields:
- `audio`: audio file (required)
- `llmProvider`: `openai` or `anthropic` (optional)
- `llmModel`: model override (optional)
- `ttsVoice`: tts voice override (optional)

Response:
- transcript text
- search results
- AI answer
- base64 encoded audio output (`audioBase64`)

### `POST /api/agent/stream`

`multipart/form-data` fields:
- `audio`: audio file (required)
- `llmProvider`: `openai` or `anthropic` (optional)
- `llmModel`: model override (optional)
- `ttsVoice`: tts voice override (optional)

Response stream:
- `status` events (`starting`, `transcribing`, `searching`, `answering`, `synthesizing_audio`)
- `transcript`
- `search_results`
- `answer`
- repeated `tts_audio_chunk` events (base64 audio chunks)
- `tts_complete`
- `done`

### `POST /api/livekit/token`

Generates a short-lived LiveKit access token for browser room join.

`application/json` body (all optional):
- `room`: room name (defaults to `LIVEKIT_DEFAULT_ROOM`)
- `identity`: participant identity (auto-generated if omitted)
- `name`: display name (defaults to `identity`)

Response:
- `url`: LiveKit server URL (`wss://...`)
- `room`
- `identity`
- `name`
- `token`

## Notes

- `/api/agent/turn` returns full output in one payload.
- `/api/agent/stream` streams pipeline updates and audio chunks using SSE.
- Provider-specific default models are supported so Anthropic does not receive OpenAI model IDs.

## Deploy on Render (Free Tier)

1. Push this project to a GitHub repo.
2. In Render dashboard, click **New +** -> **Blueprint**.
3. Connect the repo and select this project.
4. Render detects `render.yaml` automatically.
5. Set secret env vars in Render:
   - `OPENAI_API_KEY` (required)
   - `SERPER_API_KEY` (recommended)
   - `ANTHROPIC_API_KEY` (only if using anthropic provider)
   - `ANTHROPIC_ENABLED_MODELS` (only list models your Anthropic account can access)
6. Click **Apply** to deploy.

After deploy, open:
- `https://<your-render-url>/`
- health check: `https://<your-render-url>/api/health`
