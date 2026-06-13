# vision-bridge-mcp

**让 DeepSeek 文本模型也能「看图」** — 双模型桥接 MCP，体验逼近 Cursor 截图即发即懂。

主模型（Claude Code + VS Code + DeepSeek 文本）**看不见图片**时，本 MCP 用旁路视觉模型把图转成详细文字，再交给主模型继续干活。

## 为什么需要它

| Cursor | Claude Code + DeepSeek 文本 |
|--------|----------------------------|
| 多模态原生吃图 | `[Unsupported Image]` |
| 零配置 | 需旁路 + 规则 |

本包 = **成熟开源取长补短** 的合并产物，不是从零空想：

| 上游 | 吸收的能力 |
|------|-----------|
| [look4yo/claudecode-vision-mcp](https://github.com/look4yo/claudecode-vision-mcp) | DeepSeek 场景、多模型 fallback、CLAUDE.md 模板 |
| [mohamedhusseinios/vision-mcp](https://github.com/mohamedhusseinios/vision-mcp) | OCR / UI / 图表多 mode |
| [karlcc/image_mcp](https://github.com/karlcc/image_mcp) | `compare_images`、URL 支持 |

## 安装

```bash
npx vision-bridge-mcp@latest
```

### MCP 配置（Cursor / Claude Code / VS Code）

```json
{
  "mcpServers": {
    "vision-bridge": {
      "command": "npx",
      "args": ["-y", "vision-bridge-mcp@latest"],
      "env": {
        "VISION_BRIDGE_BASE_URL": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "VISION_BRIDGE_API_KEY": "YOUR_DASHSCOPE_KEY",
        "VISION_BRIDGE_MODELS": "qwen-vl-max,qwen2.5-vl-72b-instruct"
      }
    }
  }
}
```

### 本地免费（Ollama）

```bash
ollama pull llava
```

```json
"env": {
  "VISION_BRIDGE_BASE_URL": "http://localhost:11434/v1",
  "VISION_BRIDGE_MODEL": "llava"
}
```

## 工具

| 工具 | 用途 |
|------|------|
| `describe_image` | 通用看图（modes: general / ocr / ui / diagram / touchdesigner） |
| `extract_text` | OCR  verbatim 文字 |
| `compare_images` | 两张图对比（before/after） |
| `vision_status` | 查看配置与 fallback 链 |
| `vision_rules` | 获取 CLAUDE.md 自动触发规则 |

### source 格式

- 本地路径（建议绝对路径）
- `https://...` 图片 URL
- `data:image/png;base64,...`

## 逼近 Cursor 的关键：CLAUDE.md 硬规则

光装 MCP 不够 — Agent 必须**自动**调工具。把 `templates/CLAUDE.vision-snippet.md` 贴进项目 `CLAUDE.md`，或运行 `ai-ship init` 自动注入。

也可直接调 MCP：`vision_rules`

## 缓存

结果写入 `.ai/vision/<hash>.md`，同一截图二次引用更快。关闭：`VISION_BRIDGE_CACHE=0`

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `VISION_BRIDGE_BASE_URL` | DashScope compatible | OpenAI 兼容 API |
| `VISION_BRIDGE_API_KEY` | — | API Key |
| `VISION_BRIDGE_MODEL` | `qwen-vl-max` | 主视觉模型 |
| `VISION_BRIDGE_MODELS` | — | fallback 链，逗号分隔 |
| `VISION_BRIDGE_CACHE` | `1` | 本地缓存 |
| `VISION_BRIDGE_MAX_TOKENS` | `4096` | 输出上限 |

## 配合 ai-ship

```bash
npx ai-ship init
```

安装 `vision-auto` Skill + 注入 CLAUDE.md 规则 + ctxshot 上下文。

## License

MIT — 致谢上述上游开源项目。
