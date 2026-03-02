import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { sendAdb } from '../mobile_client.js';

export const tools: Tool[] = [
  {
    name: 'snapshot',
    description: 'Get the current screen UI element tree. Returns a formatted list of all visible elements with text, resource IDs, bounds, and clickable state. Call this before interacting with elements.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'tap',
    description: 'Tap on the screen. Provide x/y coordinates OR find element by text/resourceId/contentDesc.',
    inputSchema: {
      type: 'object',
      properties: {
        x:           { type: 'number', description: 'X coordinate' },
        y:           { type: 'number', description: 'Y coordinate' },
        text:        { type: 'string', description: 'Find element by visible text' },
        resourceId:  { type: 'string', description: 'Find element by Android resource ID' },
        contentDesc: { type: 'string', description: 'Find element by content description' },
      },
    },
  },
  {
    name: 'long_press',
    description: 'Long press at a screen position.',
    inputSchema: {
      type: 'object',
      required: ['x', 'y'],
      properties: {
        x:        { type: 'number' },
        y:        { type: 'number' },
        duration: { type: 'number', description: 'Duration in ms. Default: 1000.' },
      },
    },
  },
  {
    name: 'swipe',
    description: 'Swipe on the screen. Use direction shortcut (up/down/left/right) OR explicit start/end coordinates.',
    inputSchema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: 'Swipe direction shortcut' },
        x1:        { type: 'number', description: 'Start X (use with x2/y1/y2)' },
        y1:        { type: 'number' },
        x2:        { type: 'number', description: 'End X' },
        y2:        { type: 'number' },
        duration:  { type: 'number', description: 'Duration in ms. Default: 300.' },
      },
    },
  },
  {
    name: 'type_text',
    description: 'Type text into the focused input field. Supports Chinese, emoji, and all Unicode (requires ADBKeyboard app for non-ASCII).',
    inputSchema: {
      type: 'object',
      required: ['text'],
      properties: {
        text: { type: 'string' },
      },
    },
  },
  {
    name: 'press_key',
    description: 'Press a system or hardware key. Common keys: home, back, recents, power, enter, delete, volume_up, volume_down, tab, menu, search, camera, notification.',
    inputSchema: {
      type: 'object',
      required: ['key'],
      properties: {
        key: { type: 'string', description: 'Key name (e.g. home, back, enter) or KEYCODE_* constant' },
      },
    },
  },
  {
    name: 'screenshot',
    description: 'Take a screenshot of the current screen. Returns a JPEG image. Use for result verification only — use snapshot for reading UI elements.',
    inputSchema: {
      type: 'object',
      properties: {
        quality: { type: 'number', description: 'JPEG quality 1-100. Default: 30. Lower = smaller image.' },
      },
    },
  },
];

// ── UI XML parser ─────────────────────────────────────────────────────────────

interface UIElement {
  text: string;
  resourceId: string;
  contentDesc: string;
  className: string;
  bounds: string;
  clickable: boolean;
}

function parseUIXml(xml: string): UIElement[] {
  const elements: UIElement[] = [];
  const nodeTagRegex = /<node\s[^>]+>/g;
  let match: RegExpExecArray | null;

  const getAttr = (tag: string, name: string): string => {
    const m = tag.match(new RegExp(`${name}="([^"]*)"`));
    return m ? m[1] : '';
  };

  while ((match = nodeTagRegex.exec(xml)) !== null) {
    const tag = match[0];
    const text        = getAttr(tag, 'text');
    const resourceId  = getAttr(tag, 'resource-id');
    const contentDesc = getAttr(tag, 'content-desc');
    const className   = getAttr(tag, 'class');
    const bounds      = getAttr(tag, 'bounds');
    const clickable   = getAttr(tag, 'clickable') === 'true';

    if ((text || resourceId || contentDesc) && bounds) {
      elements.push({
        text,
        resourceId,
        contentDesc,
        className: className.split('.').pop() || className,
        bounds,
        clickable,
      });
    }
  }
  return elements;
}

