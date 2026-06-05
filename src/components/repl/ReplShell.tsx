import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useT } from '../../i18n';
import { LangToggle } from '../../i18n';
import { classify } from './keymap';
import type { ReplAction } from './keymap';
import styles from './ReplShell.module.css';

interface Props {
  modelName: string;
  loading: boolean;
  historyLoading: boolean;
  historyHint?: string;
  onAction: (action: ReplAction) => void;
  bodyRef?: React.RefObject<HTMLDivElement>;
  children: ReactNode;
  footer: ReactNode;
}

/**
 * Top-level REPL frame:
 *   ┌── topbar (traffic-light + banner + lang toggle) ─┐
 *   │                                                  │
 *   │          scrollable body  (children)             │
 *   │                                                  │
 *   ├── footer (prompt) ───────────────────────────────┤
 *
 * Captures global keyboard shortcuts and forwards them via `onAction`.
 * The actual input element lives in `footer` (a ReplPrompt) so it owns
 * Enter / arrow keys; this component only intercepts Ctrl+* combos.
 */
export default function ReplShell({
  modelName,
  loading,
  historyLoading,
  historyHint,
  onAction,
  bodyRef,
  children,
  footer,
}: Props) {
  const { t } = useT();
  const internalBodyRef = useRef<HTMLDivElement>(null);
  const ref = bodyRef ?? internalBodyRef;

  // Auto-scroll to bottom whenever children update.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  });

  // Global key listener. Only fires when no <input>/<textarea> is focused
  // OR for combinations that are unambiguous terminal commands.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const action = classify(e, loading);
      if (!action) return;
      // Allow Ctrl+C to fire even from within input — it's the abort signal.
      // Other combos are blocked when typing inside non-prompt inputs (we have none).
      e.preventDefault();
      onAction(action);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [loading, onAction]);

  return (
    <div className={styles.shell}>
      <div className={styles.topbar}>
        <div className={styles.dots} aria-hidden="true">
          <span className={`${styles.dot} ${styles['dot--red']}`} />
          <span className={`${styles.dot} ${styles['dot--yellow']}`} />
          <span className={`${styles.dot} ${styles['dot--green']}`} />
        </div>
        <div className={styles.banner}>
          <span className={styles.bannerName}>agent-repl</span>
          <span className={styles.bannerSep}>─</span>
          <span className={styles.bannerModel}>python-starter@{modelName}</span>
        </div>
        <div className={styles.topbarRight}>
          <LangToggle />
        </div>
      </div>

      <div className={styles.body} ref={ref}>
        {children}
        {historyLoading && (
          <div className={styles.historyOverlay}>
            <span>{historyHint ?? t('repl.status.restoringFallback')}</span>
            <span className={styles.spinner}>▎</span>
          </div>
        )}
      </div>

      {footer}
    </div>
  );
}
