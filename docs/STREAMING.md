# SSE Streaming Support

## Problem Statement

The `/v1/chat/completions` endpoint accepts a `stream: boolean` parameter in the
request body, matching the OpenAI API specification. However, when `stream: true`
is sent, the handler sets SSE headers but **never writes any data and never closes
the connection**, causing HTTP clients to hang indefinitely.

```typescript
// Current code (llmproxyStartChatCommandHandler.ts:467-474)
if (request.stream) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    //TODO: Implementation of streaming response
} else {
    res.json(response);
}
```

### Impact

Any client sending `stream: true` (the OpenAI SDK default for many use cases,
agentic pipelines, real-time UIs) will experience an infinite hang. This blocks
adoption for:

- **Real-time conversational AI** (e.g. French AI Buddy voice pipeline needs
  token-by-token streaming for sentence-buffered TTS)
- **OpenAI SDK streaming mode** (`openai.chat.completions.create(stream=True)`)
- **LangChain / LlamaIndex** streaming integrations
- **Any UI** that displays tokens as they arrive

### Root Cause

The VSCode Language Model API already provides a streaming async iterable
(`chatResponse.stream`). The current implementation collects ALL chunks into a
string before responding — the streaming infrastructure exists but is not wired
to the HTTP response.

## Design

### Key Insight

The `modelInstance.sendRequest()` call returns a `chatResponse` with a `.stream`
property that is an `AsyncIterable<LanguageModelTextPart | LanguageModelToolCallPart>`.
The current code already iterates this stream:

```typescript
for await (const chunk of chatResponse.stream) {
    if (chunk instanceof LanguageModelTextPart) {
        processResult += chunk.value;
    } else if (chunk instanceof LanguageModelToolCallPart) {
        toolCalls.push({ ... });
    }
}
```

For streaming, instead of accumulating into `processResult`, we emit each chunk
as an SSE event immediately.

### OpenAI SSE Format

Each SSE event is a JSON object prefixed with `data: ` and followed by `\n\n`:

```
data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"gpt-4o","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"gpt-4o","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

### Architecture

```
                    stream: false                    stream: true
                    ─────────────                    ────────────
LM API stream ──► Accumulate all ──► JSON response   LM API stream ──► SSE per chunk ──► res.write()
                  chunks                                              ──► [DONE]    ──► res.end()
```

### Implementation Plan

1. **`src/lib/sseFormatter.ts`** — Pure functions for SSE event formatting
   - `formatSseChunk(id, model, delta, finishReason)` → SSE data line
   - `formatSseDone()` → `"data: [DONE]\n\n"`
   - No VSCode dependencies — fully unit-testable

2. **Unit tests** — `test/unit/sseFormatter.test.ts`
   - Test text delta formatting
   - Test tool call delta formatting
   - Test finish reasons (stop, tool_calls)
   - Test [DONE] sentinel

3. **Handler modification** — Split stream processing into two paths:
   - `stream: false` → existing accumulate-then-respond logic (unchanged)
   - `stream: true` → write SSE headers, iterate stream with `res.write()` per
     chunk, end with `[DONE]`

4. **OpenAPI spec update** — Document the streaming response format

### Constraints

- The VSCode `LanguageModelToolCallPart` provides complete tool call info (not
  incremental like OpenAI). Tool calls are emitted as single SSE events.
- Error handling: if the LM API throws mid-stream, emit an SSE error event
  before closing.
- The `stream` option in `modelOptions` passed to `sendRequest()` is a hint to
  the VSCode LM API; the response is always an async iterable regardless.
