import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { useT } from '../../i18n';
import styles from './ReplPrompt.module.css';

interface Props {
  loading: boolean;
  onSubmit: (text: string) => void;
  onStop: () => void;
  /** Called by App when Ctrl+C in idle mode requests "clear input". */
  registerClearInput: (clear: () => void) => void;
  inputHistory: string[];
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export default function ReplPrompt({
  loading,
  onSubmit,
  onStop,
  registerClearInput,
  inputHistory,
}: Props) {
  const { t } = useT();
  const [value, setValue] = useState('');
  const [historyIdx, setHistoryIdx] = useState<number | null>(null);
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Expose a "clear input" handle to App for Ctrl+C behavior.
  useEffect(() => {
    registerClearInput(() => {
      setValue('');
      setHistoryIdx(null);
    });
  }, [registerClearInput]);

  // Auto-resize textarea up to max-height (CSS clamps further).
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }, [value]);

  // Auto-focus on mount and whenever loading flips false.
  useEffect(() => {
    if (!loading) taRef.current?.focus();
  }, [loading]);

  // Spinner animation while loading.
  useEffect(() => {
    if (!loading) return;
    const id = window.setInterval(() => {
      setSpinnerFrame(f => (f + 1) % SPINNER_FRAMES.length);
    }, 80);
    return () => window.clearInterval(id);
  }, [loading]);

  function commit() {
    const text = value.trim();
    if (!text || loading) return;
    onSubmit(text);
    setValue('');
    setHistoryIdx(null);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter without Shift → submit (same as Claude/ChatGPT convention)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      commit();
      return;
    }

    // History navigation only when caret is on first/last line
    if (e.key === 'ArrowUp' && inputHistory.length > 0) {
      const ta = taRef.current;
      if (!ta) return;
      const onFirstLine = ta.selectionStart <= (ta.value.indexOf('\n') === -1 ? ta.value.length : ta.value.indexOf('\n'));
      if (!onFirstLine) return;
      e.preventDefault();
      setHistoryIdx(idx => {
        const nextIdx = idx === null ? inputHistory.length - 1 : Math.max(0, idx - 1);
        setValue(inputHistory[nextIdx] ?? '');
        return nextIdx;
      });
      return;
    }
    if (e.key === 'ArrowDown' && historyIdx !== null) {
      e.preventDefault();
      setHistoryIdx(idx => {
        if (idx === null) return null;
        const nextIdx = idx + 1;
        if (nextIdx >= inputHistory.length) {
          setValue('');
          return null;
        }
        setValue(inputHistory[nextIdx] ?? '');
        return nextIdx;
      });
      return;
    }
  }

  function onChange(e: ChangeEvent<HTMLTextAreaElement>) {
    setValue(e.target.value);
    if (historyIdx !== null) setHistoryIdx(null);
  }

  const showCursor = !loading && value.length === 0;

  return (
    <div className={styles.prompt}>
      <span className={styles.prefix}>{t('repl.prompt.userLabel')}</span>
      <div className={styles.inputWrap}>
        <textarea
          ref={taRef}
          rows={1}
          className={styles.input}
          value={value}
          disabled={loading}
          onChange={onChange}
          onKeyDown={onKeyDown}
          placeholder={loading ? '' : t('repl.prompt.placeholder')}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
        />
        {showCursor && <span className={styles.cursor} aria-hidden="true" />}
      </div>
      <div className={`${styles.status} ${loading ? styles['status--running'] : ''}`}>
        {loading ? (
          <>
            <span className={styles.spinner}>{SPINNER_FRAMES[spinnerFrame]}</span>
            <span>{t('repl.status.running')}</span>
            <button type="button" className={styles.stopBtn} onClick={onStop}>
              ■ stop
            </button>
          </>
        ) : (
          <span>{t('repl.status.idle')}</span>
        )}
      </div>
    </div>
  );
}
