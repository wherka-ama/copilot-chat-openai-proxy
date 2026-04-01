/**
 * Pure SSE formatting functions for OpenAI-compatible streaming responses.
 *
 * These functions produce Server-Sent Events (SSE) in the exact format
 * expected by OpenAI API clients. Each event is a `data: <JSON>\n\n` line.
 *
 * No VSCode dependencies — fully unit-testable.
 */

/** Delta content for a streaming text chunk. */
export interface TextDelta {
  role?: string;
  content: string;
}

/** Delta content for a streaming tool call chunk. */
export interface ToolCallDelta {
  role?: string;
  content?: null;
  tool_calls: Array<{
    index: number;
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

/** A single SSE chunk in OpenAI chat.completion.chunk format. */
export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: TextDelta | ToolCallDelta | Record<string, never>;
    finish_reason: string | null;
  }>;
}

/**
 * Generate a unique completion ID for a streaming session.
 * Called once per request to produce a stable ID across all chunks.
 */
export function generateCompletionId(): string {
  return `chatcmpl-${Date.now()}`;
}

/**
 * Format a text delta as an SSE data line.
 *
 * @param id       - Stable completion ID for this request
 * @param model    - Model name from the request
 * @param content  - The text content of this chunk
 * @param role     - Optional role (typically "assistant" on the first chunk)
 */
export function formatTextChunk(
  id: string,
  model: string,
  content: string,
  role?: string,
): string {
  const delta: TextDelta = { content };
  if (role) {
    delta.role = role;
  }

  const chunk: ChatCompletionChunk = {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: null }],
  };

  return `data: ${JSON.stringify(chunk)}\n\n`;
}

/**
 * Format a tool call as an SSE data line.
 *
 * Unlike the OpenAI API which streams tool call arguments incrementally,
 * the VSCode Language Model API provides complete tool calls. We emit
 * each tool call as a single SSE event.
 *
 * @param id        - Stable completion ID for this request
 * @param model     - Model name from the request
 * @param toolCall  - The complete tool call to emit
 * @param toolIndex - Index of this tool call in the array
 */
export function formatToolCallChunk(
  id: string,
  model: string,
  toolCall: { callId: string; name: string; input: unknown },
  toolIndex: number,
): string {
  const delta: ToolCallDelta = {
    role: "assistant",
    content: null,
    tool_calls: [
      {
        index: toolIndex,
        id: toolCall.callId,
        type: "function",
        function: {
          name: toolCall.name,
          arguments: JSON.stringify(toolCall.input),
        },
      },
    ],
  };

  const chunk: ChatCompletionChunk = {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: null }],
  };

  return `data: ${JSON.stringify(chunk)}\n\n`;
}

/**
 * Format the final chunk with a finish_reason, signaling the end of content.
 *
 * @param id           - Stable completion ID for this request
 * @param model        - Model name from the request
 * @param finishReason - "stop" for text completions, "tool_calls" for tool use
 */
export function formatFinishChunk(
  id: string,
  model: string,
  finishReason: "stop" | "tool_calls",
): string {
  const chunk: ChatCompletionChunk = {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
  };

  return `data: ${JSON.stringify(chunk)}\n\n`;
}

/**
 * Format the [DONE] sentinel that terminates an SSE stream.
 * This must be the last event written to the response.
 */
export function formatDone(): string {
  return "data: [DONE]\n\n";
}
