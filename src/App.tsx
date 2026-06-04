import { useState, useCallback, useEffect, useRef } from 'react';
import type { Message, ToolLampState } from './types';
import { fetchConversationHistory, sendMessageStream, stopAgent } from './api';
import type { RawSseEvent } from './api';
import { I18nProvider, LangToggle, useT, MessageKeys } from './i18n';
import ToolIndicators from './components/ToolIndicators';
import ChatWindow from './components/ChatWindow';
import ChatInput from './components/ChatInput';
import CodeViewer from './components/CodeViewer';
import TracePanel from './components/TracePanel';
import styles from './App.module.css';

const LAMP_IDS = ['commands', 'files', 'code_interpreter', 'browser'] as const;
type LampId = typeof LAMP_IDS[number];
const LAMP_ICONS: Record<string, string> = { commands: '⌨️', files: '📁', code_interpreter: '🐍', browser: '🌐' };
const LAMP_I18N_KEYS: Record<string, string> = { commands: 'tool.commands', files: 'tool.files', code_interpreter: 'tool.codeRunner', browser: 'tool.browser' };

/**
 * Map an EdgeOne platform tool name to a lamp group.
 *
 * The runtime exposes fine-grained tools (e.g. `browser_fetch`,
 * `browser_screenshot`, `files_read`, `commands_run`,
 * `code_interpreter_python`). The header only has 4 lamps, so we collapse
 * each family by prefix / keyword. Returns null for tools that don't belong
 * to any lamp group (e.g. `web_search`).
 */
function toolToLampId(toolName: string): LampId | null {
  const name = toolName.toLowerCase();
  if (name.startsWith('browser') || name.includes('browse')) return 'browser';
  if (name.startsWith('code_interpreter') || name.startsWith('code-interpreter') || name.startsWith('interpreter')) return 'code_interpreter';
  if (name.startsWith('files') || name.startsWith('file_') || name.startsWith('fs_')) return 'files';
  if (name.startsWith('commands') || name.startsWith('command_') || name.startsWith('cmd_') || name.startsWith('shell') || name === 'exec') return 'commands';
  // Fallback: exact match against canonical lamp ids
  if ((LAMP_IDS as readonly string[]).includes(name)) return name as LampId;
  return null;
}

const CONVERSATION_ID_STORAGE_KEY = 'eo_conversation_id';

/** Returns existing conversation ID from localStorage, or null if first visit */
function getExistingConversationId(): string | null {
  return localStorage.getItem(CONVERSATION_ID_STORAGE_KEY);
}

/** Returns existing or creates a new conversation ID */
function getOrCreateConversationId(): string {
  const cached = getExistingConversationId();
  if (cached) return cached;

  const conversationId = crypto.randomUUID();
  localStorage.setItem(CONVERSATION_ID_STORAGE_KEY, conversationId);
  return conversationId;
}

function isWebSearchToolEvent(event: RawSseEvent): boolean {
  if (event.eventType !== 'tool_called' || !event.data || typeof event.data !== 'object') {
    return false;
  }
  return (event.data as { tool?: unknown }).tool === 'web_search';
}

// Module-level dedup flag — outside React lifecycle, unaffected by StrictMode
let _historyFetchInFlight = false;

