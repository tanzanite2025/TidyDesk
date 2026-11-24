export interface QuickNote {
  id: string;
  title: string;
  content: string;
  pinned: boolean;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface QuickNotesState {
  notes: QuickNote[];
}

export interface CreateQuickNoteInput {
  title?: string;
  content?: string;
  pinned?: boolean;
  favorite?: boolean;
}

export interface UpdateQuickNoteInput {
  id: string;
  title?: string;
  content?: string;
  pinned?: boolean;
  favorite?: boolean;
}

export type StickyNoteColor = 'amber' | 'slate' | 'sky' | 'mint';

export interface StickyWindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StickyNoteRecord {
  noteId: string;
  bounds: StickyWindowBounds;
  alwaysOnTop: boolean;
  color: StickyNoteColor;
  updatedAt: string;
}

export interface StickyNotesState {
  stickies: StickyNoteRecord[];
}

export interface UpdateStickyNoteOptionsInput {
  noteId: string;
  alwaysOnTop?: boolean;
  color?: StickyNoteColor;
}
