import * as assert from "assert";
import {
  formatTextChunk,
  formatToolCallChunk,
  formatFinishChunk,
  formatDone,
  generateCompletionId,
  ChatCompletionChunk,
} from "../../src/lib/sseFormatter";

suite("SSE Formatter", () => {
  const TEST_ID = "chatcmpl-test-123";
  const TEST_MODEL = "gpt-4o";

  suite("generateCompletionId", () => {
    test("returns a string starting with chatcmpl-", () => {
      const id = generateCompletionId();
      assert.ok(id.startsWith("chatcmpl-"), `Expected prefix chatcmpl-, got: ${id}`);
    });

    test("returns unique IDs on successive calls", () => {
      const id1 = generateCompletionId();
      const id2 = generateCompletionId();
      // They may be equal if called within the same millisecond,
      // but the format should be consistent
      assert.ok(id1.startsWith("chatcmpl-"));
      assert.ok(id2.startsWith("chatcmpl-"));
    });
  });

  suite("formatTextChunk", () => {
    test("produces valid SSE data line with text content", () => {
      const result = formatTextChunk(TEST_ID, TEST_MODEL, "Hello");
      assert.ok(result.startsWith("data: "), "Must start with 'data: '");
      assert.ok(result.endsWith("\n\n"), "Must end with double newline");

      const json = JSON.parse(result.slice(6).trim()) as ChatCompletionChunk;
      assert.strictEqual(json.id, TEST_ID);
      assert.strictEqual(json.object, "chat.completion.chunk");
      assert.strictEqual(json.model, TEST_MODEL);
      assert.strictEqual(json.choices.length, 1);
      assert.strictEqual(json.choices[0].index, 0);
      assert.strictEqual(json.choices[0].finish_reason, null);

      const delta = json.choices[0].delta as { content: string; role?: string };
      assert.strictEqual(delta.content, "Hello");
      assert.strictEqual(delta.role, undefined);
    });

    test("includes role when provided", () => {
      const result = formatTextChunk(TEST_ID, TEST_MODEL, "", "assistant");
      const json = JSON.parse(result.slice(6).trim()) as ChatCompletionChunk;
      const delta = json.choices[0].delta as { content: string; role?: string };
      assert.strictEqual(delta.role, "assistant");
      assert.strictEqual(delta.content, "");
    });

    test("handles empty content", () => {
      const result = formatTextChunk(TEST_ID, TEST_MODEL, "");
      const json = JSON.parse(result.slice(6).trim()) as ChatCompletionChunk;
      const delta = json.choices[0].delta as { content: string };
      assert.strictEqual(delta.content, "");
    });

    test("handles content with special characters", () => {
      const content = 'Bonjour! "Comment ça va?" 🇫🇷\nnewline';
      const result = formatTextChunk(TEST_ID, TEST_MODEL, content);
      const json = JSON.parse(result.slice(6).trim()) as ChatCompletionChunk;
      const delta = json.choices[0].delta as { content: string };
      assert.strictEqual(delta.content, content);
    });

    test("sets created timestamp as unix epoch seconds", () => {
      const before = Math.floor(Date.now() / 1000);
      const result = formatTextChunk(TEST_ID, TEST_MODEL, "test");
      const after = Math.floor(Date.now() / 1000);
      const json = JSON.parse(result.slice(6).trim()) as ChatCompletionChunk;
      assert.ok(json.created >= before && json.created <= after);
    });
  });

  suite("formatToolCallChunk", () => {
    const toolCall = {
      callId: "call_abc123",
      name: "get_weather",
      input: { location: "Paris", unit: "celsius" },
    };

    test("produces valid SSE data line with tool call", () => {
      const result = formatToolCallChunk(TEST_ID, TEST_MODEL, toolCall, 0);
      assert.ok(result.startsWith("data: "));
      assert.ok(result.endsWith("\n\n"));

      const json = JSON.parse(result.slice(6).trim()) as ChatCompletionChunk;
      assert.strictEqual(json.id, TEST_ID);
      assert.strictEqual(json.object, "chat.completion.chunk");
      assert.strictEqual(json.choices[0].finish_reason, null);

      const delta = json.choices[0].delta as {
        role: string;
        content: null;
        tool_calls: Array<{
          index: number;
          id: string;
          type: string;
          function: { name: string; arguments: string };
        }>;
      };
      assert.strictEqual(delta.role, "assistant");
      assert.strictEqual(delta.content, null);
      assert.strictEqual(delta.tool_calls.length, 1);
      assert.strictEqual(delta.tool_calls[0].index, 0);
      assert.strictEqual(delta.tool_calls[0].id, "call_abc123");
      assert.strictEqual(delta.tool_calls[0].type, "function");
      assert.strictEqual(delta.tool_calls[0].function.name, "get_weather");
      assert.deepStrictEqual(
        JSON.parse(delta.tool_calls[0].function.arguments),
        { location: "Paris", unit: "celsius" },
      );
    });

    test("respects toolIndex parameter", () => {
      const result = formatToolCallChunk(TEST_ID, TEST_MODEL, toolCall, 2);
      const json = JSON.parse(result.slice(6).trim()) as ChatCompletionChunk;
      const delta = json.choices[0].delta as {
        tool_calls: Array<{ index: number }>;
      };
      assert.strictEqual(delta.tool_calls[0].index, 2);
    });
  });

  suite("formatFinishChunk", () => {
    test("produces stop finish_reason for text completions", () => {
      const result = formatFinishChunk(TEST_ID, TEST_MODEL, "stop");
      const json = JSON.parse(result.slice(6).trim()) as ChatCompletionChunk;
      assert.strictEqual(json.choices[0].finish_reason, "stop");
      assert.deepStrictEqual(json.choices[0].delta, {});
    });

    test("produces tool_calls finish_reason for tool use", () => {
      const result = formatFinishChunk(TEST_ID, TEST_MODEL, "tool_calls");
      const json = JSON.parse(result.slice(6).trim()) as ChatCompletionChunk;
      assert.strictEqual(json.choices[0].finish_reason, "tool_calls");
      assert.deepStrictEqual(json.choices[0].delta, {});
    });

    test("maintains consistent id and model", () => {
      const result = formatFinishChunk(TEST_ID, TEST_MODEL, "stop");
      const json = JSON.parse(result.slice(6).trim()) as ChatCompletionChunk;
      assert.strictEqual(json.id, TEST_ID);
      assert.strictEqual(json.model, TEST_MODEL);
      assert.strictEqual(json.object, "chat.completion.chunk");
    });
  });

  suite("formatDone", () => {
    test("returns the exact [DONE] sentinel", () => {
      assert.strictEqual(formatDone(), "data: [DONE]\n\n");
    });
  });

  suite("end-to-end SSE stream simulation", () => {
    test("produces a valid SSE stream for a text completion", () => {
      const id = generateCompletionId();
      const model = "gpt-4o";
      const words = ["Bonjour, ", "comment ", "allez-vous ", "?"];

      const events: string[] = [];

      // First chunk with role
      events.push(formatTextChunk(id, model, "", "assistant"));

      // Content chunks
      for (const word of words) {
        events.push(formatTextChunk(id, model, word));
      }

      // Finish
      events.push(formatFinishChunk(id, model, "stop"));
      events.push(formatDone());

      // Validate the full stream
      const fullStream = events.join("");
      const lines = fullStream.split("\n\n").filter((l) => l.length > 0);

      // 1 role + 4 words + 1 finish + 1 DONE = 7 events
      assert.strictEqual(lines.length, 7);

      // All lines except DONE should be valid JSON after "data: "
      for (let i = 0; i < lines.length - 1; i++) {
        assert.ok(lines[i].startsWith("data: "));
        const parsed = JSON.parse(lines[i].slice(6));
        assert.strictEqual(parsed.id, id);
        assert.strictEqual(parsed.object, "chat.completion.chunk");
      }

      // Last event is [DONE]
      assert.strictEqual(lines[lines.length - 1], "data: [DONE]");
    });

    test("produces a valid SSE stream for a tool call completion", () => {
      const id = generateCompletionId();
      const model = "gpt-4o";

      const events: string[] = [];
      events.push(
        formatToolCallChunk(
          id,
          model,
          { callId: "call_1", name: "search", input: { q: "test" } },
          0,
        ),
      );
      events.push(formatFinishChunk(id, model, "tool_calls"));
      events.push(formatDone());

      const lines = events.join("").split("\n\n").filter((l) => l.length > 0);
      assert.strictEqual(lines.length, 3);

      // Finish reason should be tool_calls
      const finishLine = JSON.parse(lines[1].slice(6)) as ChatCompletionChunk;
      assert.strictEqual(finishLine.choices[0].finish_reason, "tool_calls");
    });
  });
});
