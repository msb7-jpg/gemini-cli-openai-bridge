# Gemini CLI - MCP/OpenAI 桥接服务器

[English README](https://github.com/Intelligent-Internet/gemini-cli-common-bridge/blob/main/README.md)

`@intelligentinternet/gemini-cli-mcp-openai-bridge` （`gemini-cli-bridge`） 是一个多功能的服务器应用程序，旨在作为 `gemini-cli` 生态系统的强大扩展。它主要承担两个核心角色：

1.  **MCP 工具包**: 它暴露 `gemini-cli` 的所有内置工具（如文件系统操作、由Gemini模型支持的网络搜索和网页理解等），，通过一个统一的 MCP 端点提供服务。
  - 也可以连接到任意数量的外部 MCP 服务器。（仅在YOLO模式、或configured模式配置具体工具名后允许）

2.  **OpenAI 兼容的 API 桥接器**: 它提供了一个与 OpenAI Chat Completions API (`/v1/chat/completions`) 完全兼容的端点。这使得任何支持 OpenAI API 的第三方工具或应用程序（例如 [Open WebUI](https://github.com/open-webui/open-webui)）都可以无缝地与 `gemini-cli` 的底层 Gemini 模型进行交互。

## 功能特性

-   **Build upon `gemini-cli`**: 直接基于 `gemini-cli` 的核心功能构建，确保与 Gemini 模型的深度集成。
-   **托管原生 `gemini-cli` 工具**: 通过 MCP 协议暴露 `gemini-cli` 的内置工具。
-   **聚合外部 MCP 工具**: 可充当 MCP 中心枢纽，连接并代理来自其他工具服务器的工具 （仅限 `yolo` 模式或在 `restricted` 模式下配置具体工具名后允许）。
-   **完整的 OpenAI API 兼容性**: 提供 `/v1/chat/completions` 和 `/v1/models` 端点，支持流式和非流式请求。
-   **灵活的模型配置**: 允许为工具执行（如网页搜索摘要）配置独立默认 LLM 模型。
-   **继承配置与认证**: 自动使用与主 `gemini-cli` 工具相同的设置和认证状态，无需重复配置。
-   **可配置的安全策略**: 实现了MCP工具基础安全模型，具有 `read-only`、`restricted` 和 `yolo` 三种模式来控制工具的执行。

## 先决条件

-   [Node.js](https://nodejs.org/) v18 或更高版本。
-   [Gemini CLI](https://github.com/google-gemini/gemini-cli) 所要求的所有依赖项和配置。
  -   本项目会自动安装 `gemini-cli` 的子模块（来自 `gemini-cli` 的 官方Github），因此你不需要单独安装它。
  -   如果你已经安装了 `gemini-cli`，将会被本项目的子模块覆盖版本。

## 安装

```bash
npm install -g @intelligentinternet/gemini-cli-bridge
```

## 使用方法

**安全警告**: 本桥接服务调取工具的时候**不会跟用户进行确认**。
- 为了您的安全，MCP桥接服务默认运行在`read-only`模式，也不会桥接您在settings.json中配置的其他MCP服务。
- 本项目自己不提供Runtime沙箱。如希望配置`YOLO`安全策略，请确定您的环境不会被意外运行的Shell命令破坏（强烈建议在容器中运行）。

### 1. 启动服务器

在你的终端中运行命令。你可以使用命令行参数来覆盖默认设置。

```bash
# 在所有网络接口的 9000 端口启动服务器，并启用调试模式
gemini-cli-bridge --host=127.0.0.1 --port=9000 --debug

# 使用一个更快的模型进行工具调用，并加载内部 GEMINI.md 提示
gemini-cli-bridge --tools-model=gemini-2.5-flash --use-internal-prompt
```

服务器成功启动后，你将看到类似以下的输出：

```
[BRIDGE-SERVER] [INFO] Starting Gemini CLI Bridge (MCP + OPENAI)...
[BRIDGE-SERVER] [INFO] Server running {
  port: 8765,
  host: '127.0.0.1',
  mcpUrl: 'http://127.0.0.1:8765/mcp',
  openAIUrl: 'http://127.0.0.1:8765/v1'
}
```

### 2. 从源码构建 (开发者)

```bash
git clone https://github.com/Intelligent-Internet/gemini-cli-common-bridge.git
cd gemini-cli-common-bridge
npm install
npm run build
npm run start
```

## 认证机制

此桥接服务 **不管理自己的认证凭据**。它与主 `gemini-cli` 工具共享完全相同的认证机制，以确保无缝和安全的操作。

-   **缓存的凭据**: 如果你已经通过 `gemini-cli` 的交互式流程登录，桥接服务会自动使用缓存的凭据。
-   **环境变量**: 服务器会自动查找并使用 `GEMINI_API_KEY` 或 `GOOGLE_APPLICATION_CREDENTIALS` 等环境变量。

只要你的 `gemini-cli` 经过配置、能够正常使用，此桥接服务就能自动获得授权。


好的，这是为您撰写的 `bridge-server` 的安全性 README 章节。

---

## 🛡️ 安全模型与配置 (Security Model & Configuration)

`gemini-cli-bridge` 的核心设计之一是提供一个基础但必要的安全模型，以保护您的本地环境免受意外或恶意操作。在将强大的 AI 模型与本地工具（如文件系统访问和 shell 命令）连接时，安全性至关重要。

**默认情况下，服务器以最安全的 `read-only` (只读) 模式运行。**

### 安全模式 (Security Modes)

您可以通过 `--mode` 命令行参数或在 `settings.json` 文件中配置 `securityPolicy.mode` 来设置服务器的安全级别。命令行参数的优先级更高。

共有四种模式可供选择：

#### 1. `read-only` (只读模式 - **默认**)

这是最安全、也是默认的模式。如果您不进行任何安全配置，服务器将在此模式下运行。

*   ✅ **允许**: 仅允许那些不会修改本地文件系统或执行任意代码的内置工具。例如：`read_file`, `list_directory`, `glob`, `google_web_search`。
*   ❌ **禁止**: 所有具有写入权限的工具（如 `write_file`, `replace`）、`run_shell_command` 以及所有来自外部 MCP 代理的工具。

**适用场景**: 当您只需要让 AI 模型读取本地文件、获取信息或进行网络搜索时，这是最理想的选择。

#### 2. `edit` (编辑模式)

此模式专为本地代码生成和文件编辑任务设计，提供了一个在功能和安全之间的平衡点。

*   ✅ **允许**: 所有内置的只读工具，以及具有文件写入和修改权限的工具，如 `write_file` 和 `replace`。
*   ❌ **禁止**: `run_shell_command`（防止执行任意命令）和所有外部 MCP 代理工具（防止意外的网络交互）。

**适用场景**: 在受信任的本地开发环境中使用，用于代码重构、生成新文件等开发任务。

#### 3. `configured` (配置模式)

此模式将安全控制权完全交给您的 `settings.json` 文件。它的行为完全由您的 `securityPolicy` 配置块定义。

*   **行为**:
    *   **工具**: 只有在 `allowedTools` 数组中明确列出的工具才会被启用。
    *   **Shell 命令**: 如果 `run_shell_command` 在 `allowedTools` 中，其可执行的命令将受到 `shellCommandPolicy` 中 `allow` 和 `deny` 列表的严格限制。
    *   **MCP 代理**: 默认情况下，所有 MCP 代理工具都是禁用的。您必须使用 `--allow-mcp-proxy` 命令行参数来显式启用它们。

**适用场景**: 高级用户或在受控环境中需要对特定工具和命令进行精细化权限管理的场景。

#### 4. `yolo` (放飞自我模式 - **高度危险**)

此模式会禁用几乎所有的内置安全护栏。

*   ✅ **允许**: 所有**内置**工具，包括没有任何限制的 `run_shell_command`。
*   **MCP 代理**: 默认禁用，但可以通过 `--allow-mcp-proxy` 参数启用。

> **⚠️ 极度危险警告**: `yolo` 模式赋予了 AI 模型在您的系统上执行任何命令的能力，包括 `rm -rf /` 等破坏性操作。**绝对不要**在生产环境或任何不受信任的网络环境中使用此模式。

### 外部工具安全 (MCP Proxy)

`bridge-server` 可以连接到外部的 MCP（Model-Context Protocol）服务器，这些服务器被称为“MCP 代理”，它们可以提供额外的工具（例如，连接到内部 Jira、操作 GitHub 或生成图片）。

*   **默认禁用**: 为了安全，所有 MCP 代理工具在 `read-only` 和 `edit` 模式下都是**完全禁用**的。
*   **显式启用**: 您只能在 `configured` 或 `yolo` 模式下，通过添加 `--allow-mcp-proxy` 命令行参数来启用所有已发现的 MCP 代理工具。

> **🔴 MCP 代理警告**: 启用 MCP 代理意味着 `bridge-server` 将允许 AI 模型通过这些代理与第三方服务进行网络通信。请确保您完全信任所配置的每一个 MCP 服务器的来源和其提供的工具。

### 强制性安全确认

为了防止意外启用高风险模式，`bridge-server` 内置了强制性的交互式确认机制。

*   **触发条件**:
    1.  启动时进入 `yolo` 模式。
    2.  启动时使用了 `--allow-mcp-proxy` 参数。
*   **确认流程**: 服务器在启动时会暂停，并要求您在控制台中输入 `YES` (全大写) 并按回车键。如果输入不匹配，服务器将安全退出。
*   **跳过确认**: 在完全自动化的脚本或您已充分了解风险的情况下，可以使用 `--i-know-what-i-am-doing` 命令行参数来跳过此交互式确认。

### 文件操作域 (File Scope)

所有内置的文件系统工具（如 `read_file`, `write_file`, `list_directory` 等）的操作范围都被严格限制在**一个**目录内。

*   **默认域**: 默认情况下，这个操作域是您**启动 `bridge-server` 时所在的当前工作目录**。
*   **自定义域**: 您可以使用 `--target-dir /path/to/your/project` 命令行参数来明确指定操作域。

这个机制可以有效防止 AI 代理意外地读取或修改您项目目录之外的任何文件。

### 监听主机
服务器默认监听在 `127.0.0.1` 上。您可以通过 `--host` 命令行参数或 `GEMINI_MCP_HOST` 环境变量来修改此设置。
如果您希望服务器监听所有网络接口，可以将其设置为 `0.0.0.0`。（请勿在生产环境中使用此设置，除非您有额外的网络安全措施，或在容器网络中运行）
注意：在生产环境中，**强烈建议**使用防火墙或其他网络安全措施来限制对此端口的访问。**本服务不提供任何认证、授权和审计功能**。

---

## 完整配置

你可以通过设置文件、命令行参数和环境变量来配置服务器的行为。

### 命令行参数与环境变量

参数的优先级高于环境变量和设置文件。

| 参数 | 别名 | 环境变量 | 默认值 | 描述 |
| :--- | :--- | :--- | :--- | :--- |
| `--host` | `-h` | - | `127.0.0.1` | 服务器监听的主机地址。使用 `0.0.0.0` 来监听所有网络接口。 |
| `--port` | `-p` | `GEMINI_MCP_PORT` | `8765` | 服务器监听的端口。 |
| `--tools-model` | - | `GEMINI_TOOLS_DEFAULT_MODEL` | `gemini-2.5-flash` | 用于工具执行的默认模型。 |
| `--use-internal-prompt` | - | - | `false` | 如果设置，则加载 `GEMINI.md` 文件及默认System Prompt作为上下文。（客户端提供的System Prompt将会被当做第一条User Prompt） |
| `--debug` | - | - | `false` | 启用详细的调试日志。 |
| `--mode` | - | - | `read-only` | 设置服务器的安全模式。可选值：`read-only`, `edit`, `configured`, `yolo`。 |
| `--allow-mcp-proxy` | - | - | `false` | 在 `configured` 或 `yolo` 模式下启用 MCP 代理工具。 |
| `--i-know-what-i-am-doing` | - | - | - | `false` | 跳过高风险模式的安全确认。仅在您完全了解风险时使用。 |
| `--target-dir` | - | - | 当前工作目录 | 设置文件操作的
| `--help` | `?` | - | - | 显示帮助信息。 |

### 设置文件 (`.gemini/settings.json`)

**安全策略 (`securityPolicy`)** 是最重要的配置项。你可以在用户目录 (`~/.gemini/settings.json`) 或工作区目录 (`.gemini/settings.json`) 中进行配置。
当mode 为 `configured` 时，服务器将严格遵循此配置; 命令行参数将覆盖此设置中的 `mode`。

```json
// .gemini/settings.json 示例
{
  "securityPolicy": {
    "mode": "restricted",
    "allowedTools": [
      "read_file",
      "list_directory",
      "google_web_search",
      "run_shell_command"
    ],
    "shellCommandPolicy": {
      "allow": ["ls -l", "git status", "npm run test"],
      "deny": ["rm", "sudo", "docker"]
    }
  },
  "mcpServers": {
    "github": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-e", "GITHUB_PERSONAL_ACCESS_TOKEN=${GITHUB_PAT}", "ghcr.io/github/github-mcp-server"],
      "trust": true
    }
  }
}
```

-   **`securityPolicy`**: 控制服务器的安全边界。**如果此项缺失且未明确设置命令行参数，服务器将默认以最安全的 `read-only` 模式运行**。
    -   **`mode`**:
        -   `"read-only"` (默认): 只允许执行只读工具（如 `read_file`, `list_directory`）。
        -   `"restricted"`: 推荐模式。只允许在 `allowedTools` 数组中明确列出的工具。
        -   `"balanced"`: 允许所有内置工具，但不允许执行 `run_shell_command`。
        -   `"yolo"`: 最不安全的模式。允许所有工具，无任何限制。
    -   **`allowedTools`**: 在 `restricted` 模式下，定义了哪些工具（包括来自外部MCP服务器的工具）可以被注册和调用。
    -   **`shellCommandPolicy`**: 对 `run_shell_command` 工具进行精细化控制。`deny` 规则的优先级高于 `allow` 规则。

-   **`mcpServers`**: 配置外部 MCP 服务器，以扩展桥接器的工具能力。

-   其他配置项可以参考 [Gemini CLI 设置文档](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/configuration.md). 

配置支持情况：
好的，这是一个 Markdown 表格，总结了 `bridge-server` 对 `gemini-cli` `settings.json` 配置项的支持情况。

### `settings.json` 配置项在 `bridge-server` 中的支持情况

| 配置项 | 支持情况 | 理由与说明 |
| :--- | :--- | :--- |
| **`securityPolicy`** | ✅ **完全支持** | **核心功能**。这是 `bridge-server` 新增的、用于控制工具访问权限和命令执行的主要安全机制。 |
| **`coreTools`** | ✅ **完全支持** | 直接影响 `ToolRegistry` 初始化时注册哪些内置工具，从而控制通过 MCP 暴露的工具集。 |
| **`excludeTools`** | ✅ **完全支持** | 与 `coreTools` 类似，用于从可用工具集中移除特定工具，是安全策略的一部分。 |
| **`toolDiscoveryCommand`** | ✅ **完全支持** | 服务器会执行此命令来发现自定义工具，并通过 MCP 协议暴露它们。 |
| **`toolCallCommand`** | ✅ **完全支持** | 当通过 MCP 调用一个已发现的自定义工具时，服务器会执行此命令。 |
| **`mcpServers`** | ✅ **完全支持** | 服务器会尝试连接并集成在 `mcpServers` 中配置的所有外部工具服务器。 |
| **`selectedAuthType`** | ✅ **完全支持** | **关键配置**。决定了 `bridge-server` 如何向 Google API 进行身份验证。 |
| **`fileFiltering`** | ✅ **完全支持** | `bridge-server` 内部使用的文件工具（如 `glob`）会遵循此配置中的 `respectGitIgnore` 等规则。 |
| **`telemetry`** | ✅ **完全支持** | 服务器会根据这些设置来初始化和配置 OpenTelemetry，用于遥测数据收集。 |
| **`usageStatisticsEnabled`** | ✅ **完全支持** | 控制是否向 Google 发送匿名的使用统计数据。 |
| **`contextFileName`** | 🟡 **有条件支持** | 仅在 `bridge-server` 启动时使用了 `--use-internal-prompt` 参数时才会生效。 |
| **`theme`** | ❌ **不支持** | `bridge-server` 是一个无 UI 的后端服务，不涉及任何视觉主题。 |
| **`autoAccept`** | ❌ **不相关** | `bridge-server` 内部硬编码为 `YOLO` 批准模式，从不等待用户交互式确认。其安全性由 `securityPolicy` 保障。 |
| **`sandbox`** | ❌ **不支持** | `bridge-server` **不会创建**沙箱。它只能感知自己是否已运行在由其他进程（如 `gemini-cli`）创建的沙箱中。 |
| **`checkpointing`** | ❌ **不支持** | 该功能与 `gemini-cli` 的交互式会话和本地 Git 快照紧密耦合，不适用于无状态的服务器。 |
| **`preferredEditor`** | ❌ **不支持** | 用于在 `gemini-cli` 中打开外部编辑器，`bridge-server` 没有此交互流程。 |
| **`bugCommand`** | ❌ **不支持** | 这是 `gemini-cli` 的 `/bug` 命令的配置，与 `bridge-server` 无关。 |
| **`hideTips`** | ❌ **不支持** | 纯 UI 配置。 |
| **`hideWindowTitle`** | ❌ **不支持** | 纯 UI 配置。 |
| **`accessibility`** | ❌ **不支持** | 纯 UI 配置，用于禁用加载动画等。 |

## 遥测、服务条款与隐私

本服务**不引入任何新的遥测或数据收集机制**。它完全依赖于 `@google/gemini-cli-core` 包中内置的 OpenTelemetry (OTEL) 系统。所有遥测数据（如果启用）都将遵循 `gemini-cli` 的主配置。

你的使用行为受制于你用于认证的 `gemini-cli` 账户类型所对应的服务条款和隐私政策。

-   [Gemini CLI 遥测文档](https://github.com/google-gemini/gemini-cli/blob/main/docs/telemetry.md)
-   [Gemini CLI 服务条款和隐私声明](https://github.com/google-gemini/gemini-cli/blob/main/docs/tos-privacy.md)

## 贡献

这是一个正在开发的项目，我们欢迎社区的贡献！请遵循以下步骤：

1.  Fork 本仓库并在您的本地环境中进行修改。
2.  提交 Pull Request，描述您的更改及其目的。
3.  我们会尽快审查您的请求并提供反馈。

感谢您的参与！