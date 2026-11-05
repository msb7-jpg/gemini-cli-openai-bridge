# Using Gemini Bridge with OpenAI Codex CLI

[Codex](https://github.com/openai/codex) is an open-source, terminal-based AI coding assistant. You can use the Gemini CLI Bridge to power Codex with Gemini models using its native OpenAI Responses API integration.

## 1. Ensure the Bridge is Running

First, start the Gemini bridge locally:

```bash
gemini-bridge
```

Verify it is running on the default port:

```bash
curl -s http://127.0.0.1:8765/health
```

## 2. Configure Codex (`config.toml`)

Codex CLI uses a global `~/.codex/config.toml` file for its core settings and connections.

Open or create `~/.codex/config.toml` and configure the `gemini_bridge` provider to use the `responses` API wire format:

```toml
# ~/.codex/config.toml

# Set the default provider to our local bridge
model_provider = "gemini_bridge"

# Choose your default model
model = "gemini-3.8-flash"

# Define the local bridge endpoint
[model_providers.gemini_bridge]
name = "Gemini Bridge"
base_url = "http://127.0.0.1:8765/v1"
wire_api = "responses"
```

## 3. Create Profiles for Easy Model Switching (Optional)

Codex (v0.166.0+) supports configuring runtime profiles through overlay files. This lets you quickly switch between a "fast" model and a "heavy" model for complex reasoning.

Create a profile for **fast lookups**:
```bash
echo 'model = "gemini-3.1-flash-lite"' > ~/.codex/fast-code.config.toml
```

Create a profile for **heavy coding tasks**:
```bash
echo 'model = "gemini-3-pro-preview"' > ~/.codex/heavy-coder.config.toml
```

## 4. Run Codex

You can now start Codex and it will automatically use your Gemini models!

**Start the interactive UI with the default model (`gemini-3.8-flash`):**
```bash
codex
```

**Start the interactive UI using a specific profile:**
```bash
codex -p fast-code
# or
codex -p heavy-coder
```

**Run non-interactively:**
```bash
codex exec "Explain how this project's API routing works"

codex -p heavy-coder exec "Refactor the authentication middleware to use standard OAuth 2.0"
```

## 5. Verify the Connection

You can check Codex's runtime health and connection to the bridge at any time using:

```bash
codex doctor
```

Look for `reachability mode provider auth` and confirm that the bridge is reachable!
