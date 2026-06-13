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
} from "./vision.js";

const VERSION = "0.2.0";

export function createVisionBridgeServer(cwd: string): McpServer {
  const server = new McpServer({
    name: "vision-bridge-mcp",
    version: VERSION,
  });

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
        "REQUIRED when main model cannot see images (DeepSeek text, etc.). " +
        "Converts image to detailed text via sidecar vision model with multi-model fallback. " +
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
      const header = [
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

  return server;
}
