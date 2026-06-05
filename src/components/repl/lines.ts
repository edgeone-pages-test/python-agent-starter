/**
 * Pure helpers for building & mutating ReplLine[] state.
 * Kept dependency-free so they can be unit-tested in isolation.
 */
import type { ImageAttachment, ReplLine, TurnMeta } from '../../types';
const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export function makeMotd(): ReplLine {
  return { kind: 'motd', id: newId() };
}

export function makeUser(text: string): ReplLine {
  return { kind: 'user', id: newId(), text, ts: Date.now() };
}

export function makeText(turnId: string, initial = '', isContinuation = false): ReplLine {
  return { kind: 'text', id: newId(), turnId, text: initial, ts: Date.now(), isContinuation };
}

export function makeTool(turnId: string, tool: string): ReplLine {
  return { kind: 'tool', id: newId(), turnId, tool, ts: Date.now() };
}

export function makeImage(
  turnId: string,
  image: ImageAttachment,
  toolName?: string,
  toolCallId?: string,
  ts?: number,
): ReplLine {
  return {
    kind: 'image',
    id: newId(),
    turnId,
    ts: ts ?? Date.now(),
    image,
    toolName,
    toolCallId,
  };
}

export function makeDone(turnId: string, startTs: number, toolRounds: number): ReplLine {
  return {
    kind: 'done',
    id: newId(),
    turnId,
    ts: Date.now(),
    elapsedMs: Math.max(0, Date.now() - startTs),
    toolRounds,
  };
}

export function makeError(message: string, turnId?: string): ReplLine {
  return { kind: 'error', id: newId(), turnId, message, ts: Date.now() };
}

export function makeRestored(count: number): ReplLine {
  return { kind: 'restored', id: newId(), ts: Date.now(), count };
}

export function makeSysHint(text: string, tone?: 'dim' | 'warn' | 'error'): ReplLine {
  return { kind: 'sysHint', id: newId(), text, ts: Date.now(), tone };
}

export function startTurn(turnId: string): TurnMeta {
  return {
    turnId,
    startTs: Date.now(),
    toolRounds: 0,
    hasText: false,
    currentTextLineId: null,
  };
}
