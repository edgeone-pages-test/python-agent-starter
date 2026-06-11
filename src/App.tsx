import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { ImageAttachment, ImageSsePayload, Message, ReplLine, TurnMeta } from './types';
import type { RawSseEvent } from './api';
import { fetchConversationHistory, sendMessageStream, stopAgent } from './api';
import { I18nProvider, useT } from './i18n';
import ReplShell from './components/repl/ReplShell';
import ReplStream from './components/repl/ReplStream';
import ReplPrompt from './components/repl/ReplPrompt';
import ImageLightbox from './components/ImageLightbox';
import GitHubLink from './components/GitHubLink';
import DeployLink from './components/DeployLink';
import {
  makeDone,
  makeError,
  makeImage,
  makeMotd,
  makeRestored,
  makeSysHint,
  makeText,
  makeTool,
  makeUser,
  startTurn,
} from './components/repl/lines';
import {
  base64ToBlob,
  createObjectUrl,
  deleteConversationImages,
  loadConversationImages,
  makeStorageKey,
  revokeAllObjectUrls,
  saveImage,
  type StoredImageRecord,
} from './lib/imageStore';
import type { ReplAction } from './components/repl/keymap';
import styles from './App.module.css';

const CONVERSATION_ID_STORAGE_KEY = 'eo_conversation_id';
const MODEL_BANNER = 'deepseek-v4-flash'; // visual only; matches default in agents/_model.py
const MAX_INPUT_HISTORY = 50;

function getExistingConversationId(): string | null {
  return localStorage.getItem(CONVERSATION_ID_STORAGE_KEY);
}

/**
 * Collapse contiguous runs of `text` ReplLines that share `turnId` into a
 * single `markdown` ReplLine. Tool / image / done / error / restored / etc.
 * lines are passthrough — they stay where they are and act as run boundaries.
 *
 * Used in onDone (and onError, on the rare path where the agent emitted
 * partial text before failing) to upgrade just-finished assistant text to
 * post-stream markdown rendering. Idempotent: lines already of kind
 * `markdown` are passthrough too, so calling this twice on the same array
 * is a no-op.
 */
function collapseTurnTextToMarkdown(lines: ReplLine[], turnId: string): ReplLine[] {
  const out: ReplLine[] = [];
  let buf: ReplLine[] = []; // accumulating contiguous `text` lines for `turnId`

  const flush = () => {
    if (buf.length === 0) return;
    const first = buf[0] as Extract<ReplLine, { kind: 'text' }>;
    const merged: ReplLine = {
      kind: 'markdown',
      // Reuse the FIRST text line's id/ts/isContinuation so React can keep
      // this row in place (no key churn) and the on-screen position
      // doesn't jump when we replace the run.
      id: first.id,
      turnId: first.turnId,
      ts: first.ts,
      isContinuation: first.isContinuation,
      text: buf.map(l => (l as Extract<ReplLine, { kind: 'text' }>).text).join(''),
    };
    out.push(merged);
    buf = [];
  };

  for (const line of lines) {
    if (line.kind === 'text' && line.turnId === turnId) {
      buf.push(line);
      continue;
    }
    flush();
    out.push(line);
  }
  flush();
  return out;
}

/** Map `Message[]` from /history into ReplLine[] (user / markdown). */
function historyToLines(history: Message[]): ReplLine[] {
  const out: ReplLine[] = [];
  for (const m of history) {
    if (!m.content && m.role === 'assistant') continue;
    if (m.role === 'user') {
      out.push({ kind: 'user', id: m.id, text: m.content, ts: m.timestamp });
    } else {
      // Restored assistant turns are emitted as `markdown` directly:
      // history has no streaming-chunk concept, the message is already
      // a complete blob, and we want it to render with the same
      // post-stream markdown affordances as a freshly-finished turn.
      out.push({
        kind: 'markdown',
        id: m.id,
        turnId: `restored-${m.id}`,
        text: m.content,
        ts: m.timestamp,
        // Restored assistant turns have no intermediate tool events,
        // so they always carry the agent▸ prefix.
        isContinuation: false,
      });
    }
  }
  return out;
}

