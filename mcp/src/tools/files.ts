import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { sendCommand } from '../mobile_client.js';

export const tools: Tool[] = [
  {
    name: 'files',
    description: 'List directory contents or read a file on the device. Pass a directory path to list files; pass a file path to read its content.',
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string', description: 'Absolute file or directory path on the device (e.g. /sdcard/Download)' },
      },
    },
  },
  {
    name: 'write_file',
    description: 'Write text content to a file on the device. Creates parent directories automatically.',
    inputSchema: {
      type: 'object',
      required: ['path', 'content'],
      properties: {
        path:    { type: 'string', description: 'Absolute file path on the device' },
        content: { type: 'string', description: 'Text content to write' },
      },
    },
  },
];

export async function handle(name: string, args: any): Promise<string> {
  const result = await sendCommand(name, args ?? {});
  return JSON.stringify(result);
}
