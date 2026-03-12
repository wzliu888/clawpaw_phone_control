/**
 * Type declarations for openclaw/plugin-sdk.
 * These types are provided by the openclaw runtime when the plugin is loaded.
 * This file enables standalone type checking during development.
 */

declare module "openclaw/plugin-sdk" {
  import type { Static, TSchema } from "@sinclair/typebox";

  // ─── Tool types ─────────────────────────────────────────────

  export type TextContent = { type: "text"; text: string };
  export type ImageContent = { type: "image"; data: string; mimeType: string };

  export type AgentToolResult<T = unknown> = {
    content: (TextContent | ImageContent)[];
    details: T;
  };

  export type AgentToolUpdateCallback<T = unknown> = (
    partialResult: AgentToolResult<T>,
  ) => void;

  export interface AgentTool<
    TParameters extends TSchema = TSchema,
    TDetails = unknown,
  > {
    name: string;
    label: string;
    description: string;
    parameters: TParameters;
    ownerOnly?: boolean;
    execute: (
      toolCallId: string,
      params: Static<TParameters>,
      signal?: AbortSignal,
      onUpdate?: AgentToolUpdateCallback<TDetails>,
    ) => Promise<AgentToolResult<TDetails>>;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type AnyAgentTool = AgentTool<any, unknown> & {
    ownerOnly?: boolean;
  };

  // ─── Plugin API ─────────────────────────────────────────────

  export type PluginLogger = {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    debug?: (msg: string) => void;
    error?: (msg: string) => void;
  };

  export type PluginConfigUiHint = {
    label?: string;
    help?: string;
    tags?: string[];
    advanced?: boolean;
    sensitive?: boolean;
    placeholder?: string;
  };

  export type OpenClawPluginService = {
    id: string;
    start: (ctx: { stateDir: string; logger: PluginLogger }) => void | Promise<void>;
    stop?: (ctx: { stateDir: string; logger: PluginLogger }) => void | Promise<void>;
  };

  export type OpenClawPluginApi = {
    id: string;
    name: string;
    config: Record<string, unknown>;
    pluginConfig?: Record<string, unknown>;
    logger: PluginLogger;
    runtime: {
      state: { resolveStateDir: () => string };
      system?: {
        requestHeartbeatNow?: (opts: { reason: string }) => void;
      };
      config: {
        loadConfig: () => Record<string, unknown>;
        writeConfigFile: (cfg: Record<string, unknown>) => Promise<void>;
      };
    };
    registerTool: (
      tool: AnyAgentTool,
      opts?: { names?: string[]; optional?: boolean },
    ) => void;
    registerHook: (
      events: string | string[],
      handler: (event: Record<string, unknown>) => void | Promise<void>,
      opts?: { name?: string; description?: string },
    ) => void;
    registerService: (service: OpenClawPluginService) => void;
    registerCommand: (command: {
      name: string;
      description: string;
      acceptsArgs?: boolean;
      handler: (ctx: Record<string, unknown>) => { text: string } | Promise<{ text: string }>;
    }) => void;
    on: (
      hookName: string,
      handler: (...args: unknown[]) => unknown | Promise<unknown>,
      opts?: { priority?: number },
    ) => void;
  };

  // ─── Utilities ──────────────────────────────────────────────

  export function jsonResult(payload: unknown): AgentToolResult<unknown>;
}
