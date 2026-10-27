// Open/close state for a header menu: a button that discloses a panel of
// links. Escape closes it and returns focus; a click outside closes it.
import { useCallback, useEffect, useId, useRef, useState } from 'react';

export default function useDisclosure() {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const button = useRef(null);
  const id = useId();
  const close = useCallback((focus) => {
    setOpen(false);
    if (focus) button.current?.focus();
  }, []);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') close(true); };
    const onPointer = (e) => { if (!root.current?.contains(e.target)) close(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open, close]);
  return {
    open, setOpen, close, root,
    buttonProps: { ref: button, type: 'button', 'aria-expanded': open, 'aria-controls': `${id}-panel`, onClick: () => setOpen((o) => !o) },
    panelProps: { id: `${id}-panel`, hidden: !open },
  };
}
