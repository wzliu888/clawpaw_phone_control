import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { sendCommand, sendAdb } from '../mobile_client.js';

export const tools: Tool[] = [
  {
    name: 'volume',
    description: 'Get or set volume. Streams: media, ring, alarm, notification.',
    inputSchema: {
      type: 'object',
      properties: {
        stream: { type: 'string', description: 'Volume stream: media, ring, alarm, notification' },
        level: { type: 'number', description: 'Volume level 0-15. Omit to get current.' },
      },
    },
  },
  {
    name: 'brightness',
    description: 'Get or set screen brightness.',
    inputSchema: {
      type: 'object',
      properties: {
        level: { type: 'number', description: 'Brightness 0-255. Omit to get current.' },
        auto: { type: 'boolean', description: 'Enable auto brightness.' },
      },
    },
  },
  {
    name: 'flashlight',
    description: 'Get or set flashlight. Pass on=true to turn on, on=false to turn off. Omit to get current state.',
    inputSchema: {
      type: 'object',
      properties: {
        on: { type: 'boolean', description: 'true=on, false=off. Omit to get current state. Do NOT pass "action" or any other field — only "on".' },
      },
    },
  },
  {
    name: 'vibrate',
    description: 'Vibrate the device.',
    inputSchema: {
      type: 'object',
      properties: {
        duration: { type: 'number', description: 'Duration in ms. Default: 500.' },
      },
    },
  },
  {
    name: 'ringtone_mode',
    description: 'Get or set the ringer mode. Modes: silent, vibrate, normal.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['silent', 'vibrate', 'normal'],
          description: 'Ringer mode to set. Omit to get current mode.',
        },
      },
    },
  },
  {
    name: 'media_control',
    description: 'Control media playback (play, pause, next track, etc.).',
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: ['play', 'pause', 'toggle', 'next', 'previous', 'stop'],
          description: 'Playback action',
        },
      },
    },
  },
];

export async function handle(name: string, args: any): Promise<any> {
  if (name === 'media_control') {
    const result = await sendAdb('media_control', { action: args.action });
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }
  const result = await sendCommand(name, args);
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
}
