import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { sendCommand } from '../mobile_client.js';

export const tools: Tool[] = [
  {
    name: 'sms',
    description: 'Read SMS messages on the device. Automatically extracts verification codes. Requires READ_SMS permission.',
    inputSchema: {
      type: 'object',
      properties: {
        limit:  { type: 'number',  description: 'Max messages to return (default: 10)' },
        unread: { type: 'boolean', description: 'Only return unread messages' },
        from:   { type: 'string',  description: 'Filter by sender number or name' },
      },
    },
  },
  {
    name: 'contacts',
    description: 'Search and list contacts on the device. Requires READ_CONTACTS permission.',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Search by name or phone number' },
        limit:  { type: 'number', description: 'Max contacts to return (default: 50)' },
      },
    },
  },
  {
    name: 'notifications',
    description: 'Get recent notifications from all apps (collected since ClawPaw started). Requires notification access to be enabled in device settings.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max notifications to return (default: 50)' },
      },
    },
  },
  {
    name: 'clipboard',
    description: 'Read or write the device clipboard.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to write to clipboard. If omitted, reads current clipboard content.' },
      },
    },
  },
];

export async function handle(name: string, args: any): Promise<string> {
  const result = await sendCommand(name, args ?? {});
  return JSON.stringify(result);
}
