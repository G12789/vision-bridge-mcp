import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

const IMAGE_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
]);

function isImageFile(name: string): boolean {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return false;
  return IMAGE_EXT.has(lower.slice(dot));
}

function walkImages(
  dir: string,
  maxDepth: number,
  out: { path: string; mtime: number }[],
  depth = 0,
): void {
  if (depth > maxDepth || !existsSync(dir)) return;
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = join(dir, name);
    try {
      const st = statSync(full);
      if (st.isFile() && isImageFile(name)) {
        out.push({ path: full, mtime: st.mtimeMs });
      } else if (st.isDirectory()) {
        walkImages(full, maxDepth, out, depth + 1);
      }
    } catch {
      /* skip */
    }
  }
}

/** IDE chat attachment roots (Cursor / VS Code / Claude Code). */
export function chatAttachmentRoots(): string[] {
  const appData = process.env.APPDATA ?? "";
  const home = homedir();
  const roots = [
    join(appData, "Cursor", "User", "workspaceStorage"),
    join(appData, "Code", "User", "workspaceStorage"),
    join(appData, "Code - Insiders", "User", "workspaceStorage"),
    join(home, ".cursor", "projects"),
    join(home, ".vscode", "projects"),
  ];
  return roots.filter((r) => r && existsSync(r));
}

export function findChatAttachmentImages(
  maxAgeMs = 300_000,
  limit = 10,
): string[] {
  const now = Date.now();
  const found: { path: string; mtime: number }[] = [];
  for (const root of chatAttachmentRoots()) {
    walkImages(root, 6, found);
  }
  const fresh = found
    .filter((f) => now - f.mtime <= maxAgeMs)
    .sort((a, b) => b.mtime - a.mtime);
  const unique = [...new Set(fresh.map((f) => f.path))];
  return unique.slice(0, limit);
}

/** Mirror IDE attachments into project inbox so multi-paste is never lost. */
export function syncAttachmentsToInbox(
  cwd: string,
  maxAgeMs = 300_000,
  limit = 10,
): string[] {
  const inbox = resolve(cwd, ".ai", "inbox");
  mkdirSync(inbox, { recursive: true });
  const sources = findChatAttachmentImages(maxAgeMs, limit);
  const mirrored: string[] = [];

  for (const src of sources) {
    const stamp = Math.floor(statSync(src).mtimeMs);
    const safe = basename(src).replace(/[^\w.-]+/g, "_");
    const dest = join(inbox, `${stamp}-${safe}`);
    if (existsSync(dest)) {
      mirrored.push(dest);
      continue;
    }
    try {
      copyFileSync(src, dest);
      mirrored.push(dest);
    } catch {
      mirrored.push(src);
    }
  }
  return mirrored;
}