function formatElements(elements: UIElement[]): string {
  if (elements.length === 0) {
    return 'UI Elements (0 total)\n\nNo elements found. Try screenshot() to see the screen visually.';
  }
  let out = `UI Elements (${elements.length} total):\n\n`;
  elements.forEach((el, i) => {
    const parts: string[] = [];
    if (el.text)        parts.push(`text="${el.text}"`);
    if (el.resourceId)  parts.push(`id="${el.resourceId}"`);
    if (el.contentDesc) parts.push(`desc="${el.contentDesc}"`);
    parts.push(`bounds=${el.bounds}`);
    if (el.clickable)   parts.push('clickable');
    out += `${i + 1}. [${el.className}] ${parts.join(' | ')}\n`;
  });
  return out;
}

function getBoundsCenter(bounds: string): { x: number; y: number } | null {
  const m = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!m) return null;
  return {
    x: Math.floor((parseInt(m[1]) + parseInt(m[3])) / 2),
    y: Math.floor((parseInt(m[2]) + parseInt(m[4])) / 2),
  };
}

// ── Handlers ──────────────────────────────────────────────────────────────────

export async function handle(name: string, args: any): Promise<any> {

  // screenshot — MCP image block
  if (name === 'screenshot') {
    const quality = typeof args?.quality === 'number' ? args.quality : 30;
    const result = await sendAdb('screenshot', { quality });
    if (result.success && result.data?.data) {
      return {
        content: [{
          type: 'image',
          data: result.data.data,
          mimeType: result.data.mimeType ?? 'image/png',
        }],
      };
    }
    return { content: [{ type: 'text', text: JSON.stringify(result) }], isError: true };
  }

  // snapshot — parse XML → readable text
  if (name === 'snapshot') {
    const result = await sendAdb('snapshot', {});
    if (!result.success) {
      return { content: [{ type: 'text', text: JSON.stringify(result) }], isError: true };
    }
    const xml = typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
    const elements = parseUIXml(xml);
    return { content: [{ type: 'text', text: formatElements(elements) }] };
  }

  // swipe — resolve direction shortcut to coordinates
  if (name === 'swipe') {
    let { x1, y1, x2, y2, direction, duration } = args;

    if (direction && (x1 == null || x2 == null)) {
      // Fetch screen size for direction calculation
      const sizeResult = await sendAdb('screen_size', {});
      const w = sizeResult.data?.width  ?? 1080;
      const h = sizeResult.data?.height ?? 1920;
      const cx = Math.floor(w / 2);
      const cy = Math.floor(h / 2);

      switch (direction) {
        case 'up':    x1 = cx; y1 = Math.floor(h * 0.7); x2 = cx; y2 = Math.floor(h * 0.3); break;
        case 'down':  x1 = cx; y1 = Math.floor(h * 0.3); x2 = cx; y2 = Math.floor(h * 0.7); break;
        case 'left':  x1 = Math.floor(w * 0.7); y1 = cy; x2 = Math.floor(w * 0.3); y2 = cy; break;
        case 'right': x1 = Math.floor(w * 0.3); y1 = cy; x2 = Math.floor(w * 0.7); y2 = cy; break;
      }
    }

    const result = await sendAdb('swipe', { x1, y1, x2, y2, duration });
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  // tap — support element lookup by text/resourceId/contentDesc
  if (name === 'tap') {
    let x: number | undefined = args.x;
    let y: number | undefined = args.y;

    if (x == null || y == null) {
      const snapshotResult = await sendAdb('snapshot', {});
      if (snapshotResult.success) {
        const xml = typeof snapshotResult.data === 'string'
          ? snapshotResult.data
          : JSON.stringify(snapshotResult.data);
        const elements = parseUIXml(xml);
        const target = elements.find(el =>
          (args.text        && el.text.includes(args.text)) ||
          (args.resourceId  && el.resourceId.includes(args.resourceId)) ||
          (args.contentDesc && el.contentDesc.includes(args.contentDesc)),
        );
        if (target) {
          const center = getBoundsCenter(target.bounds);
          if (center) { x = center.x; y = center.y; }
        }
      }
    }

    if (x == null || y == null) {
      const what = args.text ?? args.resourceId ?? args.contentDesc ?? '(unknown)';
      return {
        content: [{ type: 'text', text: JSON.stringify({
          success: false,
          error: `Element not found: "${what}". Try snapshot() to see available elements.`,
        })}],
        isError: true,
      };
    }

    const result = await sendAdb('tap', { x, y });
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  // All other UI tools — pass through
  const result = await sendAdb(name, args);
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
}
