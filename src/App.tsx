import { useState, useCallback, useEffect, useRef } from 'react';
import type { Message, ToolLampState } from './types';
import { fetchConversationHistory, sendMessageStream, stopAgent } from './api';
import { I18nProvider, LangToggle, useT, MessageKeys } from './i18n';
import ToolIndicators from './components/ToolIndicators';
import ChatWindow from './components/ChatWindow';
import ChatInput from './components/ChatInput';
import CodeViewer from './components/CodeViewer';
import styles from './App.module.css';

const LAMP_IDS = ['commands', 'files', 'code_interpreter', 'browser'] as const;
const LAMP_ICONS: Record<string, string> = { commands: '⌨️', files: '📁', code_interpreter: '🐍', browser: '🌐' };
const LAMP_I18N_KEYS: Record<string, string> = { commands: 'tool.commands', files: 'tool.files', code_interpreter: 'tool.codeRunner', browser: 'tool.browser' };

const CONVERSATION_ID_STORAGE_KEY = 'eo_conversation_id';

function getOrCreateConversationId(): string {
  const cached = localStorage.getItem(CONVERSATION_ID_STORAGE_KEY);
  if (cached) return cached;

  const conversationId = crypto.randomUUID();
  localStorage.setItem(CONVERSATION_ID_STORAGE_KEY, conversationId);
  return conversationId;
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
    };

    setMessages(prev => [...prev, userMsg, botMsg]);
    setLoading(true);

    const ctrl = sendMessageStream(text, {
      onTextDelta(delta) {
        updateBotMessage(content => content + delta);
      },

      onToolCalled(toolName) {
        setLamps(prev =>
          prev.map(l =>
            l.id === toolName
              ? { ...l, active: true, animKey: l.animKey + 1 }
              : l
          )
        );
        // Clear any existing timer for this tool before setting a new one
        const existingTimer = lampTimersRef.current.get(toolName);
        if (existingTimer !== undefined) clearTimeout(existingTimer);
        const timer = setTimeout(() => {
          setLamps(prev =>
            prev.map(l => (l.id === toolName ? { ...l, active: false } : l))
          );
          lampTimersRef.current.delete(toolName);
        }, 1000);
        lampTimersRef.current.set(toolName, timer);
      },

      onImage(base64) {
        appendBotImage(base64);
      },

      onDone: finishStream,

      onError() {
        updateBotMessage(content => content || t('status.error'));
        finishStream();
      },
    }, conversationIdRef.current);

    abortCtrlRef.current = ctrl;
  }, [updateBotMessage, appendBotImage, finishStream, t]);

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
  }, [updateBotMessage, t]);

  return (
    <div className={styles.shell}>
      <div className={styles.blob1} />
      <div className={styles.blob2} />

      <div className={styles.stage}>
        <div className={styles.chatPanel}>
          {historyLoading && messages.length === 0 && (
            <div className={styles.historyOverlay}>
              <div className={styles.historySpinner} />
            </div>
          )}
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

          <ChatWindow messages={messages} loading={loading} />
          <ChatInput onSend={handleSend} onStop={handleStop} onClear={handleClearHistory} disabled={loading} />
        </div>

        <div className={styles.codePanel}>
          <CodeViewer />
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
