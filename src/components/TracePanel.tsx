import { useEffect, useRef } from 'react';
import type { RawSseEvent } from '../api';
import { useT } from '../i18n';
import styles from './TracePanel.module.css';

interface Props {
  events: RawSseEvent[];
  onClear: () => void;
}

const TYPE_CLASS_MAP: Record<string, string> = {
  text_delta: styles.type_text_delta,
  tool_called: styles.type_tool_called,
  tool_debug: styles.type_tool_debug,
  image: styles.type_image,
  done: styles.type_done,
  error: styles.type_error,
  ping: styles.type_ping,
  debug_msg: styles.type_debug_msg,
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

function formatData(data: unknown): string {
  if (data === null || data === undefined) return '';
  if (typeof data === 'string') return data;
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

export default function TracePanel({ events, onClear }: Props) {
  const { t } = useT();
  const bodyRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    const el = bodyRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [events.length]);

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.title}>{t('trace.title')}</span>
          {events.length > 0 && (
            <span className={styles.badge}>
              {events.length} {t('trace.events')}
            </span>
          )}
        </div>
        {events.length > 0 && (
          <button className={styles.clearBtn} onClick={onClear}>
            {t('trace.clear')}
          </button>
        )}
      </div>

      <div className={styles.body} ref={bodyRef}>
        {events.length === 0 ? (
          <div className={styles.empty}>
            <span className={styles.emptyTitle}>{t('trace.empty')}</span>
            <span className={styles.emptyHint}>{t('trace.emptyHint')}</span>
          </div>
        ) : (
          events.map((ev, i) => (
            <div className={styles.event} key={i}>
              <div className={styles.eventHeader}>
                <span className={`${styles.eventType} ${TYPE_CLASS_MAP[ev.eventType] || styles.type_unknown}`}>
                  {ev.eventType}
                </span>
                <span className={styles.eventTime}>{formatTime(ev.timestamp)}</span>
              </div>
              <div className={styles.eventBody}>{formatData(ev.data)}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
