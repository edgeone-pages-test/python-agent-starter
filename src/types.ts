// ─── Legacy chat types (still used by /history adapter & SSE callback bridge) ──
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  activity?: {
    type: 'web_search';
    label: string;
    status: 'active' | 'done';
  };
}

export interface ToolLampState {
  id: string;
  label: string;
  icon: string;
  active: boolean;
  animKey: number;
}

// ─── Image (tool-output) types ───────────────────────────────────────────────
// SSE wire format: { event: 'image', data: ImageSsePayload }. Emitted between
// tool_debug{phase:'call'} and tool_debug{phase:'result'} for the same tool.
export interface ImageSsePayload {
  imageId: string;
  /** Raw base64, no `data:` prefix. */
  base64: string;
  mimeType: string;
  /** Approximate decoded byte size (server estimate; UI display only). */
  size: number;
  toolName?: string;
  toolCallId?: string;
}

// Runtime handle for an image attached to a ReplLine. We deliberately do NOT
// store the base64 string in React state — once the SSE event arrives we
// convert to a Blob, persist to IndexedDB, and keep only an object URL +
// the IDB key. This bounds memory use to the size of currently-mounted blobs.
export interface ImageAttachment {
  imageId: string;
  /** IDB primary key: `${conversationId}/${imageId}`. */
  storageKey: string;
  /** `blob:` URL for direct <img src=...>. Revoked on cleanup. */
  url: string;
  mimeType: string;
  size: number;
}

// ─── REPL line model ─────────────────────────────────────────────────────────
// Each REPL render row is one of these tagged variants. The render layer
// (`ReplLine.tsx`) switches on `kind` and never inspects fields it does not own.

export type ReplLine =
  | { kind: 'motd'; id: string }
  | { kind: 'user'; id: string; text: string; ts: number }
  | {
      kind: 'text';
      id: string;
      turnId: string;
      text: string;
      ts: number;
      /** True when this text line follows a tool call within the same turn,
       *  so the renderer can suppress the agent▸ prefix to avoid noise. */
      isContinuation?: boolean;
    }
  | {
      kind: 'tool';
      id: string;
      turnId: string;
      tool: string;
      ts: number;
      argsPreview?: string;
      durationMs?: number;
      resultSummary?: string;
    }
  | {
      // A separate row per image. We keep this independent (rather than
      // attaching to the tool row) for two reasons:
      //   1. SSE ordering means image events arrive AFTER the tool row has
      //      already been rendered — append-only is simpler than mutation.
      //   2. A single tool call can produce multiple images; one row per
      //      image gives each its own click target / lightbox affordance.
      kind: 'image';
      id: string;
      turnId: string;
      ts: number;
      image: ImageAttachment;
      /** Tool that produced this image. May be undefined for restored rows. */
      toolName?: string;
      toolCallId?: string;
    }
  | {
      kind: 'done';
      id: string;
      turnId: string;
      ts: number;
      elapsedMs: number;
      toolRounds: number;
    }
  | { kind: 'error'; id: string; turnId?: string; message: string; ts: number }
  | { kind: 'restored'; id: string; ts: number; count: number }
  | { kind: 'sysHint'; id: string; text: string; ts: number; tone?: 'dim' | 'warn' | 'error' };

export interface TurnMeta {
  turnId: string;
  startTs: number;
  toolRounds: number;
  /** True once at least one text_delta has been observed for this turn. */
  hasText: boolean;
  /** ID of the latest `text` line in `lines` for delta append, or null if next delta should create a new one. */
  currentTextLineId: string | null;
}
