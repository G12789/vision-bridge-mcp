import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { extname, resolve } from "node:path";

export interface VisionConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  models: string[];
  cacheEnabled: boolean;
  maxTokens: number;
}

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".tiff": "image/tiff",
  ".tif": "image/tiff",
};

export function loadConfig(): VisionConfig {
  const modelsEnv =
    process.env.VISION_BRIDGE_MODELS ?? process.env.VISION_MODELS ?? "";
  const models = modelsEnv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const primary =
    process.env.VISION_BRIDGE_MODEL ??
    process.env.VISION_BRIDGE_VISION_MODEL ??
    process.env.VISION_MODEL ??
    models[0] ??
    "qwen-vl-max";

  const chain = [primary, ...models.filter((m) => m !== primary)];

  return {
    baseUrl: (
      process.env.VISION_BRIDGE_BASE_URL ??
      process.env.VISION_API_BASE_URL ??
      process.env.OPENAI_BASE_URL ??
      "https://dashscope.aliyuncs.com/compatible-mode/v1"
    ).replace(/\/$/, ""),
    apiKey:
      process.env.VISION_BRIDGE_API_KEY ??
      process.env.VISION_API_KEY ??
      process.env.OPENAI_API_KEY ??
      "",
    model: primary,
    models: chain.length ? chain : [primary],
    cacheEnabled: (process.env.VISION_BRIDGE_CACHE ?? "1") !== "0",
    maxTokens: Number(process.env.VISION_BRIDGE_MAX_TOKENS ?? "4096"),
  };
}

