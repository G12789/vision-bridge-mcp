## Image / Vision (required for text-only models like DeepSeek)

Your base model **CANNOT** see images. When the user:

- pastes / attaches a screenshot in chat
- you see `[Unsupported Image]`
- asks about a picture they just sent

You **MUST** call MCP **before** answering (order):

1. **`describe_paste`** — clipboard + auto-detect (no file path needed)
2. **`describe_clipboard`** — clipboard only
3. **`describe_image`** — only if user gave an explicit path

Do **NOT** use Read on binary images. Do **NOT** ask user to save files.

```
describe_paste({ "mode": "ui", "question": "What is in this screenshot?" })
```

After the tool returns, answer using the text description.
