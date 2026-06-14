import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { imageToDataUrl } from "./vision.js";
import { syncAttachmentsToInbox, chatAttachmentRoots } from "./attachments.js";

const IMAGE_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
]);

/** Save clipboard image with timestamp (keeps history for multi-paste). */
export function captureClipboardImage(cwd: string): string {
  if (process.platform !== "win32") {
    throw new Error(
      "describe_clipboard: Windows only. Use describe_image with a file path.",
    );
  }

  const pasteDir = resolve(cwd, ".ai", "paste");
  mkdirSync(pasteDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = join(pasteDir, `paste-${stamp}.png`);
  const latestPath = join(pasteDir, "latest.png");

  const ps = `
Add-Type -AssemblyName System.Windows.Forms
if (-not [System.Windows.Forms.Clipboard]::ContainsImage()) { exit 2 }
$img = [System.Windows.Forms.Clipboard]::GetImage()
if ($null -eq $img) { exit 3 }
$img.Save('${outPath.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
$img.Save('${latestPath.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
Write-Output '${outPath.replace(/'/g, "''")}'
`.trim();

  try {
    const stdout = execFileSync(
      "powershell",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
      { encoding: "utf8", timeout: 15000, windowsHide: true },
    ).trim();
    const saved = stdout.split(/\r?\n/).pop()?.trim() ?? outPath;
    if (!existsSync(saved)) {
      throw new Error("Clipboard had no image or save failed.");
    }
    return saved;
  } catch (e) {
    const err = e as { status?: number; stderr?: Buffer; message?: string };
    if (err.status === 2) {
      throw new Error(
        "Clipboard empty. Paste screenshot (Ctrl+V) in chat first, then call describe_paste immediately.",
      );
    }
    throw new Error(
      `Clipboard capture failed: ${err.stderr?.toString() || err.message || e}`,
    );
  }
}

/** All recent paste images, newest first. */
export function findRecentPasteImages(
  cwd: string,
  maxAgeMs = 300_000,
  limit = 10,
): string[] {
  const dirs = [
    resolve(cwd, ".ai", "paste"),
    resolve(cwd, ".ai", "inbox"),
    ...chatAttachmentRoots(),
    tmpdir(),
    process.env.TEMP ?? "",
    process.env.TMP ?? "",
  ].filter(Boolean);

  const now = Date.now();
  const found: { path: string; mtime: number }[] = [];

  for (const dir of dirs) {
    if (!dir || !existsSync(dir)) continue;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const lower = name.toLowerCase();
      const dot = lower.lastIndexOf(".");
      if (dot < 0) continue;
      const ext = lower.slice(dot);
      if (!IMAGE_EXT.has(ext)) continue;
      const full = join(dir, name);
      try {
        const st = statSync(full);
        if (!st.isFile()) continue;
        if (now - st.mtimeMs > maxAgeMs) continue;
        found.push({ path: full, mtime: st.mtimeMs });
      } catch {
        /* skip */
      }
    }
  }

  found.sort((a, b) => b.mtime - a.mtime);
  const unique = [...new Set(found.map((f) => f.path))];
  return unique.slice(0, limit);
}

export function findRecentPasteImage(cwd: string, maxAgeMs = 120_000): string | null {
  return findRecentPasteImages(cwd, maxAgeMs, 1)[0] ?? null;
}

export function resolvePasteSource(cwd: string): {
  path: string;
  via: "clipboard" | "recent_file";
} {
  syncAttachmentsToInbox(cwd);
  try {
    return { path: captureClipboardImage(cwd), via: "clipboard" };
  } catch (clipErr) {
    const recent = findRecentPasteImage(cwd);
    if (recent) return { path: recent, via: "recent_file" };
    throw clipErr;
  }
}

/** Try clipboard first, then return all recent paste images (multi-paste). */
export function resolvePasteBatch(
  cwd: string,
  maxImages = 5,
  maxAgeMs = 300_000,
): { paths: string[]; via: string } {
  try {
    captureClipboardImage(cwd);
  } catch {
    /* clipboard may be empty if user used attach-only */
  }
  syncAttachmentsToInbox(cwd, maxAgeMs, maxImages);
  const paths = findRecentPasteImages(cwd, maxAgeMs, maxImages);
  if (!paths.length) {
    throw new Error(
      "No recent paste images. Paste screenshots in chat (one by one or multiple), then call describe_paste_batch.",
    );
  }
  return { paths, via: "paste+inbox+ide_attachments" };
}

export function saveDataUrlToPaste(cwd: string, dataUrl: string): string {
  const m = dataUrl.match(/^data:image\/([\w+.-]+);base64,(.+)$/i);
  if (!m) throw new Error("Invalid data:image URL");
  let ext = m[1] === "jpeg" ? "jpg" : m[1];
  if (ext.includes("+")) ext = ext.split("+")[0];
  const pasteDir = resolve(cwd, ".ai", "paste");
  mkdirSync(pasteDir, { recursive: true });
  const file = join(pasteDir, `chat-paste.${ext}`);
  writeFileSync(file, Buffer.from(m[2], "base64"));
  return file;
}

export function dataUrlFromFile(absPath: string): string {
  return imageToDataUrl(absPath);
}