/** Map IndexedDB image records into ReplLine.image variants. */
function imagesToLines(records: StoredImageRecord[]): ReplLine[] {
  return records.map(r => {
    const url = createObjectUrl(r.storageKey, r.blob);
    const attachment: ImageAttachment = {
      imageId:    r.imageId,
      storageKey: r.storageKey,
      url,
      mimeType:   r.mimeType,
      size:       r.size,
    };
    return makeImage(`restored-${r.messageId}`, attachment, r.toolName, r.toolCallId, r.createdAt);
  });
}

/** Stable merge of two ts-sorted line arrays. Keeps relative order within
 *  each list when timestamps tie — text lines first (history), images after. */
function mergeByTs(textLines: ReplLine[], imageLines: ReplLine[]): ReplLine[] {
  const out: ReplLine[] = [];
  let i = 0;
  let j = 0;
  while (i < textLines.length && j < imageLines.length) {
    const a = textLines[i];
    const b = imageLines[j];
    const ta = 'ts' in a ? a.ts : 0;
    const tb = 'ts' in b ? b.ts : 0;
    if (ta <= tb) {
      out.push(a);
      i++;
    } else {
      out.push(b);
      j++;
    }
  }
  while (i < textLines.length) out.push(textLines[i++]);
  while (j < imageLines.length) out.push(imageLines[j++]);
  return out;
}