function AppInner() {
  const { t } = useT();

  const [messages, setMessages] = useState<Message[]>([]);
  const [lamps, setLamps] = useState<ToolLampState[]>(() =>
    LAMP_IDS.map(id => ({
      id,
      label: '',
      icon: LAMP_ICONS[id],
      active: false,
      animKey: 0,
    }))
  );
  const [loading, setLoading]   = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [traceEvents, setTraceEvents] = useState<RawSseEvent[]>([]);
  const [rightPanelMode, setRightPanelMode] = useState<'code' | 'trace'>('code');

  const botMsgIdRef = useRef<string>('');
  const abortCtrlRef = useRef<AbortController | null>(null);
  const conversationIdRef = useRef<string>(getOrCreateConversationId());
  const lampTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Update lamp labels when language changes
  useEffect(() => {
    setLamps(prev =>
      prev.map(l => ({
        ...l,
        label: t(LAMP_I18N_KEYS[l.id] as MessageKeys),
      }))
    );
  }, [t]);

  useEffect(() => {
    // First visit: no existing conversation → skip history fetch for instant load
    if (!getExistingConversationId()) {
      setHistoryLoading(false);
      return;
    }

    if (_historyFetchInFlight) return;
    _historyFetchInFlight = true;

    fetchConversationHistory(conversationIdRef.current).then(history => {
      if (history.length > 0) {
        setMessages(history);
      }
    }).finally(() => {
      _historyFetchInFlight = false;
      setHistoryLoading(false);
    });
  }, []);

  /** Update the current bot message's content via an updater function. */
  const updateBotMessage = useCallback((updater: (content: string) => string) => {
    setMessages(prev =>
      prev.map(m =>
        m.id === botMsgIdRef.current
          ? { ...m, content: updater(m.content) }
          : m
      )
    );
  }, []);

  const setBotActivity = useCallback((activity: Message['activity']) => {
    setMessages(prev =>
      prev.map(m =>
        m.id === botMsgIdRef.current
          ? { ...m, activity }
          : m
      )
    );
  }, []);

  const finishBotActivity = useCallback(() => {
    setMessages(prev => {
      let changed = false;
      const next = prev.map(m => {
        if (m.id === botMsgIdRef.current && m.activity?.status === 'active') {
          changed = true;
          return { ...m, activity: { ...m.activity, status: 'done' as const } };
        }
        return m;
      });
      return changed ? next : prev;
    });
  }, []);

  /** Clear the assistant message's `streaming` flag (hides the blinking caret). */
  const clearBotStreaming = useCallback(() => {
    setMessages(prev => {
      let changed = false;
      const next = prev.map(m => {
        if (m.id === botMsgIdRef.current && m.streaming) {
          changed = true;
          const { streaming, ...rest } = m;
          return rest;
        }
        return m;
      });
      return changed ? next : prev;
    });
  }, []);

  /** Append an image to the current bot message. */
  const appendBotImage = useCallback((base64: string) => {
    setMessages(prev =>
      prev.map(m =>
        m.id === botMsgIdRef.current
          ? { ...m, images: [...(m.images || []), base64] }
          : m
      )
    );
  }, []);

  const finishStream = useCallback(() => {
    setLoading(false);
    abortCtrlRef.current = null;
  }, []);

  const handleSend = useCallback(async (text: string) => {
    setRightPanelMode('trace');

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };

    const botMsgId = crypto.randomUUID();
    botMsgIdRef.current = botMsgId;
    const botMsg: Message = {
      id: botMsgId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      streaming: true,
    };

    setMessages(prev => [...prev, userMsg, botMsg]);
    setLoading(true);

    const ctrl = sendMessageStream(text, {
      onTextDelta(delta) {
        finishBotActivity();
        updateBotMessage(content => content + delta);
      },

      onToolCalled(toolName) {
        if (toolName === 'web_search') {
          setBotActivity({ type: 'web_search', label: 'Web searching...', status: 'active' });
        }

        const lampId = toolToLampId(toolName);
        if (!lampId) return;

        setLamps(prev =>
          prev.map(l =>
            l.id === lampId
              ? { ...l, active: true, animKey: l.animKey + 1 }
              : l
          )
        );
        // Clear any existing timer for this lamp before setting a new one
        const existingTimer = lampTimersRef.current.get(lampId);
        if (existingTimer !== undefined) clearTimeout(existingTimer);
        const timer = setTimeout(() => {
          setLamps(prev =>
            prev.map(l => (l.id === lampId ? { ...l, active: false } : l))
          );
          lampTimersRef.current.delete(lampId);
        }, 1000);
        lampTimersRef.current.set(lampId, timer);
      },

      onImage(base64) {
        finishBotActivity();
        appendBotImage(base64);
      },

      onRawEvent(event) {
        if (!isWebSearchToolEvent(event)) {
          finishBotActivity();
        }
        // Coalesce consecutive text_delta events into a single growing entry,
        // so a multi-paragraph response doesn't flood the trace panel with
        // hundreds of one-token rows.
        if (event.eventType === 'text_delta') {
          const delta = (event.data as { delta?: string } | null)?.delta ?? '';
          setTraceEvents(prev => {
            const last = prev[prev.length - 1];
            if (last && last.eventType === 'text_delta') {
              const prevDelta = (last.data as { delta?: string } | null)?.delta ?? '';
              const merged: RawSseEvent = {
                ...last,
                data: { delta: prevDelta + delta },
                raw: last.raw + delta,
                timestamp: event.timestamp,
              };
              return [...prev.slice(0, -1), merged];
            }
            return [...prev, event];
          });
          return;
        }
        setTraceEvents(prev => [...prev, event]);
      },

      onDone() {
        finishBotActivity();
        clearBotStreaming();
        finishStream();
      },

      onError() {
        finishBotActivity();
        clearBotStreaming();
        updateBotMessage(content => content || t('status.error'));
        finishStream();
      },
    }, conversationIdRef.current);

    abortCtrlRef.current = ctrl;
  }, [updateBotMessage, setBotActivity, finishBotActivity, clearBotStreaming, appendBotImage, finishStream, t]);

  const handleClearHistory = useCallback(() => {
    // Abort any in-flight stream before resetting state
    if (abortCtrlRef.current) {
      abortCtrlRef.current.abort();
      abortCtrlRef.current = null;
    }
    setLoading(false);
    localStorage.removeItem(CONVERSATION_ID_STORAGE_KEY);
    const newId = crypto.randomUUID();
    localStorage.setItem(CONVERSATION_ID_STORAGE_KEY, newId);
    conversationIdRef.current = newId;
    setMessages([]);
    setTraceEvents([]);
    setRightPanelMode('code');
  }, []);

  const handleStop = useCallback(() => {
    // 1. Immediately abort frontend SSE read
    if (abortCtrlRef.current) {
      abortCtrlRef.current.abort();
      abortCtrlRef.current = null;
    }

    // 2. Capture current botMsgId to prevent async callbacks updating wrong message
    const stoppedMsgId = botMsgIdRef.current;

    // 3. Optimistic UI: show stopped immediately without waiting for backend
    const stoppedText = t('status.stopped');
    finishBotActivity();
    updateBotMessage(content => content ? content + '\n\n' + stoppedText : stoppedText);
    setLoading(false);

    // 4. Backend abort async — notify user on failure (use captured ID, not current ref)
    stopAgent(conversationIdRef.current).then(ok => {
      if (!ok) {
        const errorText = t('status.backendError');
        setMessages(prev => prev.map(m =>
          m.id === stoppedMsgId
            ? { ...m, content: m.content + '\n\n' + errorText }
            : m
        ));
      }
    });
  }, [finishBotActivity, updateBotMessage, t]);

  return (
    <div className={styles.shell}>
      <div className={styles.blob1} />
      <div className={styles.blob2} />

      <div className={styles.stage}>
        <div className={styles.chatPanel}>
          <header className={styles.header}>
            <div className={styles.headerLeft}>
              <span className={styles.logo}>⬡</span>
              <div>
                <p className={styles.title}>{t('app.title')}</p>
                <p className={styles.subtitle}>{t('app.subtitle')}</p>
              </div>
            </div>
            <ToolIndicators lamps={lamps} />
          </header>

          <div className={styles.chatWindowShell}>
            <ChatWindow messages={messages} loading={loading} />
            {historyLoading && messages.length === 0 && (
              <div className={styles.historyOverlay}>
                <div className={styles.historySpinner} />
              </div>
            )}
          </div>
          <ChatInput onSend={handleSend} onStop={handleStop} onClear={handleClearHistory} disabled={loading} />
        </div>

        <div className={styles.codePanel}>
          {rightPanelMode === 'code' ? (
            <CodeViewer />
          ) : (
            <TracePanel events={traceEvents} onClear={() => setTraceEvents([])} />
          )}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <LangToggle />
      <AppInner />
    </I18nProvider>
  );
}
