import React, { forwardRef, useCallback, useEffect, useRef } from 'react';

interface NotesEditorProps {
  notes: string;
  fontSize: number;
  onChange: (html: string) => void;
  className?: string;
}

// The rich-text (contentEditable) surface shared by the header "Notes" modal and
// the emulator sidebar notepad. Keeping it in one component keeps both surfaces
// identical and keeps their contents in sync: when the `notes` prop changes from
// elsewhere the DOM is updated unless this instance currently has focus.
const NotesEditor = forwardRef<HTMLDivElement, NotesEditorProps>(
  ({ notes, fontSize, onChange, className }, forwardedRef) => {
    const innerRef = useRef<HTMLDivElement>(null);

    const setRefs = useCallback(
      (el: HTMLDivElement | null) => {
        innerRef.current = el;
        if (typeof forwardedRef === 'function') forwardedRef(el);
        else if (forwardedRef) {
          (forwardedRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
        }
      },
      [forwardedRef]
    );

    useEffect(() => {
      const el = innerRef.current;
      if (!el) return;
      if (document.activeElement === el) return;
      if (el.innerHTML !== notes) {
        el.innerHTML = notes;
      }
    }, [notes]);

    return (
      <div
        ref={setRefs}
        className={className}
        contentEditable
        suppressContentEditableWarning
        onInput={(e) => onChange(e.currentTarget.innerHTML)}
        onKeyDown={(e) => {
          // Stop propagation so page-level spacebar/hotkey listeners don't trigger.
          e.stopPropagation();
        }}
        style={{ fontSize: `${fontSize}px` }}
      />
    );
  }
);

export default NotesEditor;
