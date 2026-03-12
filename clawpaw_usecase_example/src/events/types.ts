/**
 * Event type definitions for the ClawPaw Agent event system.
 */

export type UserEvent = {
  id: string;
  type: string;
  name: string;
  timestamp: number;
  data: Record<string, unknown>;
};

export function generateEventId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
