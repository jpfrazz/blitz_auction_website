import React, { useRef } from 'react';
import './NotesToolbar.scss';

const FONT_SIZES = [14, 16, 18, 20, 24, 28, 32, 36, 40];

interface NotesToolbarProps {
  fontSize: number;
  onFontSizeChange: (size: number) => void;
  editorRef?: React.RefObject<HTMLDivElement | null>;
  className?: string;
}

// The B / I / U / color / font-size toolbar shared by the header "Notes" modal
// and the emulator sidebar notepad, so both notepads offer the same controls.
const NotesToolbar: React.FC<NotesToolbarProps> = ({
  fontSize,
  onFontSizeChange,
  editorRef,
  className,
}) => {
  const savedRangeRef = useRef<Range | null>(null);

  const exec = (command: string, value?: string) => {
    document.execCommand(command, false, value);
  };

  // Remember the editor selection while the native color picker steals focus, so
  // the chosen color applies to the text the user had selected. Only ranges that
  // live inside a contentEditable are kept.
  const captureSelection = () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    const node = range.commonAncestorContainer;
    const element = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
    if (!element || !element.closest('[contenteditable="true"]')) return;
    savedRangeRef.current = range.cloneRange();
  };

  const handleColorChange = (color: string) => {
    const editor = editorRef?.current;
    // execCommand only applies to the focused editing host, so re-focus the
    // editor and restore the selection before applying the color.
    editor?.focus();
    const selection = window.getSelection();
    const range = savedRangeRef.current;
    if (selection && range) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
    exec('foreColor', color);
  };

  return (
    <div className={className}>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => exec('bold')}
        title="Bold"
      >B</button>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => exec('italic')}
        title="Italic"
      >I</button>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => exec('underline')}
        title="Underline"
      >U</button>
      <input
        type="color"
        className="notes-color-input"
        title="Text color"
        defaultValue="#ffffff"
        onMouseDown={captureSelection}
        onFocus={captureSelection}
        onChange={(e) => handleColorChange(e.target.value)}
      />
      <select
        value={fontSize}
        onChange={(e) => onFontSizeChange(parseInt(e.target.value, 10))}
        title="Font Size"
      >
        {FONT_SIZES.map((size) => (
          <option key={size} value={size}>{size}px</option>
        ))}
      </select>
    </div>
  );
};

export default NotesToolbar;
