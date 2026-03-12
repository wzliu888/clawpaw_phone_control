#!/usr/bin/env node

// ClawPaw MCP Server
// Exposes phone control tools to Claude/MCP clients.
// Communicates with the ClawPaw backend via HTTP POST /api/mobile
// Backend validates uid+secret, then forwards the command to the phone over WebSocket.
//
// Required env vars:
//   CLAWPAW_BACKEND_URL  e.g. http://localhost:3000
//   CLAWPAW_UID          user uid from ClawPaw web console
//   CLAWPAW_SECRET       clawpaw_secret from ClawPaw web console

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import * as deviceTools from './tools/device.js';
import * as uiTools from './tools/ui.js';
import * as appTools from './tools/apps.js';
import * as hardwareTools from './tools/hardware.js';
import * as mediaTools from './tools/media.js';
import * as communicationTools from './tools/communication.js';
import * as filesTools from './tools/files.js';

const allTools = [
  ...deviceTools.tools,
  ...uiTools.tools,
  ...appTools.tools,
  ...hardwareTools.tools,
  ...mediaTools.tools,
  ...communicationTools.tools,
  ...filesTools.tools,
];

const handlers: Record<string, (name: string, args: Record<string, unknown>) => Promise<any>> = {};
for (const tool of deviceTools.tools) handlers[tool.name] = deviceTools.handle;
for (const tool of uiTools.tools) handlers[tool.name] = uiTools.handle;
for (const tool of appTools.tools) handlers[tool.name] = appTools.handle;
for (const tool of hardwareTools.tools) handlers[tool.name] = hardwareTools.handle;
for (const tool of mediaTools.tools) handlers[tool.name] = mediaTools.handle;
for (const tool of communicationTools.tools) handlers[tool.name] = communicationTools.handle;
for (const tool of filesTools.tools) handlers[tool.name] = filesTools.handle;

const mcpServer = new McpServer(
  { name: 'clawpaw-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// Permissive schema: accept any object so we keep using existing JSON Schema tool definitions
const anyArgsSchema = z.object({}).passthrough();
for (const tool of allTools) {
  mcpServer.registerTool(
    tool.name,
    {
      description: tool.description ?? '',
      inputSchema: anyArgsSchema,
    },
    async (args) => {
      const handler = handlers[tool.name];
      if (!handler) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Unknown tool: ${tool.name}` }) }],
          isError: true,
        };
      }
      try {
        const result = await handler(tool.name, (args ?? {}) as Record<string, unknown>);
        // Handlers may return a ready-made MCP content response (e.g. screenshot image block)
        if (result && typeof result === 'object' && Array.isArray(result.content)) {
          return result;
        }
        return { content: [{ type: 'text', text: result }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: message }) }],
          isError: true,
        };
      }
    }
  );
}

const transport = new StdioServerTransport();
await mcpServer.connect(transport);
console.error(`[ClawPaw MCP] Running — ${allTools.length} tools available`);
