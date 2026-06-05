import type { ReplLine } from '../../types';
import type { RawSseEvent } from '../../api';
import ReplLineRow, { ReplRawRow } from './ReplLine';
import PendingCaret from './PendingCaret';
import styles from './ReplStream.module.css';

interface Props {
  lines: ReplLine[];
  traceEvents: RawSseEvent[];
  verbose: boolean;
  /** True iff a turn is in flight AND no agent output has arrived yet. */
  showPending: boolean;
  onOpenImage?: (url: string, alt: string) => void;
}

/**
 * Render the REPL scroll content. Switches between:
 *   - normal mode: pretty `ReplLine[]` (+ optional pending caret tail)
 *   - verbose mode: raw SSE event log (one row per event)
 *
 * No virtualization yet — fine up to ~2000 rows on a modern laptop. If
 * users hit that, we'll bolt on `react-window` later.
 */
export default function ReplStream({ lines, traceEvents, verbose, showPending, onOpenImage }: Props) {
  if (verbose) {
    return (
      <div className={styles.stream}>
        {traceEvents.map((ev, i) => (
          <ReplRawRow key={`raw-${i}-${ev.timestamp}`} ev={ev} />
        ))}
      </div>
    );
  }

  return (
    <div className={styles.stream}>
      {lines.map(line => (
        <ReplLineRow key={line.id} line={line} onOpenImage={onOpenImage} />
      ))}
      {showPending && <PendingCaret />}
    </div>
  );
}
