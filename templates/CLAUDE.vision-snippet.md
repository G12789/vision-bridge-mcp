## Image / Vision (required for text-only models like DeepSeek)

Your base model **CANNOT** see images. When the user:

- attaches or references an image path
- pastes a screenshot
- you see `[Unsupported Image]` or similar

You **MUST** call MCP tool `describe_image` (or `extract_text` for OCR) **BEFORE** answering.
Do **NOT** use the Read tool on binary images. Do **NOT** guess pixels.

### Quick reference

| Situation | Tool | mode |
|-----------|------|------|
| General screenshot | `describe_image` | `general` |
| Error dialog / UI bug | `describe_image` | `ui` |
| Verbatim text / logs | `extract_text` | — |
| Architecture / flowchart | `describe_image` | `diagram` |
| TouchDesigner network | `describe_image` | `touchdesigner` |
| Before/after diff | `compare_images` | — |

### Example

```
describe_image({
  "source": "/absolute/path/to.png",
  "mode": "ui",
  "question": "What error is shown?"
})
```

After the tool returns, use the text description as if you saw the image.
Cached results live in `.ai/vision/*.md` — reuse when the same image is referenced again.

### Setup

```json
{
  "mcpServers": {
    "vision-bridge": {
      "command": "npx",
      "args": ["-y", "vision-bridge-mcp@latest"],
      "env": {
        "VISION_BRIDGE_BASE_URL": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "VISION_BRIDGE_API_KEY": "YOUR_KEY",
        "VISION_BRIDGE_MODELS": "qwen-vl-max,qwen2.5-vl-72b-instruct"
      }
    }
  }
}
```

Run `vision_rules` tool or paste this file into your project's `CLAUDE.md`.
