import { useEffect, useRef } from 'react';
import type { Message } from '../types';
import { useT } from '../i18n';
import ChatBubble from './ChatBubble';
import styles from './ChatWindow.module.css';

interface Props {
  messages: Message[];
  loading: boolean;
}

export default function ChatWindow({ messages, loading }: Props) {
  const { t } = useT();
  const windowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messages.length === 0 && !loading) return;
    const el = windowRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [messages, loading]);

  const lastMsg = messages[messages.length - 1];
  const showTypingIndicator = loading && !(lastMsg?.role === 'assistant' && lastMsg.content.length > 0);

  return (
    <div ref={windowRef} className={styles.window}>
      {messages.length === 0 && (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>⬡</span>
          <p className={styles.emptyTitle}>{t("empty.title")}</p>
          <p className={styles.emptyHint}>
            {t("empty.hint")}
          </p>
          <p className={styles.emptyFeatures}>
            {t("empty.features")}
          </p>
        </div>
      )}

      {messages.map(msg => (
        <ChatBubble key={msg.id} message={msg} />
      ))}

      {showTypingIndicator && (
        <div className={styles.typingRow}>
          <div className={styles.avatar}>⬡</div>
          <div className={styles.typing}>
            <span />
            <span />
            <span />
          </div>
        </div>
      )}
    </div>
  );
}