export async function loadImageSource(
  source: string,
  cwd: string,
): Promise<{ dataUrl: string; label: string }> {
  const trimmed = source.trim();
  if (trimmed.startsWith("data:image/")) {
    return { dataUrl: trimmed, label: "data-url" };
  }
  if (/^https?:\/\//i.test(trimmed)) {
    const res = await fetch(trimmed, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`Failed to fetch image URL: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const ct = res.headers.get("content-type") ?? "image/png";
    return {
      dataUrl: `data:${ct};base64,${buf.toString("base64")}`,
      label: trimmed,
    };
  }
  const abs = resolve(cwd, trimmed);
  if (!existsSync(abs)) {
    throw new Error(`Image not found: ${abs}`);
  }
  const ext = extname(abs).toLowerCase();
  if (!MIME[ext]) {
    throw new Error(`Unsupported image type: ${ext}`);
  }
  return { dataUrl: imageToDataUrl(abs), label: abs };
}

export function imageToDataUrl(absPath: string): string {
  const ext = extname(absPath).toLowerCase();
  const mime = MIME[ext] ?? "image/png";
  const b64 = readFileSync(absPath).toString("base64");
  return `data:${mime};base64,${b64}`;
}

/** Markdown image preview for VS Code / Claude chat tool results */
export function imagePreviewMarkdown(absPath: string): string {
  const normalized = absPath.replace(/\\/g, "/");
  const uri =
    process.platform === "win32"
      ? `file:///${normalized}`
      : `file://${normalized}`;
  return `![screenshot preview](${uri})\n\n`;
}

function isRetryable(status: number, body: string): boolean {
  if ([429, 500, 502, 503, 504].includes(status)) return true;
  const lower = body.toLowerCase();
  return (
    lower.includes("quota") ||
    lower.includes("rate") ||
    lower.includes("unavailable") ||
    lower.includes("not found") ||
    lower.includes("model")
  );
}

export async function callVisionModel(
  config: VisionConfig,
  imageDataUrl: string,
  prompt: string,
): Promise<{ text: string; modelUsed: string }> {
  let lastError = "";
  for (const model of config.models) {
    try {
      const text = await callOnce(config, imageDataUrl, prompt, model);
      return { text, modelUsed: model };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      lastError = msg;
      const statusMatch = msg.match(/Vision API (\d+)/);
      const status = statusMatch ? Number(statusMatch[1]) : 0;
      if (!isRetryable(status, msg)) break;
    }
  }
  throw new Error(
    lastError ||
      "All vision models failed. Set VISION_BRIDGE_MODELS and API key.",
  );
}

async function callOnce(
  config: VisionConfig,
  imageDataUrl: string,
  prompt: string,
  model: string,
): Promise<string> {
  const url = `${config.baseUrl}/chat/completions`;
  const body = {
    model,
    temperature: 0.2,
    max_tokens: config.maxTokens,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: imageDataUrl } },
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
    const errText = await res.text();
    throw new Error(`Vision API ${res.status}: ${errText.slice(0, 400)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Vision API returned empty content");
  return text;
}

export function cacheKey(source: string, mode: string, question?: string): string {
  return createHash("sha256")
    .update(`${source}|${mode}|${question ?? ""}`)
    .digest("hex")
    .slice(0, 16);
}

export function readCache(
  cwd: string,
  key: string,
): { text: string; modelUsed: string } | null {
  const file = resolve(cwd, ".ai", "vision", `${key}.md`);
  if (!existsSync(file)) return null;
  const raw = readFileSync(file, "utf8");
  const modelMatch = raw.match(/^model: (.+)$/m);
  const body = raw.replace(/^---[\s\S]*?---\n/, "").trim();
  return {
    text: body,
    modelUsed: modelMatch?.[1] ?? "cached",
  };
}

export function writeCache(
  cwd: string,
  key: string,
  source: string,
  mode: string,
  modelUsed: string,
  text: string,
): void {
  const dir = resolve(cwd, ".ai", "vision");
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, `${key}.md`);
  const meta = `---\nsource: ${source}\nmode: ${mode}\nmodel: ${modelUsed}\n---\n`;
  writeFileSync(file, meta + text, "utf8");
}

export const PROMPTS = {
  general: (ctx?: string, question?: string) =>
    (question ??
      `Describe this image in full detail for a coding agent. Include ALL visible text verbatim, UI elements, errors, diagrams, colors, layout. Markdown. Be factual.`) +
    (ctx ? `\nContext: ${ctx}` : ""),

  ocr: () =>
    `Extract ALL visible text verbatim. Preserve line breaks. Buttons, errors, code, captions. If none: [no text detected].`,

  ui: (ctx?: string) =>
    `Decompose this UI screenshot: layout, components, buttons, inputs, errors, URLs, states. Markdown list.` +
    (ctx ? `\nApp: ${ctx}` : ""),

  diagram: () =>
    `Analyze this technical diagram (flowchart/ERD/architecture/wireframe). Return: type, nodes, edges, labels, summary. Markdown + bullet structure.`,

  touchdesigner: () =>
    `TouchDesigner network screenshot: list OPs, wiring, parameter panel text, errors. Suggest Python DAT actions.`,

  compare: (task?: string) =>
    `Compare these images in detail.${task ? ` Focus: ${task}` : ""} Note differences in text, UI, layout, data.`,
};

export const VISION_AUTO_RULES = `## Image / Vision (required for text-only models like DeepSeek)

Your base model CANNOT see images. When the user:
- pastes / attaches a screenshot in chat
- you see \`[Unsupported Image]\` or the user says they sent a picture
- references any image

You MUST call MCP BEFORE answering (in this order):
1. Multiple images attached → \`describe_paste_batch\` (NOT describe_paste)
2. Single paste / [Unsupported Image] → \`describe_paste\`
3. \`describe_clipboard\` — clipboard only
4. \`describe_image\` — only if user gave an explicit file path

Do NOT use the Read tool on binary images. Do NOT ask the user to save files manually.
Do NOT guess pixels.

Examples:
describe_paste({ "mode": "ui", "question": "What is in this screenshot?" })
describe_clipboard({ "mode": "general" })

After the tool returns, use the text description as if you saw the image.
Cached results live in .ai/vision/*.md.`;
