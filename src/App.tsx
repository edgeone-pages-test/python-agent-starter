import { useState, useCallback, useEffect, useRef } from 'react';
import type { Message, ToolLampState } from './types';
import { fetchConversationHistory, sendMessageStream, stopAgent } from './api';
import ToolIndicators from './components/ToolIndicators';
import ChatWindow from './components/ChatWindow';
import ChatInput from './components/ChatInput';
import CodeViewer from './components/CodeViewer';
import styles from './App.module.css';

const INITIAL_LAMPS: ToolLampState[] = [
  { id: 'commands',         label: '终端命令', icon: '⌨️', active: false, animKey: 0 },
  { id: 'files',            label: '文件操作', icon: '📁', active: false, animKey: 0 },
  { id: 'code_interpreter', label: '代码执行', icon: '🐍', active: false, animKey: 0 },
  { id: 'browser',          label: '浏览器',   icon: '🌐', active: false, animKey: 0 },
];

const CONVERSATION_ID_STORAGE_KEY = 'eo_conversation_id';

function getOrCreateConversationId(): string {
  const cached = localStorage.getItem(CONVERSATION_ID_STORAGE_KEY);
  if (cached) return cached;

  const conversationId = crypto.randomUUID();
  localStorage.setItem(CONVERSATION_ID_STORAGE_KEY, conversationId);
  return conversationId;
}

// ✅ 模块级去重标记 —— 脱离 React 生命周期，StrictMode 无法干扰
let _historyFetchInFlight = false;

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [lamps, setLamps]       = useState<ToolLampState[]>(INITIAL_LAMPS);
  const [loading, setLoading]   = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);

  const botMsgIdRef = useRef<string>('');
  const abortCtrlRef = useRef<AbortController | null>(null);
  const conversationIdRef = useRef<string>(getOrCreateConversationId());
  const lampTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

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
        updateBotMessage(content => content || '⚠️ 请求失败，请检查后端服务是否启动。');
        finishStream();
      },
    }, conversationIdRef.current);

    abortCtrlRef.current = ctrl;
  }, [updateBotMessage, appendBotImage, finishStream]);

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
    // 1. 立即中断前端 SSE 读取
    if (abortCtrlRef.current) {
      abortCtrlRef.current.abort();
      abortCtrlRef.current = null;
    }

    // 2. 捕获当前 botMsgId，防止异步回调更新到错误的消息
    const stoppedMsgId = botMsgIdRef.current;

    // 3. 前端立即显示已中断（乐观 UI，不等后端）
    updateBotMessage(content => content ? content + '\n\n⏹ *已停止生成*' : '⏹ *已停止生成*');
    setLoading(false);

    // 4. 后端异步执行中断，失败时提示用户（使用捕获的 ID 而非当前 ref）
    stopAgent(conversationIdRef.current).then(ok => {
      if (!ok) {
        setMessages(prev => prev.map(m =>
          m.id === stoppedMsgId
            ? { ...m, content: m.content + '\n\n⚠️ 后端中断请求失败，服务端可能仍在运行。' }
            : m
        ));
      }
    });
  }, [updateBotMessage]);

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
                <p className={styles.title}>Agent Chat</p>
                <p className={styles.subtitle}>运行在 EdgeOne Pages 上，支持会话记忆、沙箱工具调用</p>
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
