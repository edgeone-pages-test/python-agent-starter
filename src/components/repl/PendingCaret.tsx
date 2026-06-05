import { useT } from '../../i18n';
import styles from './ReplLine.module.css';

/**
 * "Agent is alive" indicator shown between user submit and the first agent
 * output (text_delta / tool_called / image) of a turn.
 *
 * Visibility is driven entirely by the parent (`<ReplStream>` reads turn
 * state and decides whether to render this). We deliberately do NOT model
 * this as a `ReplLine` variant — the lifecycle ("show until first output,
 * then never again this turn") is a property of the active turn, not of
 * the lines array. Putting it in the array forced five SSE handlers to
 * each remember to filter out the placeholder; this component costs zero
 * such bookkeeping.
 *
 * The caret block itself is a CSS-painted inline-block (see
 * `.pendingCaret` in `ReplLine.module.css`) — not the `▮` glyph, since
 * different monospace fonts render that glyph at wildly different heights.
 */
export default function PendingCaret() {
  const { t } = useT();
  return (
    <div className={`${styles.line} ${styles.text}`} aria-live="polite">
      <span className={styles.agentPrompt}>{t('repl.prompt.agentLabel')}</span>
      <span className={styles.pendingCaret} aria-hidden />
      <span className={styles.srOnly}>{t('repl.status.thinking')}</span>
    </div>
  );
}
