/**
 * Backend API (EdgeOne Pages Functions — Python)
 *
 * Route mapping (file → route):
 *   agents/chat/index.py      → POST /chat          Main chat entry
 *   agents/chat/stop.py       → POST /chat/stop     Abort active agent run
 *   agents/history/index.py   → POST /history       Get conversation history
 *   agents/chat/_model.py     → (private, not mapped) LLM model config
 *   agents/chat/_session.py   → (private, not mapped) Session persistence
 *
 * This file centralizes all API paths and request wrappers.
 */

import type { Message } from './types';

export const API = {
  chat: '/chat',
  chatStop: '/chat/stop',
  history: '/history',
} as const;

export interface RawSseEvent {
  eventType: string;
  data: unknown;
  raw: string;
  timestamp: number;
}

export interface StreamCallbacks {
  onTextDelta: (delta: string) => void;
  onToolCalled: (toolName: string) => void;
  onImage: (base64: string) => void;
  onDone: () => void;
  onError: (err: Error) => void;
  onRawEvent?: (event: RawSseEvent) => void;
}

/**
 * Fetch conversation history from POST /history.
 * Used to restore the chat window after page refresh.
 *
 * The conversation_id is passed via the `makers-conversation-id` header,
 * which the EdgeOne runtime resolves into context.conversation_id on the backend.
 */
export async function fetchConversationHistory(conversationId: string): Promise<Message[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(API.history, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'makers-conversation-id': conversationId,
        },
        body: JSON.stringify({}),
      });

      // 409 = same conversation has an active request (React StrictMode double-render), retry
      if (res.status === 409) {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }

      if (!res.ok) return [];

      const data = await res.json().catch(() => null) as { messages?: Message[] } | null;
      return Array.isArray(data?.messages) ? data.messages : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Stream messages from POST /chat via SSE.
 * Backend pushes events: text_delta / tool_called / done / error / ping
 *
 * Returns an AbortController for the caller to cancel the request
 * (or pair with /chat/stop for graceful server-side abort).
 */
export function sendMessageStream(
  message: string,
  callbacks: StreamCallbacks,
  conversationId?: string,
): AbortController {
  const ctrl = new AbortController();

  (async () => {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (conversationId) {
        headers['makers-conversation-id'] = conversationId;
      }

      const res = await fetch(API.chat, {
        method: 'POST',
        headers,
        body: JSON.stringify({ message }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        callbacks.onError(new Error(`HTTP ${res.status}: ${await res.text().catch(() => '')}`));
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        callbacks.onError(new Error('ReadableStream not supported'));
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let doneReceived = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE format: each event is separated by \n\n
        const parts = buffer.split('\n\n');
        // Last segment may be incomplete — keep it in buffer
        buffer = parts.pop() || '';

        for (const part of parts) {
          if (!part.trim()) continue;
          dispatchSseChunk(part, callbacks, () => { doneReceived = true; });
        }
      }

      // Only trigger done as fallback if backend didn't send a done event
      if (!doneReceived) {
        callbacks.onDone();
      }
    } catch (err) {
      // AbortError should not trigger the error callback
      if (err instanceof DOMException && err.name === 'AbortError') return;
      callbacks.onError(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  return ctrl;
}

/** Parse a single SSE event and dispatch to the appropriate callback */
function dispatchSseChunk(part: string, cb: StreamCallbacks, markDone: () => void): void {
  let eventType = '';
  let data = '';

  for (const line of part.split('\n')) {
    if (line.startsWith('event: ')) {
      eventType = line.slice(7);
    } else if (line.startsWith('data: ')) {
      data = line.slice(6);
    }
  }

  if (!eventType || !data) return;

  try {
    const parsed = JSON.parse(data);

    if (cb.onRawEvent) {
      cb.onRawEvent({
        eventType,
        data: parsed,
        raw: data,
        timestamp: Date.now(),
      });
    }

    switch (eventType) {
      case 'text_delta':
        cb.onTextDelta(parsed.delta);
        break;
      case 'tool_called':
        cb.onToolCalled(parsed.tool);
        break;
      case 'image':
        if (parsed.base64) cb.onImage(parsed.base64);
        break;
      case 'error':
        cb.onError(new Error(parsed.message || 'agent returned error'));
        break;
      case 'done':
        markDone();
        cb.onDone();
        break;
    }
  } catch {
    if (cb.onRawEvent) {
      cb.onRawEvent({
        eventType,
        data: null,
        raw: data,
        timestamp: Date.now(),
      });
    }
  }
}

/**
 * Request the backend to abort the active agent run.
 * Maps to agents/chat/stop.py → POST /chat/stop
 *
 * IMPORTANT: The stop request must NOT carry the same
 * `makers-conversation-id` header as the chat request,
 * otherwise the runtime overwrites the chat's cancel signal.
 * The target conversation_id is passed only via body.
 */
export async function stopAgent(conversationId?: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(API.chatStop, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_id: conversationId }),
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
