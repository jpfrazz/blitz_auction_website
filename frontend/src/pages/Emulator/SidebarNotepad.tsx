import React, { useRef, useState } from 'react';
import NotesEditor from '../../shared/components/NotesEditor';
import NotesToolbar from '../../shared/components/NotesToolbar';
import { useUserNotes } from '../../shared/utils/userNotes';
import SortableSidebarSection from './SortableSidebarSection';
import './SidebarNotepad.scss';

interface SidebarNotepadProps {
  userId: string | null;
  isLast?: boolean;
}

// The embedded notepad shown beneath the player cards in the emulator sidebar.
// It shares the same store as the header "Notes" modal (see utils/userNotes), so
// notes typed here and notes typed via the N hotkey are one and the same.
const SidebarNotepad: React.FC<SidebarNotepadProps> = ({ userId, isLast }) => {
  const { notes, fontSize, setNotes, setFontSize } = useUserNotes(userId);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);

  return (
    <SortableSidebarSection
      id="notes"
      title="Notes"
      collapsed={isCollapsed}
      onToggleCollapsed={() => setIsCollapsed((prev) => !prev)}
      className="sidebar-notepad"
      isLast={isLast}
    >
      <NotesToolbar
        className="sidebar-notepad-toolbar"
        fontSize={fontSize}
        onFontSizeChange={setFontSize}
        editorRef={editorRef}
      />
      <div className="sidebar-notepad-content">
        <NotesEditor
          ref={editorRef}
          className="sidebar-notes-editor"
          notes={notes}
          fontSize={fontSize}
          onChange={setNotes}
        />
      </div>
    </SortableSidebarSection>
  );
};

export default SidebarNotepad;
