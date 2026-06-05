/**
 * Keyboard shortcut definitions for the REPL.
 *
 * The `ReplShell` registers a single `keydown` listener on `window` and
 * dispatches actions by name. The actual handlers live in `App.tsx` so they
 * can mutate React state.
 */
export type ReplAction =
  | 'abort'        // Ctrl+C while loading → handleStop
  | 'clearInput'   // Ctrl+C while idle    → clear input box
  | 'clearScreen'  // Ctrl+L                → drop visible lines
  | 'resetSession' // Ctrl+Shift+K          → new conversation_id
  | 'toggleVerbose'// Ctrl+T                → flip trace mode
  | 'showHelp';    // Ctrl+/                → render help motd

export interface KeyHit {
  ctrl: boolean;
  shift: boolean;
  meta: boolean;
  key: string;     // e.lowercase
}

export function classify(e: KeyboardEvent, loading: boolean): ReplAction | null {
  const ctrl = e.ctrlKey || e.metaKey; // treat Cmd as Ctrl on macOS for friendliness
  const shift = e.shiftKey;
  const key = e.key.toLowerCase();

  if (ctrl && !shift && key === 'c') return loading ? 'abort' : 'clearInput';
  if (ctrl && !shift && key === 'l') return 'clearScreen';
  if (ctrl && shift && key === 'k') return 'resetSession';
  if (ctrl && !shift && key === 't') return 'toggleVerbose';
  if (ctrl && !shift && key === '/') return 'showHelp';
  return null;
}
