import * as vscode from "vscode";
import { ChatCommandHandler, VSCodeElements } from "../chatCommandHandler";

import express from "express";
import swaggerUi from "swagger-ui-express";
import { OpenAPIV3 } from "openapi-types";
import http from "http";
import { validate } from "jsonschema";

import { log } from "../../lib/logger";
import {
  generateCompletionId,
  formatTextChunk,
  formatToolCallChunk,
  formatFinishChunk,
  formatDone,
} from "../../lib/sseFormatter";

import path from "path";
import {
  LanguageModelChatMessage,
  LanguageModelTextPart,
  LanguageModelToolCallPart,
  LanguageModelToolResultPart,
} from "vscode";
import { Chat } from "openai/resources/index";

const pathToSwaggerUI = path.join(__dirname, "swagger-ui-dist");
log(`Path to Swagger UI: ${pathToSwaggerUI}`);

export enum SettingKey {
  HOSTNAME = "hostname",
  PORT = "port",
}

export class LlmproxyStartChatCommandHandler extends ChatCommandHandler {
  public name: string = "start";
  private httpServer: http.Server | null = null;

  /**
   * Performs a pre-flight check to ensure that everything that is required is present.
   * For example you can check whether the settings that your participant depends on are correctly set
   * with the correct values.
   *
   * @returns An object containing a success flag and a message. The success flag
   * indicates whether the pre-flight check passed, and the message provides
   * additional information.
   */
  preFlightCheck(): { success: boolean; message: string } {
    const requiredSettings: SettingKey[] = [
      // SettingKey.DUMMY_SETTING,        // uncomment me to make the settings mandatory
    ];

    return this.missingSettingsPreflightCheck(requiredSettings);
  }

  /**
   * Pre-processes the given VSCode elements and constructs a ChatRequest object.
   * This is the place where you can do some pre-processing to the original prompt
   *
   * @param vsCodeElements - The elements from VSCode to be processed.
   * @returns A promise that resolves to a ChatRequest object containing the processed data.
   */
  async preProcess(
    vsCodeElements: VSCodeElements,
  ): Promise<vscode.ChatRequest> {
    return {
      prompt: vsCodeElements.request.prompt ?? "",
      command: vsCodeElements.request.command,
      references: vsCodeElements.request.references ?? [],
      toolReferences: vsCodeElements.request.toolReferences ?? [],
      toolInvocationToken: vsCodeElements.request.toolInvocationToken,
      model: vsCodeElements.request.model,
    };
  }