function tplFill(s: string, vars: Record<string, string | number>): string {
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

// Module-level dedup flag — outside React lifecycle, unaffected by StrictMode
let _historyFetchInFlight = false;

function AppInner() {
  const { t } = useT();

  const [lines, setLines] = useState<ReplLine[]>(() => [makeMotd()]);
  const [traceEvents, setTraceEvents] = useState<RawSseEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [verbose, setVerbose] = useState(false);
  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [lightboxAlt, setLightboxAlt] = useState<string>('');
  // Set on send, cleared on first agent output / done / error / abort.
  // The pending caret in <ReplStream> is shown iff this is non-null.
  // Using a single piece of state instead of inserting+filtering a placeholder
  // row across 5 SSE handlers — see PendingCaret.tsx for the rationale.
  const [pendingTurnId, setPendingTurnId] = useState<string | null>(null);

  const turnMetaRef = useRef<TurnMeta | null>(null);
  const abortCtrlRef = useRef<AbortController | null>(null);
  // Capture both the cid AND whether it was generated this mount, BEFORE
  // any side effect can run. The history-load effect uses `wasFresh` to
  // skip the network round-trip on first visit (a brand-new cid can't
  // possibly have server history or stored images).
  const cidInit = useRef<{ cid: string; wasFresh: boolean }>(
    ((): { cid: string; wasFresh: boolean } => {
      const existing = getExistingConversationId();
      if (existing) return { cid: existing, wasFresh: false };
      const id = crypto.randomUUID();
      localStorage.setItem(CONVERSATION_ID_STORAGE_KEY, id);
      return { cid: id, wasFresh: true };
    })(),
  );
  const conversationIdRef = useRef<string>(cidInit.current.cid);
  const clearInputRef = useRef<() => void>(() => {});
  const verboseRef = useRef<boolean>(false);

  // Restore conversation history on mount (skip on first visit).
  useEffect(() => {
    if (cidInit.current.wasFresh || _historyFetchInFlight) {
      // Brand-new cid → no server messages, no IDB images. Skip the round-trip.
      setHistoryLoading(false);
      return;
    }
    _historyFetchInFlight = true;
    const cid = conversationIdRef.current;
    // Fetch text history (server) and image blobs (IndexedDB) in parallel —
    // they're independent stores, and the user shouldn't wait on one for the
    // other. They get merged by timestamp before rendering.
    Promise.all([
      fetchConversationHistory(cid),
      loadConversationImages(cid).catch(err => {
        // Treat IDB failures as non-fatal — user gets text without images.
        console.warn('[image-store] failed to load conversation images:', err);
        return [] as StoredImageRecord[];
      }),
    ])
      .then(([history, imageRecords]) => {
        if (history.length === 0 && imageRecords.length === 0) return;
        const textLines = historyToLines(history);
        const imageLines = imagesToLines(imageRecords);
        const merged = mergeByTs(textLines, imageLines);
        const marker = makeRestored(history.length);
        setLines(prev => [...prev, ...merged, marker]);
      })
      .finally(() => {
        _historyFetchInFlight = false;
        setHistoryLoading(false);
      });
    // We intentionally run only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Revoke all blob: URLs on unmount. We don't try to revoke URL-by-URL on
  // line removal — clearScreen / resetSession replace the lines array as a
  // whole, and the revokeAllObjectUrls() called there is the single source
  // of truth. This effect just covers the page-close / route-leave path.
  useEffect(() => {
    return () => {
      revokeAllObjectUrls();
    };
  }, []);

  // ─── SSE handlers (turn-scoped) ─────────────────────────────────────
  const finishStream = useCallback(() => {
    setLoading(false);
    // Hide the pending caret on every terminal path (done/error/abort).
    // Idempotent — safe to call when no turn was pending.
    setPendingTurnId(null);
    abortCtrlRef.current = null;
  }, []);

  const handleImage = useCallback((payload: ImageSsePayload) => {
    const cid = conversationIdRef.current;
    const meta = turnMetaRef.current;
    const turnId = meta?.turnId ?? 'orphan';

    let blob: Blob;
    try {
      blob = base64ToBlob(payload.base64, payload.mimeType);
    } catch (err) {
      // Corrupt base64 → no image, but the stream continues. Surface a hint
      // so the user knows something was dropped.
      console.warn('[image] base64 decode failed:', err);
      const hint = makeSysHint(`[image broken: ${payload.imageId.slice(0, 8)}]`, 'warn');
      setLines(prev => [...prev, hint]);
      return;
    }

    // CRITICAL: append the line SYNCHRONOUSLY, before any await. Multiple
    // image events arriving back-to-back (a tool that returned 5 screenshots)
    // each spawn an independent IDB readwrite transaction, and IndexedDB
    // does NOT guarantee resolution order across distinct transactions on the
    // same store. Appending after `await saveImage` would let images render
    // out of arrival order. The blob URL is created from the in-memory blob,
    // not from the IDB record, so we don't need persistence to land first.
    const storageKey = makeStorageKey(cid, payload.imageId);
    const url = createObjectUrl(storageKey, blob);
    const attachment: ImageAttachment = {
      imageId:    payload.imageId,
      storageKey,
      url,
      mimeType:   payload.mimeType,
      size:       payload.size || blob.size,
    };
    const imageLine = makeImage(turnId, attachment, payload.toolName, payload.toolCallId);
    setLines(prev => [...prev, imageLine]);

    // Fire-and-forget persist. Failure (quota, private mode, etc.) is not
    // fatal — the image stays visible for the current session via the blob
    // URL we just created.
    void saveImage({
      conversationId: cid,
      messageId:      turnId,
      imageId:        payload.imageId,
      blob,
      mimeType:       payload.mimeType,
      toolName:       payload.toolName,
      toolCallId:     payload.toolCallId,
    }).catch(err => {
      console.warn('[image] saveImage failed; rendering without persistence:', err);
    });
  }, []);

  const handleSend = useCallback(
    (text: string) => {
      if (loading) return;

      // Push user echo, kick the pending caret, then start a new turn.
      // Pending visibility is driven by `pendingTurnId` state — cleared on
      // first agent output (text_delta/tool_called/image), or on
      // done/error/abort. See PendingCaret.tsx for rationale.
      const turnId = crypto.randomUUID();
      setLines(prev => [...prev, makeUser(text)]);
      setInputHistory(prev => {
        const next = [...prev.filter(s => s !== text), text];
        return next.length > MAX_INPUT_HISTORY ? next.slice(-MAX_INPUT_HISTORY) : next;
      });

      turnMetaRef.current = startTurn(turnId);
      setPendingTurnId(turnId);
      setLoading(true);

      const ctrl = sendMessageStream(
        text,
        {
          onTextDelta: delta => {
            const meta = turnMetaRef.current;
            if (!meta) return;

            // CRITICAL: do NOT generate ids or mutate refs *inside* the
            // setLines updater. React 18 StrictMode invokes updaters twice
            // in dev; any side-effect (UUID generation, ref mutation) makes
            // the two calls disagree and React keeps only the second return.
            //
            // We decide the target line id BEFORE setLines, mutate the ref
            // at the same time, then run a pure updater.
            if (meta.currentTextLineId === null) {
              // Continuation = a text line that comes AFTER a tool call in the
              // same turn. The very first text line of the turn gets the
              // agent▸ prefix; later segments don't, to avoid visual noise.
              const isContinuation = meta.toolRounds > 0;
              const fresh = makeText(meta.turnId, '', isContinuation);
              meta.currentTextLineId = fresh.id;
              meta.hasText = true;
              setPendingTurnId(null);
              setLines(prev => [...prev, { ...fresh, text: delta }]);
            } else {
              const target = meta.currentTextLineId;
              meta.hasText = true;
              setLines(prev =>
                prev.map(l =>
                  l.kind === 'text' && l.id === target ? { ...l, text: l.text + delta } : l,
                ),
              );
            }
          },

          onToolCalled: toolName => {
            const meta = turnMetaRef.current;
            if (!meta) return;
            // Each tool call ends the current text line; the next text_delta
            // will start a fresh one.
            meta.currentTextLineId = null;
            meta.toolRounds += 1;
            // Build the line OUTSIDE the updater so its id is stable across
            // StrictMode's double invocation.
            const toolLine = makeTool(meta.turnId, toolName);
            setPendingTurnId(null);
            setLines(prev => [...prev, toolLine]);
          },

          onImage: payload => {
            handleImage(payload);
          },

          onRawEvent: ev => {
            // Coalesce consecutive text_delta events into a single growing entry,
            // so a multi-paragraph response doesn't flood the trace panel with
            // hundreds of one-token rows.
            if (ev.eventType === 'text_delta') {
              const delta = (ev.data as { delta?: string } | null)?.delta ?? '';
              setTraceEvents(prev => {
                const last = prev[prev.length - 1];
                if (last && last.eventType === 'text_delta') {
                  const prevDelta = (last.data as { delta?: string } | null)?.delta ?? '';
                  const merged: RawSseEvent = {
                    ...last,
                    data: { delta: prevDelta + delta },
                    raw: last.raw + delta,
                    timestamp: ev.timestamp,
                  };
                  return [...prev.slice(0, -1), merged];
                }
                return [...prev, ev];
              });
              return;
            }
            // Mirror to trace buffer for verbose mode.
            setTraceEvents(prev => [...prev, ev]);
          },

          onDone: () => {
            const meta = turnMetaRef.current;
            if (meta) {
              const doneLine = makeDone(meta.turnId, meta.startTs, meta.toolRounds);
              setLines(prev => [
                ...collapseTurnTextToMarkdown(prev, meta.turnId),
                doneLine,
              ]);
              turnMetaRef.current = null;
            }
            finishStream();
          },

          onError: err => {
            const meta = turnMetaRef.current;
            const errLine = makeError(err.message || t('status.error'), meta?.turnId);
            const padLine =
              meta && !meta.hasText ? makeText(meta.turnId, '', true) : null;
            setLines(prev => {
              // Even on error, collapse whatever text the model managed to
              // emit so the user sees rendered markdown rather than a
              // dangling streaming run alongside the error line.
              const collapsed = meta ? collapseTurnTextToMarkdown(prev, meta.turnId) : prev;
              return padLine ? [...collapsed, errLine, padLine] : [...collapsed, errLine];
            });
            if (meta) turnMetaRef.current = null;
            finishStream();
          },
        },
        conversationIdRef.current,
      );

      abortCtrlRef.current = ctrl;
    },
    [loading, t, finishStream, handleImage],
  );

  // ─── Action handlers (keyboard) ─────────────────────────────────────
  const handleStop = useCallback(() => {
    if (abortCtrlRef.current) {
      abortCtrlRef.current.abort();
      abortCtrlRef.current = null;
    }
    const meta = turnMetaRef.current;
    const abortLine = makeSysHint(t('repl.status.aborted'), 'warn');
    // Collapse any partial text the model emitted before abort so the row
    // settles into its final markdown form (matches onDone / onError).
    setLines(prev => {
      const collapsed = meta ? collapseTurnTextToMarkdown(prev, meta.turnId) : prev;
      return [...collapsed, abortLine];
    });
    setLoading(false);
    setPendingTurnId(null);

    stopAgent(conversationIdRef.current).then(ok => {
      const ackLine = makeSysHint(
        ok ? t('repl.status.stopOk') : t('repl.status.stopFail'),
        ok ? 'dim' : 'error',
      );
      setLines(prev => [...prev, ackLine]);
    });
    if (meta) turnMetaRef.current = null;
  }, [t]);

  const handleClearScreen = useCallback(() => {
    // Clearing the screen drops references to all currently-rendered image
    // rows, so revoke their blob URLs to release memory. The IDB records are
    // intentionally preserved — server history is preserved on /clear too.
    revokeAllObjectUrls();
    const motd = makeMotd();
    const hint = makeSysHint(t('repl.status.cleared'));
    setLines([motd, hint]);
  }, [t]);

  const handleResetSession = useCallback(() => {
    if (abortCtrlRef.current) {
      abortCtrlRef.current.abort();
      abortCtrlRef.current = null;
    }
    setLoading(false);
    const oldCid = conversationIdRef.current;
    localStorage.removeItem(CONVERSATION_ID_STORAGE_KEY);
    const newId = crypto.randomUUID();
    localStorage.setItem(CONVERSATION_ID_STORAGE_KEY, newId);
    conversationIdRef.current = newId;
    turnMetaRef.current = null;
    setTraceEvents([]);
    // Wipe any blob URLs first (synchronously) so we never render with a
    // dangling URL, then drop the IDB records for the abandoned session.
    revokeAllObjectUrls();
    void deleteConversationImages(oldCid).catch(err => {
      console.warn('[image-store] failed to delete old conversation images:', err);
    });
    const motd = makeMotd();
    const hint = makeSysHint(t('repl.status.reset'), 'warn');
    setLines([motd, hint]);
  }, [t]);

  const handleToggleVerbose = useCallback(() => {
    // Compute next value via ref to avoid nesting setLines inside a setVerbose
    // updater (which StrictMode invokes twice → would append the hint twice).
    const next = !verboseRef.current;
    verboseRef.current = next;
    setVerbose(next);
    const hint = makeSysHint(next ? t('repl.status.verboseOn') : t('repl.status.verboseOff'));
    setLines(prev => [...prev, hint]);
  }, [t]);

  const handleShowHelp = useCallback(() => {
    const h1 = makeSysHint(`— ${t('repl.help.title')} —`);
    const h2 = makeSysHint(t('repl.help.body'));
    setLines(prev => [...prev, h1, h2]);
  }, [t]);

  const handleOpenImage = useCallback((url: string, alt: string) => {
    setLightboxUrl(url);
    setLightboxAlt(alt);
  }, []);

  const handleCloseLightbox = useCallback(() => {
    setLightboxUrl(null);
  }, []);

  const onAction = useCallback(
    (action: ReplAction) => {
      switch (action) {
        case 'abort':
          handleStop();
          return;
        case 'clearInput':
          clearInputRef.current?.();
          return;
        case 'clearScreen':
          handleClearScreen();
          return;
        case 'resetSession':
          handleResetSession();
          return;
        case 'toggleVerbose':
          handleToggleVerbose();
          return;
        case 'showHelp':
          handleShowHelp();
          return;
      }
    },
    [handleStop, handleClearScreen, handleResetSession, handleToggleVerbose, handleShowHelp],
  );

  const registerClearInput = useCallback((fn: () => void) => {
    clearInputRef.current = fn;
  }, []);

  const historyHint = useMemo(() => {
    const id = conversationIdRef.current.slice(0, 8);
    return tplFill(t('repl.status.restoring'), { id, n: 0 });
  }, [t]);

  return (
    <div className={styles.app}>
      <ReplShell
        modelName={MODEL_BANNER}
        loading={loading}
        historyLoading={historyLoading}
        historyHint={historyHint}
        onAction={onAction}
        footer={
          <ReplPrompt
            loading={loading}
            onSubmit={handleSend}
            onStop={handleStop}
            registerClearInput={registerClearInput}
            inputHistory={inputHistory}
          />
        }
      >
        <ReplStream
          lines={lines}
          traceEvents={traceEvents}
          verbose={verbose}
          showPending={pendingTurnId !== null}
          onOpenImage={handleOpenImage}
        />
      </ReplShell>
      <ImageLightbox url={lightboxUrl} alt={lightboxAlt} onClose={handleCloseLightbox} />
    </div>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <AppInner />
      <GitHubLink />
      <DeployLink />
    </I18nProvider>
  );
}
