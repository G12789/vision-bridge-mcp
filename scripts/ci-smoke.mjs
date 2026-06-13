import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = join(import.meta.dirname, "..");

spawnSync("npm", ["run", "build"], { cwd: root, shell: true, stdio: "inherit" });

const { createVisionBridgeServer } = await import(
  pathToFileURL(join(root, "dist", "server.js")).href
);
createVisionBridgeServer(root);
console.log("vision-bridge-mcp smoke OK");
