# Technical Flow Documentation

## Detailed Implementation Flows and Interactions

This document provides in-depth technical flows for key operations in the Copilot Chat OpenAI Proxy extension.

---

## Table of Contents

1. [Extension Initialization Flow](#extension-initialization-flow)
2. [HTTP Request Processing](#http-request-processing)
3. [Message Transformation Details](#message-transformation-details)
4. [Tool Call Implementation](#tool-call-implementation)
5. [Error Handling Strategies](#error-handling-strategies)
6. [Configuration Management](#configuration-management)

---

## Extension Initialization Flow

### Complete Activation Sequence

```mermaid
sequenceDiagram
    autonumber
    participant VSC as VS Code Core
    participant ExtHost as Extension Host
    participant Ext as extension.ts
    participant Ctx as ExtensionContext
    participant ChatAPI as Chat API
    participant Handler as Intent Handlers
    
    VSC->>ExtHost: Load extension
    ExtHost->>Ext: activate(context)
    
    Note over Ext: Step 1: Setup context
    Ext->>Ctx: setExtensionContext(context)
    Ctx-->>Ext: Context stored globally
    
    Note over Ext: Step 2: Initialize logging
    Ext->>Ext: setDisplayNameLogging(displayName)
    Ext->>Ext: log("Extension activated")
    
    Note over Ext: Step 3: Register participants
    Ext->>ChatAPI: createChatParticipant(id, chatHandler)
    ChatAPI-->>Ext: participant1 instance
    Ext->>Ext: Set iconPath
    Ext->>Ctx: subscriptions.push(participant1)
    
    Ext->>ChatAPI: createChatParticipant("llmproxy", chatHandler)
    ChatAPI-->>Ext: llmproxyParticipant
    Ext->>Ctx: subscriptions.push(llmproxyParticipant)
    
    Note over Ext: Step 4: Setup feedback
    Ext->>ChatAPI: llmproxyParticipant.onDidReceiveFeedback(handler)
    
    Note over Ext: Step 5: Register commands
    Ext->>Handler: registerIntentHandlers()
    Handler->>Handler: Load custom handlers
    Handler->>Handler: Create LlmproxyStartHandler
    Handler->>Handler: Map.set("start", handler)
    Handler-->>Ext: intentHandlers Map
    
    Ext-->>VSC: Activation complete
```

### Handler Registration Detail

```mermaid
graph TD
    A[registerIntentHandlers] --> B[Import custom handlers]
    B --> C[customHandlers array]
    C --> D{For each handler}
    D --> E[Get handler.name]
    E --> F["Map.set(name, handler)"]
    F --> G{More handlers?}
    G -->|Yes| D
    G -->|No| H[Return intentHandlers Map]
    
    I[LlmproxyStartHandler] --> C
    J[Future: CustomHandler2] -.-> C
    K[Future: CustomHandler3] -.-> C
    
    style A fill:#bbdefb
    style I fill:#c8e6c9
    style H fill:#fff9c4
```

---

## HTTP Request Processing

### Detailed Request/Response Flow

```mermaid
sequenceDiagram
    autonumber
    participant Client as HTTP Client
    participant Express as Express Server
    participant Middleware as Express Middleware
    participant Route as Route Handler
    participant Validator as Schema Validator
    participant Handler as LlmproxyStartHandler
    participant Transform as Message Transformer
    participant LM as VS Code LM API
    participant Copilot as GitHub Copilot
    
    Client->>Express: POST /v1/chat/completions
    Express->>Middleware: express.json() parser
    Middleware->>Middleware: Parse request body
    
    alt Malformed JSON
        Middleware-->>Client: 400 Bad Request
    else Valid JSON
        Middleware->>Route: Pass to route handler
        Route->>Validator: validate(req.body, schema)
        Validator->>Validator: Check required fields
        Validator->>Validator: Check types & enums
        
        alt Schema Validation Fails
            Validator-->>Route: validation.errors
            Route->>Route: Format error response
            Route-->>Client: 400 {error, details}
        else Schema Valid
            Validator-->>Route: validation.valid = true
            Route->>Handler: Process request
            
            Note over Handler: Model Selection
            Handler->>Handler: Find model by ID
            alt Model Not Found
                Handler-->>Client: 400 Model not found
            else Model Found
                Handler->>Transform: Transform messages
                
                Note over Transform: Message Transformation
                loop For each message
                    Transform->>Transform: Check message.role
                    Transform->>Transform: Create LanguageModelChatMessage
                end
                Transform-->>Handler: messages[]
                
                Note over Handler: Tool Transformation
                loop For each tool
                    Handler->>Handler: Transform to LM tool format
                end
                
                Handler->>LM: sendRequest(messages, options, token)
                LM->>Copilot: Forward to Copilot API
                
                Note over Copilot: LLM Processing
                Copilot->>Copilot: Process with selected model
                
                loop Stream Response
                    Copilot-->>LM: chunk
                    LM-->>Handler: LanguageModelPart
                    Handler->>Handler: Process chunk type
                    
                    alt TextPart
                        Handler->>Handler: Accumulate text
                    else ToolCallPart
                        Handler->>Handler: Add to toolCalls[]
                    end
                end
                
                Handler->>Handler: Build OpenAI response format
                Handler->>Handler: Set finish_reason
                Handler-->>Route: response object
                Route-->>Client: 200 OK + JSON
            end
        end
    end
```

### Model Selection Logic

```mermaid
flowchart TD
    A[Receive request.model] --> B{model specified?}
    B -->|No| C[Use models[0] default]
    B -->|Yes| D[models.find by ID]
    D --> E{Model found?}
    E -->|No| F[Throw Error: Model not found]
    E -->|Yes| G[Set modelInstance]
    C --> G
    G --> H[Log selected model]
    H --> I[Return modelInstance]
    F --> J[Send 400 error to client]
    
    style G fill:#c8e6c9
    style F fill:#ffccbc
```

---

## Message Transformation Details

### OpenAI to VS Code LM Message Mapping

```mermaid
graph TB
    subgraph "Input: OpenAI Format"
        A["{ role: 'user', content: '...' }"]
        B["{ role: 'assistant', content: '...' }"]
        C["{ role: 'system', content: '...' }"]
        D["{ role: 'tool', content: '...', tool_call_id: '...' }"]
    end
    
    subgraph "Transformation Logic"
        E[Check message.role]
        F[Create appropriate LM message]
    end
    
    subgraph "Output: VS Code LM Format"
        G[LanguageModelChatMessage.User]
        H[LanguageModelChatMessage.Assistant]
        I[LanguageModelChatMessage.Assistant]
        J[LanguageModelChatMessage.User<br/>with context]
    end
    
    A --> E
    B --> E
    C --> E
    D --> E
    
    E --> F
    F --> G
    F --> H
    F --> I
    F --> J
    
    style E fill:#fff9c4
    style G fill:#c8e6c9
    style H fill:#c8e6c9
    style I fill:#c8e6c9
    style J fill:#bbdefb
```

### Implementation Code Flow

```mermaid
sequenceDiagram
    participant Input as request.messages[]
    participant Loop as For Loop
    participant Check as Role Check
    participant Create as Message Creation
    participant Output as messages[]
    
    Input->>Loop: Iterate messages
    loop For each message
        Loop->>Check: message.role?
        
        alt role === "user"
            Check->>Create: LanguageModelChatMessage.User(content)
            Create->>Output: Push User message
        else role === "assistant"
            Check->>Create: LanguageModelChatMessage.Assistant(content)
            Create->>Output: Push Assistant message
        else role === "system"
            Check->>Create: LanguageModelChatMessage.Assistant(content)
            Create->>Output: Push Assistant message
        else role === "tool"
            Check->>Create: LanguageModelChatMessage.User(<br/>"Tool result: " + content)
            Create->>Output: Push User message with context
        else content === null
            Check->>Loop: Skip message (continue)
        end
    end
    
    Output-->>Input: Return transformed messages
```

---

## Tool Call Implementation

### Tool Registration and Invocation

```mermaid
sequenceDiagram
    autonumber
    participant Client as Client with Tools
    participant Server as Express Server
    participant Handler as Handler
    participant Transform as Tool Transformer
    participant LM as VS Code LM API
    participant Copilot as Copilot with Tools
    
    Note over Client: Client defines tools
    Client->>Server: POST with tools: [{type, function}]
    Server->>Handler: Forward request
    Handler->>Transform: Transform tools
    
    loop For each tool
        Transform->>Transform: Extract function metadata
        Transform->>Transform: Create LanguageModelChatTool
        Note over Transform: {name, description, inputSchema}
    end
    
    Transform-->>Handler: llmTools[]
    Handler->>LM: sendRequest(messages, {tools: llmTools})
    LM->>Copilot: Forward with tool definitions
    
    Copilot->>Copilot: Analyze if tool needed
    
    alt Tool Call Required
        Copilot-->>LM: LanguageModelToolCallPart
        Note over Copilot: {callId, name, input}
        LM-->>Handler: Tool call chunk
        Handler->>Handler: Create ToolCall object
        Handler->>Handler: Format as OpenAI tool_call
        Handler-->>Client: finish_reason: "tool_calls"<br/>tool_calls: [{id, type, function}]
        
        Note over Client: Client executes tool
        Client->>Client: Execute function(input)
        Client->>Client: Get result
        
        Client->>Server: POST with tool result message
        Note over Client: {role: "tool", content: result, tool_call_id}
        Server->>Handler: Process continuation
        Handler->>LM: sendRequest with tool result
        LM->>Copilot: Continue conversation
        Copilot-->>Handler: Final answer
        Handler-->>Client: finish_reason: "stop"
    else No Tool Needed
        Copilot-->>LM: LanguageModelTextPart
        LM-->>Handler: Text response
        Handler-->>Client: finish_reason: "stop"
    end
```

### Tool Schema Transformation

```mermaid
graph LR
    subgraph "OpenAI Tool Format"
        A["{ type: 'function',<br/>function: {<br/>name,<br/>description,<br/>parameters: {<br/>properties<br/>}<br/>} }"]
    end
    
    subgraph "Transformation"
        B[Extract function object]
        C[Map to LM format]
    end
    
    subgraph "VS Code LM Tool Format"
        D["{ name,<br/>description,<br/>inputSchema: {<br/>type: 'object',<br/>properties<br/>} }"]
    end
    
    A --> B
    B --> C
    C --> D
    
    style B fill:#fff9c4
    style D fill:#c8e6c9
```

---

## Error Handling Strategies

### Error Classification and Response

```mermaid
graph TB
    A[Request Received] --> B{Error Type}
    
    B -->|Malformed JSON| C1[400: Cannot parse JSON]
    B -->|Schema Invalid| C2[400: Validation errors]
    B -->|Model Not Found| C3[400: Model not found]
    B -->|LM API Error| C4[500: Internal error]
    B -->|Stream Error| C5[500: Stream processing error]
    B -->|Unexpected Error| C6[500: Unknown error]
    
    C1 --> D[Format Error Response]
    C2 --> D
    C3 --> D
    C4 --> D
    C5 --> D
    C6 --> D
    
    D --> E[Log Error]
    E --> F{Error Code}
    F -->|4xx| G[Client Error Response]
    F -->|5xx| H[Server Error Response]
    
    G --> I[Return to Client]
    H --> I
    
    style B fill:#fff9c4
    style C4 fill:#ffccbc
    style C5 fill:#ffccbc
    style C6 fill:#ffccbc
```

### Error Response Format

```mermaid
classDiagram
    class ErrorResponse {
        +error: ErrorDetails
    }
    
    class ErrorDetails {
        +message: string
        +type: string
        +code: number
    }
    
    class ValidationError {
        +error: string
        +details: ValidationErrors[]
    }
    
    class ValidationErrors {
        +path: string[]
        +message: string
        +schema: object
    }
    
    ErrorResponse o-- ErrorDetails
    ValidationError o-- ValidationErrors
    
    note for ErrorDetails "Types: invalid_request,<br/>internal_server_error"
```

### Try-Catch Pattern

```mermaid
sequenceDiagram
    participant Route as Route Handler
    participant Logic as Business Logic
    participant Error as Error Handler
    participant Log as Logger
    participant Client as HTTP Client
    
    Route->>Logic: try { process request }
    
    alt Success Path
        Logic-->>Route: return response
        Route->>Client: 200 OK
    else Error Path
        Logic-->>Route: throw error
        Route->>Error: catch (error)
        Error->>Error: Determine error type
        Error->>Error: Format error response
        Error->>Log: console.error(error)
        Error->>Client: 4xx/5xx + error JSON
    end
```

---

## Configuration Management

### Settings Hierarchy

```mermaid
graph TB
    A[VS Code Settings] --> B[workspace settings.json]
    A --> C[user settings.json]
    
    B --> D["chat-participant-openai-proxy<br/>.llmproxy.hostname"]
    B --> E["chat-participant-openai-proxy<br/>.llmproxy.port"]
    
    C --> D
    C --> E
    
    D --> F[vscode.workspace<br/>.getConfiguration]
    E --> F
    
    F --> G[ChatCommandHandler<br/>.getSetting]
    G --> H[LlmproxyStartHandler]
    H --> I[Default: localhost]
    H --> J[Default: 8080]
    
    I --> K[Server Configuration]
    J --> K
    
    style D fill:#bbdefb
    style E fill:#bbdefb
    style K fill:#c8e6c9
```

### Configuration Access Pattern

```mermaid
sequenceDiagram
    participant Handler as LlmproxyStartHandler
    participant Base as ChatCommandHandler
    participant VSCode as VS Code API
    participant Settings as settings.json
    
    Handler->>Base: getSetting("hostname")
    Base->>VSCode: workspace.getConfiguration(section + name)
    VSCode->>Settings: Read configuration
    Settings-->>VSCode: value or undefined
    VSCode-->>Base: config value
    Base->>Base: value ?? ""
    Base-->>Handler: "localhost"
    
    Handler->>Base: getSetting("port")
    Base->>VSCode: workspace.getConfiguration(section + name)
    VSCode->>Settings: Read configuration
    Settings-->>VSCode: 8080
    VSCode-->>Base: 8080
    Base->>Base: value ?? ""
    Base-->>Handler: "8080"
    
    Handler->>Handler: parseInt(port) || 8080
    Handler->>Handler: hostname.trim() || "localhost"
```

---

## Advanced Features

### Streaming Response (SSE)

When `stream: true` is set in the request, the server emits OpenAI-compatible
Server-Sent Events as each chunk arrives from the VSCode Language Model API.
The SSE formatting logic lives in `src/lib/sseFormatter.ts` (pure functions,
fully unit-tested).

```mermaid
sequenceDiagram
    participant Client
    participant Server
    participant Handler
    participant SSE as sseFormatter
    participant LM as VS Code LM API
    participant Copilot as GitHub Copilot
    
    Client->>Server: POST {stream: true}
    Server->>Handler: Process with stream=true
    Handler->>Handler: Set SSE headers + flushHeaders()
    Handler->>SSE: generateCompletionId()
    Handler->>LM: sendRequest(messages, options)
    LM->>Copilot: Forward to Copilot API
    
    loop For each chunk from chatResponse.stream
        Copilot-->>LM: chunk
        LM-->>Handler: LanguageModelPart
        
        alt LanguageModelTextPart
            Handler->>SSE: formatTextChunk(id, model, text, role?)
            SSE-->>Handler: "data: {JSON}\n\n"
            Handler->>Client: res.write(SSE event)
        else LanguageModelToolCallPart
            Handler->>SSE: formatToolCallChunk(id, model, toolCall, index)
            SSE-->>Handler: "data: {JSON}\n\n"
            Handler->>Client: res.write(SSE event)
        end
    end
    
    Handler->>SSE: formatFinishChunk(id, model, "stop"|"tool_calls")
    Handler->>Client: res.write(finish event)
    Handler->>SSE: formatDone()
    Handler->>Client: res.write("data: [DONE]\n\n")
    Handler->>Client: res.end()
```

### Multi-Model Support

```mermaid
graph TB
    A[Client Request] --> B{Requested Model}
    B -->|gpt-4o| C[Copilot gpt-4o]
    B -->|claude-3.5-sonnet| D[Copilot Claude]
    B -->|gpt-3.5-turbo| E[Copilot GPT-3.5]
    B -->|Default| F[First Available Model]
    
    C --> G[Process Request]
    D --> G
    E --> G
    F --> G
    
    G --> H[Return Response]
    
    style B fill:#fff9c4
    style G fill:#c8e6c9
```

---

## Summary

This technical documentation covers:

1. **Initialization**: Complete extension activation sequence with all registration steps
2. **Request Processing**: Detailed HTTP request handling with validation and transformation
3. **Message Transformation**: OpenAI to VS Code LM API message format conversion
4. **Tool Calls**: MCP tool implementation with invocation and result handling
5. **Error Handling**: Comprehensive error classification and response patterns
6. **Configuration**: Settings hierarchy and access patterns

These flows ensure robust, predictable behavior and provide clear patterns for extending the proxy functionality.
