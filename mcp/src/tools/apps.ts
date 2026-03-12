import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { sendAdb, sendCommand } from '../mobile_client.js';

export const tools: Tool[] = [
  {
    name: 'list_apps',
    description: 'List installed user (non-system) apps. Returns package name and label for each app.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'launch_app',
    description: 'Launch an app by package name.',
    inputSchema: {
      type: 'object',
      required: ['package'],
      properties: {
        package: { type: 'string', description: 'Android package name, e.g. com.taobao.taobao' },
      },
    },
  },
  {
    name: 'shell',
    description: 'Execute a shell command on the device. Use for advanced operations not covered by other tools.',
    inputSchema: {
      type: 'object',
      required: ['command'],
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
      },
    },
  },
  {
    name: 'open_url',
    description: 'Open a URL or deep link on the device (browser, app deep link, etc.).',
    inputSchema: {
      type: 'object',
      required: ['url'],
      properties: {
        url: { type: 'string', description: 'URL or deep link to open, e.g. https://example.com or weixin://' },
      },
    },
  },
  {
    name: 'send_sms',
    description: 'Open the SMS composer with a pre-filled recipient and message body. The user still needs to tap Send.',
    inputSchema: {
      type: 'object',
      required: ['phone', 'body'],
      properties: {
        phone: { type: 'string', description: 'Recipient phone number' },
        body:  { type: 'string', description: 'Message body' },
      },
    },
  },
  {
    name: 'call',
    description: 'Initiate a phone call to the given number.',
    inputSchema: {
      type: 'object',
      required: ['phone'],
      properties: {
        phone: { type: 'string', description: 'Phone number to call' },
      },
    },
  },
  {
    name: 'screen_on',
    description: 'Wake up and turn on the screen.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'screen_off',
    description: 'Turn off the screen (sleep/lock).',
    inputSchema: { type: 'object', properties: {} },
  },
];

export async function handle(name: string, args: any): Promise<any> {
  if (name === 'list_apps') {
    const result = await sendAdb('list_apps', {});
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  if (name === 'launch_app') {
    const result = await sendAdb('launch_app', { package: args.package });
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  if (name === 'shell') {
    const result = await sendAdb('shell', { command: args.command });
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  // ADB-routed tools
  if (['open_url', 'send_sms', 'call', 'screen_on', 'screen_off'].includes(name)) {
    const result = await sendAdb(name, args ?? {});
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  const result = await sendCommand(name, args);
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
}
