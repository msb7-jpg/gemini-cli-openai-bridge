# VSCode Copilot Chat Setup Prompt for AI Agents

> **Instructions for the AI Agent:**  
> When the user asks you to set up VSCode Copilot Chat with the Gemini CLI OpenAI Bridge, follow the exact steps below autonomously.

---

### Goal
Configure VSCode custom language models (`chatLanguageModels.json`) with all modalities (tool calling, vision, thinking/reasoning effort, editTools, streaming, and 1M context) pointing to `@migueldsbatista/gemini-cli-openai-bridge` so the user can use Google Gemini models directly inside GitHub Copilot Chat in VSCode.

---

### Step 1: Verify Prerequisites
1. Ensure **Node.js >= 18** and **npm** are installed:
   ```bash
   node -v
   npm -v
   ```
2. Ensure **VSCode** and the **GitHub Copilot Chat** extension are installed.
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

### Step 3: Locate and Configure `chatLanguageModels.json`

Determine the OS-specific path for VSCode's `chatLanguageModels.json`:
- **Linux**: `~/.config/Code/User/chatLanguageModels.json`
- **macOS**: `~/Library/Application Support/Code/User/chatLanguageModels.json`
- **Windows**: `%APPDATA%\Code\User\chatLanguageModels.json` (e.g. `C:\Users\<User>\AppData\Roaming\Code\User\chatLanguageModels.json`)

#### Important: Preserving Existing Configuration
1. Read the existing file if it already exists (e.g. Copilot CLI or other providers under keys like `"agent-host-copilotcli"`).
2. Do **not** overwrite or erase existing top-level keys.
3. Add or update the `"customendpoint"` array with the Gemini Bridge configuration below.

#### Complete `chatLanguageModels.json` Template:

```json
{
  "customendpoint": [
    {
      "model": "gemini-3.8-flash",
      "name": "Gemini 3.8 Flash (Thinking)",
      "endpoint": "http://127.0.0.1:8765/v1/chat/completions",
      "apiKey": "local-bridge",
      "tools": true,
      "vision": true,
      "thinking": true,
      "editTools": true,
      "streaming": true,
      "maxInputTokens": 1048576,
      "maxOutputTokens": 65536
    },
    {
      "model": "gemini-3-pro-preview",
      "name": "Gemini 3 Pro Preview",
      "endpoint": "http://127.0.0.1:8765/v1/chat/completions",
      "apiKey": "local-bridge",
      "tools": true,
      "vision": true,
      "thinking": true,
      "editTools": true,
      "streaming": true,
      "maxInputTokens": 1048576,
      "maxOutputTokens": 65536
    },
    {
      "model": "gemini-2.5-pro",
      "name": "Gemini 2.5 Pro (Deep Reasoning)",
      "endpoint": "http://127.0.0.1:8765/v1/chat/completions",
      "apiKey": "local-bridge",
      "tools": true,
      "vision": true,
      "thinking": true,
      "editTools": true,
      "streaming": true,
      "maxInputTokens": 1048576,
      "maxOutputTokens": 65536
    },
    {
      "model": "gemini-2.5-flash",
      "name": "Gemini 2.5 Flash",
      "endpoint": "http://127.0.0.1:8765/v1/chat/completions",
      "apiKey": "local-bridge",
      "tools": true,
      "vision": true,
      "thinking": true,
      "editTools": true,
      "streaming": true,
      "maxInputTokens": 1048576,
      "maxOutputTokens": 65536
    },
    {
      "model": "gemini-2.5-flash-lite",
      "name": "Gemini 2.5 Flash Lite",
      "endpoint": "http://127.0.0.1:8765/v1/chat/completions",
      "apiKey": "local-bridge",
      "tools": true,
      "vision": true,
      "thinking": false,
      "editTools": true,
      "streaming": true,
      "maxInputTokens": 1048576,
      "maxOutputTokens": 65536
    }
  ]
}
```

If the file already contains keys such as `"agent-host-copilotcli"`, retain them at top level:
```json
{
  "agent-host-copilotcli": {
    ...
  },
  "customendpoint": [
    ...
  ]
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

### Step 5: Reload VSCode and Verify Integration
1. **Verify Health Endpoint**:
   ```bash
   curl http://127.0.0.1:8765/health
   # Returns: {"status":"ok",...}
   ```
2. **Reload VSCode Window**:
   - Open Command Palette in VSCode (`Ctrl+Shift+P` or `Cmd+Shift+P`).
   - Run: `Developer: Reload Window`.
3. **Verify Models in Copilot Chat**:
   - Open the Copilot Chat panel in VSCode (`Ctrl+Alt+I` or `Cmd+Shift+I`).
   - Open the model selection dropdown and confirm that the Gemini models appear:
     - `Gemini 3.8 Flash (Thinking)`
     - `Gemini 3 Pro Preview`
     - `Gemini 2.5 Pro (Deep Reasoning)`
     - `Gemini 2.5 Flash`
     - `Gemini 2.5 Flash Lite`
4. **Test Capabilities**:
   - **Reasoning / Thinking**: Select `Gemini 3.8 Flash (Thinking)` or `Gemini 2.5 Pro`, verify reasoning effort and thought steps in responses.
   - **Multimodal Vision**: Attach an image or screenshot directly into the Copilot Chat input and ask the model to analyze it.
   - **Code Editing / EditTools**: Use Copilot inline chat (`Ctrl+I` / `Cmd+I`) or `/edit` in Copilot Chat to verify agentic file edits and tool usage.
