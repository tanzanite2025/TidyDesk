export interface TodoColumn {
  id: string;
  title: string;
}

export interface TodoBoard {
  id: string;
  title: string;
  columns: TodoColumn[];
  cardOrder: Record<string, string[]>;
  createdAt: string;
  updatedAt: string;
}

export interface TodoCard {
  id: string;
  boardId: string;
  columnId: string;
  title: string;
  content: string;
  tags: string[];
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TodoCounts {
  total: number;
  open: number;
  done: number;
}

export interface TodoState {
  activeBoardId: string;
  boards: TodoBoard[];
  cards: TodoCard[];
  counts: TodoCounts;
}

export interface CreateTodoCardInput {
  title?: string;
  content?: string;
  columnId?: string;
}

export interface UpdateTodoCardInput {
  id: string;
  title?: string;
  content?: string;
  columnId?: string;
  tags?: string[];
  archived?: boolean;
}

export interface MoveTodoCardInput {
  id: string;
  columnId: string;
  beforeId?: string;
}
