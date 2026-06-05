import { useEffect, useRef } from 'react';
import styles from './ImageLightbox.module.css';

interface Props {
  /** Open URL. When null, the lightbox is hidden. */
  url: string | null;
  alt: string;
  onClose: () => void;
}

/**
 * Minimal full-screen image viewer.
 *
 * Implementation notes:
 *  - Uses the native <dialog> element so we get focus trapping and the
 *    top-layer rendering for free, without dragging in a modal library.
 *  - Esc closes via the dialog's built-in cancel→close flow. We listen ONLY
 *    to `close` (not `cancel`) so onClose fires once: `cancel` fires first
 *    on Esc, the dialog auto-closes, then `close` fires; listening to both
 *    would double-call onClose.
 *  - Backdrop-click closes via an explicit handler on `.inner`, which fills
 *    the dialog's viewport. Clicks on the inner `<img>` stop propagation,
 *    so only clicks in the padded margin around the image trigger close.
 */
export default function ImageLightbox({ url, alt, onClose }: Props) {
  const ref = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (url) {
      if (!dlg.open) dlg.showModal();
    } else if (dlg.open) {
      dlg.close();
    }
  }, [url]);

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    // `close` covers both Esc (cancel→close) and programmatic dlg.close().
    const handler = () => onClose();
    dlg.addEventListener('close', handler);
    return () => {
      dlg.removeEventListener('close', handler);
    };
  }, [onClose]);

  return (
    <dialog ref={ref} className={styles.dialog}>
      {url && (
        <div
          className={styles.inner}
          // The padded area around the image is the click-to-close target.
          // The image's own onClick stops propagation below.
          onClick={onClose}
        >
          <img
            src={url}
            alt={alt}
            className={styles.full}
            draggable={false}
            onClick={e => e.stopPropagation()}
          />
          <button
            type="button"
            className={styles.close}
            onClick={e => {
              e.stopPropagation();
              onClose();
            }}
            aria-label="Close image preview"
          >
            ×
          </button>
        </div>
      )}
    </dialog>
  );
}