  /**
   * This is the heart of your chat participant. This method does the business logic of your participant.
   * The value returned by this method will be shown in the chat as result, unless you modify it in the postProcess
   *
   * @param vsCodeElements - The VSCode elements to process.
   * @returns A promise that resolves to a string containing a custom message.
   */
  async process(vsCodeElements: VSCodeElements): Promise<string> {
    // // Add your custom code here
    // return `
    // Congratulations, you have implemented your first chat participant and your first command!

    // To further customize it, open llmproxyStartChatCommandHandler.ts file.

    // You also have a 'DUMMY_SETTING'. Its value is: ${this.getSetting(SettingKey.DUMMY_SETTING)}, you might want to rename it.
    // `;

    let models = await vscode.lm.selectChatModels();
    console.log("Models available: ", models);
    console.log("Tools:", vscode.lm.tools);

    interface ChatCompletionRequest {
      model: string;
      messages: Array<{
        role: string;
        content: string;
        tool_call_id: string;
        name: string;
      }>;
      tools: Array<ToolDefinition>;
      temperature?: number;
      stream?: boolean;
    }

    interface ChatCompletionResponse {
      id: string;
      object: "chat.completion";
      created: number;
      model: string;
      choices: Array<{
        message: {
          role: string;
          content: string | null;
          tool_calls: Array<ToolCall>;
        };
        finish_reason: string;
        index: number;
      }>;
    }

    interface FunctionToolCall {
      name: string;
      arguments: string;
    }
    interface ToolCall {
      id: string;
      type: string;
      function: FunctionToolCall;
    }

    interface ToolDefinition {
      type: string;
      function: {
        name: string;
        description: string;
        parameters: {
          properties: object;
        };
      };
    }

    const app = express();

    const openApiSpec: OpenAPIV3.Document = {
      openapi: "3.0.0",
      info: {
        title: "Chat Completions API",
        version: "1.0.0",
        description: "OpenAI-compatible chat completions API",
      },
      paths: {
        "/v1/chat/models": {
          get: {
            operationId: "listChatModels",
            responses: {
              "200": {
                description: "Successful chat models retrieval",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        models: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              name: { type: "string" },
                              id: { type: "string" },
                              vendor: { type: "string" },
                              family: { type: "string" },
                              version: { type: "string" },
                              maxInputTokens: { type: "number" },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        "/v1/chat/completions": {
          post: {
            operationId: "createChatCompletion",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["model", "messages"],
                    properties: {
                      model: { type: "string" },
                      messages: {
                        type: "array",
                        items: {
                          type: "object",
                          required: ["role", "content"],
                          properties: {
                            role: {
                              type: "string",
                              enum: ["system", "user", "assistant"],
                            },
                            content: { type: "string" },
                          },
                        },
                      },
                      temperature: { type: "number" },
                      stream: { type: "boolean" },
                    },
                  },
                },
              },
            },
            responses: {
              "200": {
                description:
                  "Successful chat completion. When stream=false, returns JSON. When stream=true, returns SSE (text/event-stream) with chunked deltas followed by data: [DONE].",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        object: {
                          type: "string",
                          enum: ["chat.completion"],
                        },
                        created: { type: "number" },
                        model: { type: "string" },
                        choices: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              message: {
                                type: "object",
                                properties: {
                                  role: { type: "string" },
                                  content: { type: "string" },
                                },
                              },
                              finish_reason: { type: "string" },
                              index: { type: "number" },
                            },
                          },
                        },
                      },
                    },
                  },
                  "text/event-stream": {
                    schema: {
                      type: "string",
                      description:
                        "SSE stream of chat.completion.chunk objects. Each line: data: {JSON}\\n\\n. Final line: data: [DONE]\\n\\n",
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    app.use(express.json());
    app.use("/api-docs", swaggerUi.serve);
    app.get(
      "/api-docs",
      swaggerUi.setup(openApiSpec, {
        explorer: true,
      }),
    );

    // Serve static files
    app.use("/api-docs", express.static(pathToSwaggerUI));

    app.get(
      "/v1/chat/models",
      async (req: express.Request, res: express.Response): Promise<void> => {
        res.json({
          models: models.map((m) => ({
            name: m.name,
            id: m.id,
            vendor: m.vendor,
            family: m.family,
            version: m.version,
            maxInputTokens: m.maxInputTokens,
          })),
        });
      },
    );

    app.post(
      "/v1/chat/completions",
      async (req: express.Request, res: express.Response): Promise<void> => {
        try {
          // // Validate request
          const requestSchema = {
            type: "object",
            required: ["model", "messages"],
            properties: {
              model: { type: "string" },
              messages: {
                type: "array",
                items: {
                  type: "object",
                  required: ["role", "content"],
                  properties: {
                    role: {
                      type: "string",
                      enum: ["system", "user", "assistant", "tool"],
                    },
                    content: { type: ["string", "null"] },
                    name: { type: "string" },
                    tool_call_id: { type: "string" },
                  },
                },
              },
              temperature: { type: "number" },
              stream: { type: "boolean" },
              tools: {
                type: "array",
                items: {
                  type: "object",
                },
              },
            },
          };

          const validation = validate(req.body, requestSchema);
          if (!validation.valid) {
            res.status(400).json({
              error: "Invalid request body",
              details: validation.errors,
            });
            return;
          }

          const request: ChatCompletionRequest = req.body;
          let modelInstance = models[0];

          const { prompt, model } = req.body;
          try {
            if (model) {
              const foundModel = models.find((m) => m.id === model);
              if (!foundModel) {
                throw new Error(`Model ${model} not found`);
              }
              modelInstance = foundModel;
            }
            log("Selected model:", modelInstance);
          } catch (error) {
            console.error(error);
            res.status(400).json({
              error: {
                message:
                  error instanceof Error ? error.message : "Unknown error",
                type: "invalid_request",
                code: 400,
              },
            });
            return;
          }

          // Process chat request
          let processResult = "";
          const messages: Array<LanguageModelChatMessage> = [];

          for (const message of request.messages) {
            if (message.content === null) {continue;}

            if (message.role === "user") {
              messages.push(
                vscode.LanguageModelChatMessage.User(message.content),
              );
            } else if (
              message.role === "assistant" ||
              message.role === "system"
            ) {
              messages.push(
                vscode.LanguageModelChatMessage.Assistant(message.content),
              );
            } else if (message.role === "tool") {
              messages.push(
                vscode.LanguageModelChatMessage.User(
                  `Here's the result of the tool call: ${message.content}`,
                ),
              );
            }
          }

          const llmTools: Array<vscode.LanguageModelChatTool> = [];
          if (!request.tools) {
            request.tools = [];
          }
          for (const availableTool of request.tools) {
            llmTools.push({
              name: availableTool.function.name,
              description: availableTool.function.description,
              inputSchema: {
                type: "object",
                properties: availableTool.function.parameters.properties,
              },
            });
          }

          const chatResponse = await modelInstance.sendRequest(
            messages,
            {
              modelOptions: {
                temperature: request.temperature,
                stream: request.stream,
              },
              tools: llmTools,
            },
            vsCodeElements?.token,
          );

          if (request.stream) {
            // --- Streaming path: emit SSE events as chunks arrive ---
            res.setHeader("Content-Type", "text/event-stream");
            res.setHeader("Cache-Control", "no-cache");
            res.setHeader("Connection", "keep-alive");
            res.flushHeaders();

            const completionId = generateCompletionId();
            const toolCalls = Array<ToolCall>();
            let isFirstTextChunk = true;
            let toolIndex = 0;

            try {
              for await (const chunk of chatResponse.stream) {
                if (chunk instanceof LanguageModelTextPart) {
                  const role = isFirstTextChunk ? "assistant" : undefined;
                  res.write(formatTextChunk(completionId, request.model, chunk.value, role));
                  isFirstTextChunk = false;
                } else if (chunk instanceof LanguageModelToolCallPart) {
                  res.write(formatToolCallChunk(
                    completionId,
                    request.model,
                    { callId: chunk.callId, name: chunk.name, input: chunk.input },
                    toolIndex++,
                  ));
                  toolCalls.push({
                    id: chunk.callId,
                    type: "function",
                    function: {
                      name: chunk.name,
                      arguments: JSON.stringify(chunk.input),
                    },
                  });
                }
              }

              const finishReason = toolCalls.length > 0 ? "tool_calls" : "stop";
              res.write(formatFinishChunk(completionId, request.model, finishReason));
              res.write(formatDone());
            } catch (streamError) {
              console.error("SSE stream error:", streamError);
              // Attempt to send an error event before closing
              const errorMsg = streamError instanceof Error ? streamError.message : "Unknown stream error";
              res.write(`data: ${JSON.stringify({ error: { message: errorMsg, type: "stream_error" } })}\n\n`);
              res.write(formatDone());
            } finally {
              res.end();
            }
          } else {
            // --- Non-streaming path: accumulate then respond ---
            const toolCalls = Array<ToolCall>();

            for await (const chunk of chatResponse.stream) {
              if (chunk instanceof LanguageModelTextPart) {
                processResult += chunk.value;
              } else if (chunk instanceof LanguageModelToolCallPart) {
                toolCalls.push({
                  id: chunk.callId,
                  type: "function",
                  function: {
                    name: chunk.name,
                    arguments: JSON.stringify(chunk.input),
                  },
                });
              }
            }

            let response;

            if (toolCalls.length > 0) {
              response = {
                id: `chatcmpl-${Date.now()}`,
                object: "chat.completion",
                created: Math.floor(Date.now() / 1000),
                model: request.model,
                choices: [
                  {
                    message: {
                      role: "assistant",
                      content: "",
                      tool_calls: toolCalls,
                    },
                    finish_reason: "tool_calls",
                    index: 0,
                  },
                ],
              } as ChatCompletionResponse;
            } else {
              response = {
                id: `chatcmpl-${Date.now()}`,
                object: "chat.completion",
                created: Math.floor(Date.now() / 1000),
                model: request.model,
                choices: [
                  {
                    message: {
                      role: "assistant",
                      content: processResult,
                    },
                    finish_reason: "stop",
                    index: 0,
                  },
                ],
              } as ChatCompletionResponse;
            }

            res.json(response);
          }
        } catch (error) {
          console.error(error);
          res.status(500).json({
            error: {
              message: error instanceof Error ? error.message : "Unknown error",
              type: "internal_server_error",
              code: 500,
            },
          });
        }
      },
    );

    const hostname =
      this.getSetting(SettingKey.HOSTNAME)?.trim() || "localhost";
    const port = parseInt(this.getSetting(SettingKey.PORT) ?? "8080") || 8080;

    return new Promise((resolve, reject) => {
      const server = app
        .listen(port, hostname, () => {
          console.log(`Server running at http://${hostname}:${port}/`);
          console.log(
            `API documentation available at http://${hostname}:${port}/api-docs`,
          );
          this.httpServer = server;
          resolve(
            `REST API server started successfully: http://${hostname}:${port}/v1. \nAPI Docs: http://${hostname}:${port}/api-docs`,
          );
        })
        .on("error", reject);
    });
  }

  /**
   * Post-processes function
   * This is the place to modify the output for example.
   * Note that the result of postProcess takes precedence over the result of process
   *
   * @param vsCodeElements - The VSCode elements to be processed.
   * @returns A promise that resolves to a string if the request prompt exists, otherwise null.
   */
  async postProcess(vsCodeElements: VSCodeElements): Promise<string | null> {
    return vsCodeElements.request?.prompt ?? null;
  }
}
