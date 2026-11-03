# OpenCode Setup Prompt for AI Agents

> **Instructions for the AI Agent:**  
> When the user asks you to set up the Gemini CLI OpenAI Bridge with OpenCode, follow the exact steps below autonomously.

---

### Goal
Build and configure `@migueldsbatista/gemini-cli-openai-bridge` from source and configure OpenCode (`~/.config/opencode/opencode.json`) so the user can run OpenCode powered by Google Gemini models (including `gemini-3.8-flash` and `gemini-2.5-pro`).

---

### Step 1: Verify Prerequisites
1. Ensure **Node.js >= 18** and **npm** are installed:
   ```bash
   node -v
   npm -v
   ```
2. Verify Gemini authentication exists:
   - Check if `GEMINI_API_KEY` is exported:
     ```bash
     echo $GEMINI_API_KEY
     ```
   - OR check if the user is logged into the official Google Gemini CLI:
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

### Step 3: Configure OpenCode (`~/.config/opencode/opencode.json`)
Read the user's existing `~/.config/opencode/opencode.json` (or create it if missing).
Ensure the `gemini-bridge` provider is defined under `"provider"`:

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

If OpenCode is currently running in server mode, restart the service:
```bash
opencode service restart 2>/dev/null || true
```

---

### Step 4: Start the Bridge Server
Start the bridge in background or in a separate terminal:
```bash
gemini-bridge --port=8765
```
Or via npm start from the repository:
```bash
npm start -- --port=8765
```

---

### Step 5: Verify the Integration
1. Test the health endpoint:
   ```bash
   curl http://127.0.0.1:8765/health
   ```
2. Test completions with OpenCode:
   ```bash
   opencode --model gemini-bridge/gemini-3.8-flash "Say hello and confirm you are connected!"
   ```
