import React, { useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message } from '../types';
import styles from './ChatBubble.module.css';

interface Props {
  message: Message;
}

const TABLE_ROW_BOUNDARY = /\|\s+\|/g;
const TABLE_SEPARATOR_ROW = /^\|\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;

function normalizeCompactTableLine(line: string): string {
  if (!line.includes('| |')) return line;

  const pipeIndexes = [...line.matchAll(/\|/g)]
    .map((match) => match.index ?? -1)
    .filter((index) => index >= 0);

  for (const index of pipeIndexes) {
    const table = line.slice(index);
    const normalizedTable = table.replace(TABLE_ROW_BOUNDARY, '|\n|');
    const rows = normalizedTable
      .split('\n')
      .map((row) => row.trim())
      .filter(Boolean);

    if (rows.length >= 2 && TABLE_SEPARATOR_ROW.test(rows[1])) {
      const prefix = line.slice(0, index).trimEnd();
      return prefix ? `${prefix}\n${normalizedTable}` : normalizedTable;
    }
  }

  return line;
}

function normalizeMarkdown(content: string): string {
  let inCodeFence = false;

  return content
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inCodeFence = !inCodeFence;
        return line;
      }

      return inCodeFence ? line : normalizeCompactTableLine(line);
    })
    .join('\n');
}

export default React.memo(function ChatBubble({ message }: Props) {
  const isUser = message.role === 'user';
  const content = useMemo(
    () => (isUser ? message.content : normalizeMarkdown(message.content)),
    [message.content, isUser],
  );
  const images = message.images || [];
  const activity = message.activity;

  if (!isUser && !message.content && images.length === 0 && !activity) return null;

  return (
    <div className={`${styles.row} ${isUser ? styles.userRow : styles.botRow}`}>
      {!isUser && <div className={styles.avatar}>⬡</div>}
      <div className={`${styles.bubble} ${isUser ? styles.userBubble : styles.botBubble}`}>
        {!isUser && activity?.type === 'web_search' && (
          <div
            className={`${styles.webSearchActivity} ${activity.status === 'done' ? styles.webSearchDone : styles.webSearchActive}`}
            role="status"
            aria-live="polite"
          >
            <span className={styles.searchGlyph} aria-hidden="true" />
            <span className={styles.searchLabel}>{activity.label}</span>
            <span className={styles.searchDots} aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </div>
        )}
        {isUser
          ? content
          : content && <div className={styles.markdown}><Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown></div>
        }
        {images.length > 0 && (
          <div className={styles.imageList}>
            {images.map((base64, idx) => (
              <img
                key={idx}
                className={styles.image}
                src={`data:image/png;base64,${base64}`}
                alt={`tool result ${idx + 1}`}
              />
            ))}
          </div>
        )}
        <span className={styles.time}>
          {new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      {isUser && <div className={`${styles.avatar} ${styles.userAvatar}`}>U</div>}
    </div>
  );
});
