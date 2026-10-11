import { useEffect, useSyncExternalStore } from 'react';

// Shared, per-user notes store. The header "Notes" modal (opened with the N
// hotkey) and the embedded notepad in the emulator sidebar both read and write
// through this module, so their contents stay identical. State lives in a
// module-level singleton (all components on a page share it automatically) and
// is persisted to the same localStorage keys the header modal has always used,
// which also keeps separate tabs in sync via the `storage` event.

export interface UserNotesState {
  notes: string;
  fontSize: number;
}

type Listener = () => void;

const DEFAULT_FONT_SIZE = 16;
const notesKey = (userId: string) => `user_notes_${userId}`;
const fontSizeKey = (userId: string) => `user_notes_font_size_${userId}`;
const EMPTY_STATE: UserNotesState = { notes: '', fontSize: DEFAULT_FONT_SIZE };

let currentUserId: string | null = null;
let state: UserNotesState = EMPTY_STATE;
const listeners = new Set<Listener>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

const emit = () => listeners.forEach((listener) => listener());

function readState(userId: string): UserNotesState {
  try {
    const notes = localStorage.getItem(notesKey(userId)) || '';
    const rawFontSize = localStorage.getItem(fontSizeKey(userId));
    const fontSize = rawFontSize ? parseInt(rawFontSize, 10) || DEFAULT_FONT_SIZE : DEFAULT_FONT_SIZE;
    return { notes, fontSize };
  } catch {
    return EMPTY_STATE;
  }
}

function flushSave(userId: string): void {
  try {
    localStorage.setItem(notesKey(userId), state.notes);
    localStorage.setItem(fontSizeKey(userId), String(state.fontSize));
  } catch {
    // Ignore quota / private-mode storage errors.
  }
}

function scheduleSave(): void {
  const userId = currentUserId;
  if (!userId) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flushSave(userId);
  }, 500);
}

// Binds the store to a user. Idempotent, so every hook instance can call it.
export function setUserNotesUser(userId: string | null): void {
  if (userId === currentUserId) return;
  currentUserId = userId;
  state = userId ? readState(userId) : EMPTY_STATE;
  emit();
}

export function getNotesState(): UserNotesState {
  return state;
}

export function subscribeNotes(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setNotes(notes: string): void {
  if (notes === state.notes) return;
  state = { ...state, notes };
  emit();
  scheduleSave();
}

export function setFontSize(fontSize: number): void {
  if (fontSize === state.fontSize) return;
  state = { ...state, fontSize };
  emit();
  scheduleSave();
}

export function useUserNotes(userId: string | null | undefined): {
  notes: string;
  fontSize: number;
  setNotes: (notes: string) => void;
  setFontSize: (fontSize: number) => void;
} {
  const resolvedId = userId ?? null;
  useEffect(() => {
    setUserNotesUser(resolvedId);
  }, [resolvedId]);

  const snapshot = useSyncExternalStore(subscribeNotes, getNotesState, getNotesState);
  return { notes: snapshot.notes, fontSize: snapshot.fontSize, setNotes, setFontSize };
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (!currentUserId) return;
    if (event.key === notesKey(currentUserId)) {
      state = { ...state, notes: event.newValue || '' };
      emit();
    } else if (event.key === fontSizeKey(currentUserId)) {
      const fontSize = event.newValue ? parseInt(event.newValue, 10) || DEFAULT_FONT_SIZE : DEFAULT_FONT_SIZE;
      state = { ...state, fontSize };
      emit();
    }
  });
}
