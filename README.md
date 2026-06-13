# vision-bridge-mcp

[![CI](https://github.com/G12789/vision-bridge-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/G12789/vision-bridge-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/vision-bridge-mcp?color=cb3837&logo=npm)](https://www.npmjs.com/package/vision-bridge-mcp)
[![MCP](https://img.shields.io/badge/MCP-stdio-7c3aed)](https://modelcontextprotocol.io)
[![node](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

> **让 DeepSeek 等纯文本模型也能「看图」。**
> 双模型桥接 MCP：旁路视觉模型把图转成文字，主模型继续写代码。
>
> Tools: `describe_image` · `extract_text` · `compare_images` · `vision_status` · `vision_rules`

---

## 解决什么问题

| 场景 | 没装本 MCP | vision-bridge-mcp |
|---|---|---|
| Cursor 多模态模型贴图 | 直接看懂 | 不需要本 MCP |
| Claude Code + **DeepSeek 文本** 贴图 | `[Unsupported Image]` 废了 | Agent 调 `describe_image` → 拿到文字描述 |
| IDE 报错截图 | Agent 瞎猜 | `mode: ui` 读出错误栈 |
| 终端红字 OCR | 读不准 | `extract_text` 逐字提取 |
| 前后 UI 对比 | 说不清差异 | `compare_images` |

---

## 架构（双模型）

```
用户贴图 / @screenshot.png
        ↓
主模型（DeepSeek 文本）—— 看不见像素
        ↓ 必须调 MCP
vision-bridge-mcp
        ↓ OpenAI 兼容 Vision API
旁路模型（Qwen-VL / llava / gpt-4o-mini）
        ↓ 返回 Markdown 描述
主模型读文字，继续改代码
```

**关键：** 光装 MCP 不够，还要在 `CLAUDE.md` 写硬规则（见下文），否则 Agent 可能不调工具。

---

## 30 秒接入

### 第一步：准备视觉模型 API Key

**推荐（国内）：** [阿里云百炼 DashScope](https://dashscope.aliyun.com/) → 开通 → 创建 API Key。

**免费本地：** `ollama pull llava`（效果弱于 Qwen-VL，但零成本）。

### 第二步：写 MCP 配置

#### Cursor

`~/.cursor/mcp.json`（全局）或项目 `.cursor/mcp.json`：

```json
{
  "mcpServers": {
    "vision-bridge": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "vision-bridge-mcp@latest"],
      "env": {
        "VISION_BRIDGE_BASE_URL": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "VISION_BRIDGE_API_KEY": "sk-你的DashScope密钥",
        "VISION_BRIDGE_MODELS": "qwen-vl-max,qwen2.5-vl-72b-instruct",
        "VISION_BRIDGE_CACHE": "1"
      }
    }
  }
}
```

**Developer: Reload Window** → Settings → **Tools & MCPs** → 看到绿色 `vision-bridge`。

#### Claude Code

```bash
claude mcp add vision-bridge --env VISION_BRIDGE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1 --env VISION_BRIDGE_API_KEY=sk-xxx --env VISION_BRIDGE_MODELS=qwen-vl-max,qwen2.5-vl-72b-instruct -- npx -y vision-bridge-mcp@latest
```

#### VS Code（Claude Code 扩展 / MCP 插件）

与 Cursor 相同 JSON，写入对应 MCP 配置文件（依扩展文档路径）。

### 第三步：注入自动看图规则

**任选其一：**

```bash
# 推荐：一键装 Skill + 写 CLAUDE.md
npx ship-skills init
```

或手动把 [`templates/CLAUDE.vision-snippet.md`](templates/CLAUDE.vision-snippet.md) 贴进项目根 `CLAUDE.md`。

或让 Agent 调 MCP 工具 `vision_rules`，把返回内容写入 `CLAUDE.md`。

### 第四步：验证

1. MCP 面板 `vision-bridge` 为绿色
2. 调 `vision_status` → 应看到 `models` 列表和 `cache: true`
3. 发一张截图，Agent 应先调 `describe_image` 再回答

---

## 本地免费方案（Ollama）

```bash
ollama pull llava
```

```json
"env": {
  "VISION_BRIDGE_BASE_URL": "http://localhost:11434/v1",
  "VISION_BRIDGE_MODEL": "llava",
  "VISION_BRIDGE_CACHE": "1"
}
```

无需 API Key；`Authorization` 自动用 `ollama` 占位。

---

## 其他视觉后端

### OpenAI

```json
"env": {
  "VISION_BRIDGE_BASE_URL": "https://api.openai.com/v1",
  "VISION_BRIDGE_API_KEY": "sk-...",
  "VISION_BRIDGE_MODELS": "gpt-4o-mini,gpt-4o"
}
```

### DeepSeek（若已开通视觉接口）

```json
"env": {
  "VISION_BRIDGE_BASE_URL": "https://api.deepseek.com/v1",
  "VISION_BRIDGE_API_KEY": "sk-...",
  "VISION_BRIDGE_MODEL": "deepseek-chat"
}
```

> 主模型用 DeepSeek **文本**时，旁路仍须是能处理 `image_url` 的 vision 模型；通义 Qwen-VL 是目前国内最省心的选择。

---

## MCP Tools 完整说明

### `describe_image`（主工具）

把图片转成详细 Markdown 描述。

| 参数 | 类型 | 说明 |
|---|---|---|
| `source` | string | **必填**。本地绝对路径、`https://` URL、或 `data:image/...` |
| `mode` | enum? | `general`（默认）· `ocr` · `ui` · `diagram` · `touchdesigner` |
| `context` | string? | 补充背景，如项目名、页面名 |
| `question` | string? | 针对图的特定问题 |

**示例：**

```json
{
  "source": "C:/Users/me/screenshot.png",
  "mode": "ui",
  "question": "这个报错是什么原因？"
}
```

**mode 选型：**

| mode | 何时用 |
|---|---|
| `general` | 一般截图、不确定类型 |
| `ui` | IDE 界面、设置页、弹窗 |
| `ocr` | 只要逐字文字（也可用 `extract_text`） |
| `diagram` | 架构图、流程图、ERD |
| `touchdesigner` | TD 节点网络截图 |

---

### `extract_text`

OCR 专用，提取图中所有可见文字。

| 参数 | 类型 | 说明 |
|---|---|---|
| `source` | string | 同 `describe_image` |
| `context` | string? | 可选背景 |
| `question` | string? | 可选 |

---

### `compare_images`

对比两张图（before/after、设计稿 vs 实现）。

| 参数 | 类型 | 说明 |
|---|---|---|
| `source_a` | string | 图 A 路径或 URL |
| `source_b` | string | 图 B 路径或 URL |
| `task` | string? | 对比重点，如「按钮颜色差异」 |

---

### `vision_status`

返回当前配置 JSON：版本、模型 fallback 链、缓存开关、各后端示例。

无参数。用于排查「Key 没生效 / 模型名写错」。

---

### `vision_rules`

返回应写入 `CLAUDE.md` 的 Markdown 规则文本，教 Agent 何时自动调看图工具。

无参数。

---

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `VISION_BRIDGE_BASE_URL` | DashScope compatible | OpenAI 兼容 API 根地址 |
| `VISION_BRIDGE_API_KEY` | — | API Key（Ollama 可省略） |
| `VISION_BRIDGE_MODEL` | `qwen-vl-max` | 主视觉模型 |
| `VISION_BRIDGE_MODELS` | — | fallback 链，逗号分隔；前一个失败自动换下一个 |
| `VISION_BRIDGE_CACHE` | `1` | 写入 `.ai/vision/<hash>.md`；设 `0` 关闭 |
| `VISION_BRIDGE_MAX_TOKENS` | `4096` | 视觉模型输出 token 上限 |

兼容别名：`VISION_API_BASE_URL`、`VISION_API_KEY`、`OPENAI_API_KEY`、`VISION_MODEL` 等。

---

## 缓存

同一 `source + mode + question` 命中缓存时，直接读 `.ai/vision/<hash>.md`，省 API 费用。

建议 `.gitignore` 加入：

```
.ai/
```

`npx ship-skills init` 会自动处理。

---

## 日常使用流程

```
1. 新会话开始（可选）→ ctxshot session_brief
2. 用户贴截图
3. Agent 自动 describe_image（靠 CLAUDE.md 规则）
4. Agent 根据文字描述改代码
5. 同一图再次出现 → 读缓存或再调一次
```

**推荐 MCP 组合：**

```json
{
  "mcpServers": {
    "ctxshot": {
      "command": "npx",
      "args": ["-y", "ctxshot-mcp@latest"]
    },
    "vision-bridge": {
      "command": "npx",
      "args": ["-y", "vision-bridge-mcp@latest"],
      "env": {
        "VISION_BRIDGE_BASE_URL": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "VISION_BRIDGE_API_KEY": "sk-xxx",
        "VISION_BRIDGE_MODELS": "qwen-vl-max,qwen2.5-vl-72b-instruct"
      }
    }
  }
}
```

---

## 常见问题

### MCP 不绿 / 启动失败

- 确认 Node.js ≥ 18：`node -v`
- 确认 `npx vision-bridge-mcp@latest` 能跑（stdio 服务，IDE 拉起后保持运行）
- Windows 路径用 `/` 或转义 `\`

### Agent 说「我看不到图」

- **没写 CLAUDE.md 规则** → 运行 `npx ship-skills init` 或贴 `templates/CLAUDE.vision-snippet.md`
- 或对话里明确说：「请用 describe_image 读这张图」

### API 401 / 403

- 检查 `VISION_BRIDGE_API_KEY`
- DashScope 控制台确认已开通 **Qwen-VL** 视觉模型

### API 429 / 模型不可用

- 配置 `VISION_BRIDGE_MODELS` 多个模型做 fallback
- 调 `vision_status` 看当前链

### 识别不准

- 换 `mode`：`ui` 看界面、`extract_text` 看小字
- 换更强模型：`qwen-vl-max` > `llava`
- 加 `question` 缩小范围

### 和 Cursor 原生看图差在哪？

- 多 1–3 秒 MCP 延迟
- 依赖 Agent 记得调工具
- 本质是「文字转述」，不是像素级多模态

---

## 上游致谢（取长补短）

设计吸收自（MIT / 开源社区）：

- [look4yo/claudecode-vision-mcp](https://github.com/look4yo/claudecode-vision-mcp) — DeepSeek + Claude Code 场景、fallback
- [mohamedhusseinios/vision-mcp](https://github.com/mohamedhusseinios/vision-mcp) — OCR/UI/图表分层
- [karlcc/image_mcp](https://github.com/karlcc/image_mcp) — compare_images

---

## 相关包

| 包 | 用途 |
|---|---|
| [ship-skills](https://github.com/G12789/ai-ship) | `vision-auto` Skill + `init` 注入 CLAUDE.md |
| [ctxshot-mcp](https://github.com/G12789/ctxshot-mcp) | 每日项目简报 |
| [evaldrift](https://github.com/G12789/evaldrift) | Prompt 回归测试 |

---

## License

MIT
