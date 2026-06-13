#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createVisionBridgeServer } from "./server.js";

const server = createVisionBridgeServer(process.cwd());
const transport = new StdioServerTransport();
await server.connect(transport);
