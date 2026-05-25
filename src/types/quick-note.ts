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
