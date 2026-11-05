# Zed Editor Setup Prompt for AI Agents

> **Instructions for the AI Agent:**  
> When the user asks you to set up Zed Editor with the Gemini CLI OpenAI Bridge, follow the exact steps below autonomously.

---

### Goal
Configure Zed Editor custom language models (`settings.json`) with all modalities (thinking/reasoning effort, tool execution, images/vision, parallel tool calls, streaming, and 1M context) pointing to `@migueldsbatista/gemini-cli-openai-bridge` so the user can use Google Gemini models directly inside Zed's Assistant and Agent panels.

---

### Step 1: Verify Prerequisites
1. Ensure **Node.js >= 18** and **npm** are installed:
   ```bash
   node -v
   npm -v
   ```
2. Ensure **Zed Editor** is installed.
3. Verify Gemini credentials:
   - Check if `GEMINI_API_KEY` is exported:
     ```bash
     echo $GEMINI_API_KEY
     ```
   - OR check if authenticated via the Google Gemini CLI:
     ```bash
     gemini --version
     # If not logged in, run: gemini auth login
     ```

---

### Step 2: Install or Build the Bridge
First, attempt installing globally from npm:
```bash
npm install -g @migueldsbatista/gemini-cli-openai-bridge
```

If that fails or you are building from local source:
```bash
# Clone if not already present
git clone https://github.com/msb7-jpg/gemini-cli-openai-bridge.git
cd gemini-cli-openai-bridge

# Build and link globally
npm install
npm run build
npm link
```

---

### Step 3: Locate and Configure Zed `settings.json`

Determine the OS-specific path for Zed's `settings.json`:
- **Linux**: `~/.config/zed/settings.json`
- **macOS**: `~/Library/Application Support/Zed/settings.json`

#### Important: Preserving Existing Configuration
1. Read the existing `settings.json` file if it already exists (e.g., custom themes, LSP settings, keymaps, or editor preferences).
2. Do **not** erase existing user preferences.
3. Add or update the `"language_models"."openai_compatible"` and `"agent"` blocks as shown below (modern Zed uses `"agent"` and `"agent.favorite_models"`; do not use the deprecated root `"assistant"` key).

#### Configuration Snippet:

```json
{
  "language_models": {
    "openai_compatible": {
      "Gemini OpenAI Bridge": {
        "api_url": "http://127.0.0.1:8765/v1",
        "available_models": [
          {
            "name": "gemini-3.8-flash",
            "display_name": "Gemini 3.8 Flash (Thinking)",
            "max_tokens": 1048576,
            "max_output_tokens": 65536,
            "reasoning_effort": "medium",
            "capabilities": {
              "tools": true,
              "images": true,
              "parallel_tool_calls": true,
              "prompt_cache_key": false,
              "chat_completions": true,
              "interleaved_reasoning": false,
              "max_tokens_parameter": false
            }
          },
          {
            "name": "gemini-2.5-pro",
            "display_name": "Gemini 2.5 Pro (Deep Reasoning)",
            "max_tokens": 1048576,
            "max_output_tokens": 65536,
            "reasoning_effort": "high",
            "capabilities": {
              "tools": true,
              "images": true,
              "parallel_tool_calls": true,
              "prompt_cache_key": false,
              "chat_completions": true,
              "interleaved_reasoning": false,
              "max_tokens_parameter": false
            }
          },
          {
            "name": "gemini-3-pro-preview",
            "display_name": "Gemini 3 Pro Preview",
            "max_tokens": 1048576,
            "max_output_tokens": 65536,
            "reasoning_effort": "high",
            "capabilities": {
              "tools": true,
              "images": true,
              "parallel_tool_calls": true,
              "prompt_cache_key": false,
              "chat_completions": true,
              "interleaved_reasoning": false,
              "max_tokens_parameter": false
            }
          },
          {
            "name": "gemini-2.5-flash",
            "display_name": "Gemini 2.5 Flash",
            "max_tokens": 1048576,
            "max_output_tokens": 65536,
            "reasoning_effort": "medium",
            "capabilities": {
              "tools": true,
              "images": true,
              "parallel_tool_calls": true,
              "prompt_cache_key": false,
              "chat_completions": true,
              "interleaved_reasoning": false,
              "max_tokens_parameter": false
            }
          },
          {
            "name": "gemini-2.5-flash-lite",
            "display_name": "Gemini 2.5 Flash Lite",
            "max_tokens": 1048576,
            "max_output_tokens": 65536,
            "capabilities": {
              "tools": true,
              "images": true,
              "parallel_tool_calls": true,
              "prompt_cache_key": false,
              "chat_completions": true,
              "interleaved_reasoning": false,
              "max_tokens_parameter": false
            }
          }
        ]
      }
    }
  },
  "agent": {
    "favorite_models": [
      {
        "provider": "Gemini OpenAI Bridge",
        "model": "gemini-3.8-flash"
      },
      {
        "provider": "Gemini OpenAI Bridge",
        "model": "gemini-2.5-pro"
      },
      {
        "provider": "Gemini OpenAI Bridge",
        "model": "gemini-3-pro-preview"
      },
      {
        "provider": "Gemini OpenAI Bridge",
        "model": "gemini-2.5-flash"
      },
      {
        "provider": "Gemini OpenAI Bridge",
        "model": "gemini-2.5-flash-lite"
      }
    ]
  }
}
```

---

### Step 4: Manage the Bridge Daemon
Start the bridge daemon in background mode:
```bash
gemini-bridge          # Starts in background automatically
gemini-bridge status   # Verify PID, port and health
gemini-bridge logs     # View live logs
```

Or run interactively in a dedicated terminal:
```bash
gemini-bridge --port=8765
```

---

### Step 5: Verify Integration in Zed Editor
1. **Verify Health Endpoint**:
   ```bash
   curl http://127.0.0.1:8765/health
   # Returns: {"status":"ok",...}
   ```
2. **Open Assistant Panel in Zed**:
   - Press `Ctrl-?` (Linux) or `Cmd-?` (macOS) to toggle the Assistant panel.
   - Alternatively, open the Command Palette (`Ctrl-Shift-P` or `Cmd-Shift-P`) and run `assistant: toggle focus`.
3. **Select Gemini Models**:
   - Check the model dropdown selector at the bottom of the Assistant panel.
   - Confirm that the models configured under `Gemini OpenAI Bridge` appear:
     - `Gemini 3.8 Flash (Thinking)`
     - `Gemini 2.5 Pro (Deep Reasoning)`
     - `Gemini 3 Pro Preview`
     - `Gemini 2.5 Flash`
     - `Gemini 2.5 Flash Lite`
4. **Test Chat & Tool Execution**:
   - Send a prompt to verify streaming responses and reasoning effort.
   - Ask the Assistant to analyze a code symbol, read a file, or perform agentic edits in the workspace to verify tool execution.
