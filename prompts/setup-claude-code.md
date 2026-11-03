# Claude Code Setup Prompt for AI Agents

> **Instructions for the AI Agent:**  
> When the user asks you to set up Claude Code (`claude`) with the Gemini CLI OpenAI Bridge, follow the exact steps below autonomously.

---

### Goal
Build the bridge from source and configure Claude Code's Anthropic Messages API endpoint so `claude` routes all requests and tool calls directly to Google Gemini models (like `gemini-3.8-flash` or `gemini-2.5-pro`) without requiring an Anthropic API key.

---

### Step 1: Verify Prerequisites
1. Ensure **Node.js >= 18** and **npm** are installed:
   ```bash
   node -v
   npm -v
   ```
2. Verify Claude Code CLI is installed:
   ```bash
   claude --version
   ```
   If not installed, install it:
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```
3. Verify Gemini credentials:
   - Check `echo $GEMINI_API_KEY`
   - OR check if authenticated via Google Gemini CLI (`gemini auth login`).

---

### Step 2: Build the Bridge from Source
If this repository is not yet cloned locally:
```bash
git clone https://github.com/msb7-jpg/gemini-cli-openai-bridge.git
cd gemini-cli-openai-bridge
```

Build the project:
```bash
npm install
npm run build
```

Link globally so the CLI command is available everywhere:
```bash
npm link
```

---

### Step 3: Configure Claude Code
Configure Claude Code to point its Anthropic Messages API to the bridge server (`http://127.0.0.1:8765`).

#### Method A: Persistent via `~/.claude/settings.json` (Recommended)
Ensure `~/.claude/settings.json` contains:
```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:8765",
    "ANTHROPIC_AUTH_TOKEN": "local",
    "ANTHROPIC_MODEL": "gemini-3.8-flash"
  }
}
```

#### Method B: Shell Environment Variables (`~/.zshrc` or `~/.bashrc`)
Add the following exports:
```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:8765"
export ANTHROPIC_AUTH_TOKEN="local"
export ANTHROPIC_MODEL="gemini-3.8-flash"
```

---

### Step 4: Start the Bridge Server
In a separate terminal or as a background service:
```bash
gemini-bridge --port=8765
```

---

### Step 5: Verify the Integration
1. Test connection probe:
   ```bash
   curl http://127.0.0.1:8765/api/hello
   # Returns: OK
   ```
2. Test models listing:
   ```bash
   curl http://127.0.0.1:8765/v1/models
   ```
3. Launch Claude Code:
   ```bash
   claude
   ```
   Or run a quick query:
   ```bash
   claude --model gemini-3.8-flash -p "Explain quantum superposition in one sentence."
   ```
