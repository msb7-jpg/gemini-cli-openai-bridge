# Gemini CLI OpenAI Bridge

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![npm version](https://img.shields.io/npm/v/@miguelsb/gemini-cli-openai-bridge)](https://www.npmjs.com/package/@miguelsb/gemini-cli-openai-bridge)

> **Standalone Evolution & Maintenance**  
> Built upon the open-source [Google Gemini CLI](https://github.com/google-gemini/gemini-cli) core and inspired by the archived [`Intelligent-Internet/gemini-cli-mcp-openai-bridge`](https://github.com/Intelligent-Internet/gemini-cli-mcp-openai-bridge).

`@miguelsb/gemini-cli-openai-bridge` provides a high-performance **OpenAI-compatible (`/v1/chat/completions`)** and **Anthropic Messages-compatible (`/v1/messages`)** HTTP API bridge that routes requests directly to Google Gemini models using the official authentication, session management, and execution engine of Google's Gemini CLI.

It is specifically tailored for AI coding agents and developer workflows such as **[OpenCode](https://opencode.ai)**, **Claude Code (`claude`)**, **Aider**, **Roo Code**, **Continue**, and **Open WebUI**.

---

## 📸 Media & Demos

### 1. OpenCode Multi-Turn Autonomous Tool Calls
OpenCode running complex planning and bash tool execution with `gemini-3.8-flash`:
![OpenCode Tool Calls](media/opencode-tool-calls-example.png)

### 2. OpenCode Multimodal Vision Analysis
Gemini thinking models analyzing visual screenshot inputs directly inside OpenCode:
![OpenCode Vision](media/opencode-vision-example.png)

### 3. Claude Code Running on Gemini 3.8 Flash
Claude Code (`claude`) transparently operating through our Anthropic Messages API (`/v1/messages`):
![Claude Code on Gemini](media/claude-example.png)

---

## ⚡ Key Capabilities

- 🔄 **OpenAI & Anthropic Parity**: Serves standard `/v1/chat/completions` alongside full Anthropic `/v1/messages` (SSE streaming & non-streaming) with `/health` and Claude connection probes (`/api/hello`).
- 🧠 **Thought Signature Preservation**: Seamlessly extracts, caches, and preserves `thought_signature` / `thoughtSignature` tokens across multi-turn function calls, enabling Gemini reasoning models (**Gemini 2.5 Flash/Pro**, **Gemini 3.8 Flash**).
- 🛠️ **Parallel Tool Calling & Turn Parity**: Bundles OpenAI `role: "tool"` responses into Gemini's single `user` turn constraints, matching parts 1:1 and synthesizing fallback responses if any tool call is omitted.
- 🛡️ **Exhaustive Schema Sanitization**: Translates modern OpenAPI 3.1 / JSON Schema constructs (`exclusiveMinimum`, `exclusiveMaximum`, `const`, `oneOf`, `$schema`, `additionalProperties`) into strict Gemini Protobuf schemas without HTTP 400 errors.
- 🔀 **Dynamic Per-Request Model Selection**: Dynamically routes requests according to the model specified in the request payload (`gemini-3.8-flash`, `gemini-2.5-pro`, etc.) rather than forcing a static default.
- 🔑 **Frictionless Authentication**: Inherits existing Gemini CLI credentials (Google OAuth interactive login) or uses the `GEMINI_API_KEY` environment variable.

---

## 🆚 Differences from the Archived Upstream Project

The original upstream repository [`Intelligent-Internet/gemini-cli-mcp-openai-bridge`](https://github.com/Intelligent-Internet/gemini-cli-mcp-openai-bridge) was archived in July 2026. This project is a standalone continuation and refactor that addresses critical issues and modern agent requirements:

| Feature / Area | Original Archived Project | `@miguelsb/gemini-cli-openai-bridge` |
|---|---|---|
| **Anthropic Messages API (`/v1/messages`)** | ❌ Not supported | ✅ **Fully supported**: native integration for **Claude Code** (`claude`) with streaming & tools. |
| **`thought_signature` Handling** | ❌ Stripped / discarded, breaking multi-turn tool calling with thinking models | ✅ **Cached & injected** across turns via `thoughtSignatureCache`, enabling Gemini 2.5 & 3.x thinking models. |
| **JSON Schema Sanitization** | ❌ Minimal (only `$schema` & `additionalProperties`), crashing on modern Zod / Effect Schemas | ✅ **Strict whitelist & conversions** (`exclusiveMinimum`, `const` to `enum`, `oneOf` to `anyOf`, type arrays). |
| **Parallel Tool Calls Parity** | ❌ Mapped 1:1 as separate `user` turns, causing HTTP 400 part mismatch errors | ✅ **Batch grouped** into a single Gemini `user` turn with ordered 1:1 part matching and synthetic fallback. |
| **Model Routing** | ❌ Hardcoded to default `gemini-2.5-flash` regardless of request `model` | ✅ **Dynamic request Proxy**: routes dynamically to requested model (`gemini-3.8-flash`, `gemini-2.5-pro`, etc.). |
| **Supported Models** | ❌ Outdated model listing | ✅ Updated with **Gemini 3.8 Flash**, **Gemini 3 Flash/Pro Preview**, and **Gemini 2.5 Pro/Flash**. |
| **Codebase Architecture** | ⚠️ Heavy MCP proxy bloat that broke under upstream CLI updates | 🚀 **Streamlined & focused**: dedicated HTTP API bridge (OpenAI + Anthropic) with 100% passing test coverage. |

---

## 🚀 Installation & Getting Started

### 1. Global Installation

```bash
npm install -g @miguelsb/gemini-cli-openai-bridge
```

Run the bridge using `gemini-bridge` or `gemini-cli-bridge`:

```bash
gemini-bridge --port=8765
```

### 2. Run Directly via npx

```bash
npx @miguelsb/gemini-cli-openai-bridge --port=8765
```

### 3. Build and Run from Source

```bash
git clone https://github.com/msb7-jpg/gemini-cli-openai-bridge.git
cd gemini-cli-openai-bridge
npm install
npm run build
npm start
```

---

## 🔑 Authentication

The bridge requires authentication to access Google Gemini APIs:

1. **Option A: Gemini CLI OAuth (Interactive - Recommended)**  
   If you have already logged in via `gemini-cli` (`gemini auth login` or `.gemini/settings.json`), the bridge will automatically use your cached credentials.

2. **Option B: Environment Variable (CI / Headless Servers)**  
   Set your API key before starting the server:
   ```bash
   export GEMINI_API_KEY="AIzaSy..."
   gemini-bridge
   ```

---

## 💻 CLI Options

```
Options:
  -h, --host                    Host address to listen on (default: 127.0.0.1)
  -p, --port                    Port to listen on (default: 8765, or GEMINI_BRIDGE_PORT)
  -d, --target-dir              Working directory for operations (default: current directory)
      --debug                   Enable detailed debug logging (default: false)
      --use-internal-prompt     Load internal GEMINI.md prompts (default: false)
      --tools-model             Specify a fallback model for tool execution
      --mode                    Security mode: read-only, edit, configured, yolo
      --i-know-what-i-am-doing  Bypass interactive confirmation for yolo mode
  -?, --help                    Show help
```

---

## 🤖 Integration with OpenCode

Configure the bridge in `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "gemini-bridge": {
      "npm": "@ai-sdk/openai-compatible",
      "baseURL": "http://127.0.0.1:8765/v1",
      "apiKey": "local-bridge",
      "models": {
        "gemini-3.8-flash": {
          "name": "Gemini 3.8 Flash",
          "tools": true
        },
        "gemini-2.5-pro": {
          "name": "Gemini 2.5 Pro",
          "tools": true
        },
        "gemini-2.5-flash": {
          "name": "Gemini 2.5 Flash",
          "tools": true
        }
      }
    }
  }
}
```

Start OpenCode pointing to your model:
```bash
opencode --model gemini-bridge/gemini-3.8-flash
```

---

## 🎭 Integration with Claude Code (`claude`)

The bridge natively exposes the **Anthropic Messages API (`/v1/messages`)** with streaming, function calling / tool execution, and model discovery (`/v1/models`).

### Persistent Setup (All Sessions)

Add the following to `~/.claude/settings.json`:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:8765",
    "ANTHROPIC_AUTH_TOKEN": "local",
    "ANTHROPIC_MODEL": "gemini-3.8-flash"
  }
}
```

Or export them in your shell configuration (`~/.zshrc` or `~/.bashrc`):

```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:8765"
export ANTHROPIC_AUTH_TOKEN="local"
export ANTHROPIC_MODEL="gemini-3.8-flash"
```

### Run Claude Code

```bash
claude
```

Or specify a specific model dynamically:
```bash
claude --model gemini-3.8-flash
claude --model gemini-2.5-pro
claude --model gemini-2.5-flash
```

The bridge translates Claude's tools (`Bash`, `FileRead`, `FileEdit`, etc.) directly to Gemini tool calls and maps results back seamlessly.

---

## 🌐 Generic OpenAI Client Example (cURL)

```bash
curl http://127.0.0.1:8765/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer local" \
  -d '{
    "model": "gemini-3.8-flash",
    "messages": [
      { "role": "user", "content": "Explain quantum computing in one sentence." }
    ],
    "stream": false
  }'
```

---

## 🧪 Testing & Development

Run the test suite:
```bash
npm test
```

Rebuild after modifying files in `bridge-server/`:
```bash
npm run port
npm run build
```

---

## 📄 License & Attribution

- Licensed under [Apache-2.0](LICENSE).
- Core execution engine and authentication: [Google Gemini CLI](https://github.com/google-gemini/gemini-cli) (Copyright Google LLC).
- Architectural foundation: inspired by the archived [`Intelligent-Internet/gemini-cli-mcp-openai-bridge`](https://github.com/Intelligent-Internet/gemini-cli-mcp-openai-bridge) (Copyright 2025 Intelligent-Internet).
