import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  callVisionModel,
  cacheKey,
  loadConfig,
  loadImageSource,
  PROMPTS,
  readCache,
  VISION_AUTO_RULES,
  writeCache,
  imagePreviewMarkdown,
} from "./vision.js";
import { resolvePasteSource, captureClipboardImage, resolvePasteBatch, findRecentPasteImages } from "./clipboard.js";
import { syncAttachmentsToInbox } from "./attachments.js";

const VERSION = "0.2.3";

export function registerVisionBridgeTools(server: McpServer, cwd: string): void {
  const sourceSchema = {
    source: z
      .string()
      .describe("Local path, http(s) URL, or data:image/... URL"),
    context: z.string().optional(),
    question: z.string().optional().describe("Specific question about the image"),
  };

  async function runVision(
    source: string,
    mode: string,
    prompt: string,
    question?: string,
  ) {
    const config = loadConfig();
    const key = cacheKey(source, mode, question);
    if (config.cacheEnabled) {
      const hit = readCache(cwd, key);
      if (hit) {
        return {
          text: hit.text,
          modelUsed: hit.modelUsed,
          cached: true,
          cacheFile: `.ai/vision/${key}.md`,
        };
      }
    }
    const { dataUrl, label } = await loadImageSource(source, cwd);
    const { text, modelUsed } = await callVisionModel(config, dataUrl, prompt);
    if (config.cacheEnabled) {
      writeCache(cwd, key, label, mode, modelUsed, text);
    }
    return {
      text,
      modelUsed,
      cached: false,
      cacheFile: `.ai/vision/${key}.md`,
    };
  }

  server.registerTool(
    "describe_image",
    {
      title: "Describe image (vision bridge)",
      description:
        "Use describe_paste / describe_clipboard for chat screenshots. " +
        "Fallback: file path, URL, or data URL via sidecar vision model. " +
        VISION_AUTO_RULES.slice(0, 200),
      inputSchema: {
        ...sourceSchema,
        mode: z
          .enum(["general", "ocr", "ui", "diagram", "touchdesigner"])
          .optional(),
      },
    },
    async (args) => {
      const mode = args.mode ?? "general";
      const prompt =
        mode === "ocr"
          ? PROMPTS.ocr()
          : mode === "ui"
            ? PROMPTS.ui(args.context)
            : mode === "diagram"
              ? PROMPTS.diagram()
              : mode === "touchdesigner"
                ? PROMPTS.touchdesigner()
                : PROMPTS.general(args.context, args.question);

      const result = await runVision(
        args.source,
        mode,
        prompt,
        args.question,
      );
      const abs = resolve(cwd, args.source.trim());
      const preview =
        existsSync(abs) && !/^https?:\/\//i.test(args.source.trim())
          ? imagePreviewMarkdown(abs)
          : "";
      const header = [
        preview,
        `# Vision bridge (${mode})`,
        `source: ${args.source}`,
        `model: ${result.modelUsed}`,
        result.cached ? "cached: true" : "",
        `cache: ${result.cacheFile}`,
        "",
      ]
        .filter(Boolean)
        .join("\n");

      return {
        content: [{ type: "text" as const, text: header + result.text }],
      };
    },
  );

  server.registerTool(
    "describe_clipboard",
    {
      title: "Describe image from clipboard",
      description:
        "For Ctrl+V paste flow on Windows. Reads clipboard bitmap — no file path needed. " +
        "Call when user pastes a screenshot or you see [Unsupported Image].",
      inputSchema: {
        mode: z
          .enum(["general", "ocr", "ui", "diagram", "touchdesigner"])
          .optional(),
        context: z.string().optional(),
        question: z.string().optional(),
      },
    },
    async (args) => {
      const mode = args.mode ?? "general";
      const path = captureClipboardImage(cwd);
      const prompt =
        mode === "ocr"
          ? PROMPTS.ocr()
          : mode === "ui"
            ? PROMPTS.ui(args.context)
            : mode === "diagram"
              ? PROMPTS.diagram()
              : mode === "touchdesigner"
                ? PROMPTS.touchdesigner()
                : PROMPTS.general(args.context, args.question);
      const result = await runVision(path, mode, prompt, args.question);
      const header = [
        imagePreviewMarkdown(path),
        `# Vision bridge clipboard (${mode})`,
        `captured: ${path}`,
        `model: ${result.modelUsed}`,
        "",
      ].join("\n");
      return {
        content: [{ type: "text" as const, text: header + result.text }],
      };
    },
  );

  server.registerTool(
    "describe_paste",
    {
      title: "Describe pasted screenshot (auto)",
      description:
        "BEST for chat paste. Clipboard first, then newest temp/inbox image. " +
        "Use when user attaches image in Claude Code or sees [Unsupported Image].",
      inputSchema: {
        mode: z
          .enum(["general", "ocr", "ui", "diagram", "touchdesigner"])
          .optional(),
        context: z.string().optional(),
        question: z.string().optional(),
      },
    },
    async (args) => {
      const mode = args.mode ?? "general";
      const { path, via } = resolvePasteSource(cwd);
      const prompt =
        mode === "ocr"
          ? PROMPTS.ocr()
          : mode === "ui"
            ? PROMPTS.ui(args.context)
            : mode === "diagram"
              ? PROMPTS.diagram()
              : mode === "touchdesigner"
                ? PROMPTS.touchdesigner()
                : PROMPTS.general(args.context, args.question);
      const result = await runVision(path, mode, prompt, args.question);
      const header = [
        imagePreviewMarkdown(path),
        `# Vision bridge paste (${mode})`,
        `source: ${path}`,
        `via: ${via}`,
        `model: ${result.modelUsed}`,
        "",
      ].join("\n");
      return {
        content: [{ type: "text" as const, text: header + result.text }],
      };
    },
  );

  server.registerTool(
    "list_recent_pastes",
    {
      title: "List recent pasted images",
      description:
        "List image files from .ai/paste and temp (last 5 min). Use before describe_paste_batch when user pasted multiple images.",
      inputSchema: {
        max_images: z.number().optional().describe("Max count, default 5"),
        max_age_seconds: z.number().optional().describe("Max age in seconds, default 300"),
      },
    },
    async (args) => {
      const max = args.max_images ?? 5;
      const ageMs = (args.max_age_seconds ?? 300) * 1000;
      syncAttachmentsToInbox(cwd, ageMs, max);
      const paths = findRecentPasteImages(cwd, ageMs, max);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ count: paths.length, paths }, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "sync_chat_attachments",
    {
      title: "Sync IDE chat attachments to project inbox",
      description:
        "Pull recent images from Cursor/VS Code workspaceStorage into .ai/inbox. " +
        "Call automatically when user pastes images before describe_paste_batch.",
      inputSchema: {
        max_images: z.number().optional().describe("Max count, default 5"),
        max_age_seconds: z.number().optional().describe("Max age in seconds, default 300"),
      },
    },
    async (args) => {
      const max = args.max_images ?? 5;
      const ageMs = (args.max_age_seconds ?? 300) * 1000;
      const paths = syncAttachmentsToInbox(cwd, ageMs, max);
      const previews = paths.map((p) => imagePreviewMarkdown(p)).join("");
      return {
        content: [
          {
            type: "text" as const,
            text:
              previews +
              `# Synced ${paths.length} attachment(s) to .ai/inbox\n` +
              paths.map((p, i) => `${i + 1}. ${p}`).join("\n"),
          },
        ],
      };
    },
  );

  server.registerTool(
    "describe_paste_batch",
    {
      title: "Describe multiple pasted screenshots",
      description:
        "When user pasted MULTIPLE images in chat, analyze all recent pastes (not clipboard-only). " +
        "Call this instead of describe_paste when user attaches 2+ images.",
      inputSchema: {
        mode: z
          .enum(["general", "ocr", "ui", "diagram", "touchdesigner"])
          .optional(),
        question: z.string().optional(),
        max_images: z.number().optional().describe("Max images, default 5"),
      },
    },
    async (args) => {
      const mode = args.mode ?? "general";
      const max = args.max_images ?? 5;
      const { paths, via } = resolvePasteBatch(cwd, max);
      const prompt =
        mode === "ocr"
          ? PROMPTS.ocr()
          : mode === "ui"
            ? PROMPTS.ui()
            : mode === "diagram"
              ? PROMPTS.diagram()
              : mode === "touchdesigner"
                ? PROMPTS.touchdesigner()
                : PROMPTS.general(undefined, args.question);

      const parts: string[] = [
        `# Vision bridge batch (${mode})`,
        `via: ${via}`,
        `count: ${paths.length}`,
        "",
      ];

      for (let i = 0; i < paths.length; i++) {
        const p = paths[i];
        const result = await runVision(p, mode, prompt, args.question);
        parts.push(
          imagePreviewMarkdown(p),
          `## Image ${i + 1}`,
          `path: ${p}`,
          `model: ${result.modelUsed}`,
          "",
          result.text,
          "",
        );
      }

      return { content: [{ type: "text" as const, text: parts.join("\n") }] };
    },
  );

  server.registerTool(
    "extract_text",
    {
      title: "OCR extract text",
      description: "OCR for screenshots/logs. Use when you need verbatim text from an image.",
      inputSchema: sourceSchema,
    },
    async (args) => {
      const result = await runVision(args.source, "ocr", PROMPTS.ocr());
      return { content: [{ type: "text" as const, text: result.text }] };
    },
  );

  server.registerTool(
    "compare_images",
    {
      title: "Compare two images",
      description: "Compare before/after screenshots or UI states. Absorbed pattern from image_mcp.",
      inputSchema: {
        source_a: z.string(),
        source_b: z.string(),
        task: z.string().optional(),
      },
    },
    async (args) => {
      const config = loadConfig();
      const a = await loadImageSource(args.source_a, cwd);
      const b = await loadImageSource(args.source_b, cwd);
      const prompt = PROMPTS.compare(args.task);
      const url = `${config.baseUrl}/chat/completions`;
      const body = {
        model: config.model,
        temperature: 0.2,
        max_tokens: config.maxTokens,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "text", text: "Image A:" },
              { type: "image_url", image_url: { url: a.dataUrl } },
              { type: "text", text: "Image B:" },
              { type: "image_url", image_url: { url: b.dataUrl } },
            ],
          },
        ],
      };
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey || "ollama"}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(`Compare failed: ${res.status} ${await res.text()}`);
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = data.choices?.[0]?.message?.content ?? "";
      return { content: [{ type: "text" as const, text }] };
    },
  );

  server.registerTool(
    "vision_status",
    {
      title: "Vision backend status",
      description: "Show vision API config, model fallback chain, cache setting.",
      inputSchema: {},
    },
    async () => {
      const c = loadConfig();
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                version: VERSION,
                pattern: "dual-model (DeepSeek text + vision sidecar)",
                upstreamCredits: [
                  "look4yo/claudecode-vision-mcp",
                  "mohamedhusseinios/vision-mcp",
                  "karlcc/image_mcp",
                ],
                baseUrl: c.baseUrl,
                models: c.models,
                cache: c.cacheEnabled,
                setups: {
                  qwen: {
                    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
                    models: "qwen-vl-max,qwen2.5-vl-72b-instruct",
                  },
                  ollama: {
                    baseUrl: "http://localhost:11434/v1",
                    models: "llava",
                    cmd: "ollama pull llava",
                  },
                  moonshot: {
                    baseUrl: "https://api.moonshot.cn/v1",
                    models: "kimi-k2.5,kimi-k2.6,moonshot-v1-8k-vision-preview",
                  },
                  openai: {
                    baseUrl: "https://api.openai.com/v1",
                    models: "gpt-4o-mini,gpt-4o",
                  },
                },
                claudeMdSnippet: "See templates/CLAUDE.vision-snippet.md",
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    "vision_rules",
    {
      title: "Get CLAUDE.md vision rules",
      description: "Returns markdown rules to paste into CLAUDE.md so the agent auto-calls vision tools.",
      inputSchema: {},
    },
    async () => ({
      content: [{ type: "text" as const, text: VISION_AUTO_RULES }],
    }),
  );
}

export function createVisionBridgeServer(cwd: string): McpServer {
  const server = new McpServer({
    name: "vision-bridge-mcp",
    version: VERSION,
  });
  registerVisionBridgeTools(server, cwd);
  return server;
}
