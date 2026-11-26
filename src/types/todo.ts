export interface TodoColumn {
  id: string;
  title: string;
}

export type TodoAttachmentKind = 'image' | 'video';
export type TodoAttachmentOrientation = 'portrait' | 'landscape' | 'square';
export type TodoAttachmentPreviewMode = 'cover' | 'contain';

export interface TodoAttachmentFocalPoint {
  x: number;
  y: number;
}

export interface TodoAttachment {
  id: string;
  kind: TodoAttachmentKind;
  originalName: string;
  fileName?: string;
  thumbFileName?: string;
  width: number;
  height: number;
  aspectRatio?: number;
  orientation?: TodoAttachmentOrientation;
  exifOrientation?: number;
  focalPoint?: TodoAttachmentFocalPoint;
  previewMode?: TodoAttachmentPreviewMode;
  sha256?: string;
  syncState?: 'local' | 'pending' | 'synced';
  remoteThumbKey?: string;
  remoteOriginalKey?: string;
  sizeBytes?: number;
  mimeType?: string;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string | null;
  assetUrl?: string;
  thumbUrl?: string;
}

export interface TodoSubtask {
  id: string;
  title: string;
  completed: boolean;
  position: string;
  attachments?: TodoAttachment[];
  attachmentCount?: number;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TodoSubtaskInput {
  id?: string;
  title: string;
  completed?: boolean;
  position?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface TodoBoard {
  id: string;
  title: string;
  columns: TodoColumn[];
  cardOrder: Record<string, string[]>;
  createdAt: string;
  updatedAt: string;
}

export const TODO_PRIORITY_VALUES = ['low', 'normal', 'high', 'urgent'] as const;

export type TodoPriority = (typeof TODO_PRIORITY_VALUES)[number];

export function normalizeTodoPriority(raw?: string | null): TodoPriority {
  const normalized = (raw || '').trim().toLowerCase();
  if (
    normalized === 'low' ||
    normalized === 'normal' ||
    normalized === 'high' ||
    normalized === 'urgent'
  ) {
    return normalized;
  }
  return 'normal';
}

export interface TodoCard {
  id: string;
  boardId: string;
  columnId: string;
  title: string;
  priority?: TodoPriority;
  summaryText?: string;
  content?: string;
  tags: string[];
  archived: boolean;
  subtasks?: TodoSubtask[];
  subtaskTotal?: number;
  subtaskCompleted?: number;
  previewAttachments?: TodoAttachment[];
  extraAttachmentCount?: number;
  attachments?: TodoAttachment[];
  attachmentCount?: number;
  commentCount?: number;
  unreadCommentCount?: number;
  unreadMentionCount?: number;
  coverAttachmentId?: string | null;
  position?: string;
  revision?: number;
  updatedBy?: string;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AccountSessionSnapshot {
  authMode: 'local' | 'account';
  activeUserId: string | null;
  displayName: string | null;
  serverEndpoint: string | null;
  workspaceId: string;
  hasToken: boolean;
  lastSyncCursor: string | null;
  lastSyncAt: string | null;
  syncEnabled: boolean;
  detachedUserId?: string | null;
  detachedWorkspaceId?: string | null;
}

export interface SwitchAccountSessionInput {
  userId: string;
  displayName?: string;
  serverEndpoint?: string;
  workspaceId?: string;
  token?: string;
}

export interface LoginWithPasswordInput {
  userId: string;
  password: string;
  serverEndpoint: string;
  workspaceId?: string;
  deviceLabel?: string;
}

export interface RegisterWithPasswordInput {
  userId: string;
  password: string;
  displayName?: string;
  serverEndpoint: string;
  deviceLabel?: string;
}

export interface WorkspaceInviteInfo {
  inviteCode: string;
  workspaceId: string;
  role: 'admin' | 'member' | 'viewer' | string;
  createdBy: string;
  maxUses: number;
  usedCount: number;
  expiresAt?: string | null;
  revokedAt?: string | null;
  createdAt: string;
}

export interface CreateWorkspaceInviteInput {
  workspaceId: string;
  role?: 'admin' | 'member' | 'viewer';
  maxUses?: number;
  expiresInHours?: number;
}

export interface ChangePasswordInput {
  oldPassword: string;
  newPassword: string;
  revokeAll?: boolean;
}

export interface RemoteAuthSessionInfo {
  tokenId: string;
  label: string;
  createdAt: string;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
  isCurrent: boolean;
}

export interface RemoteWorkspaceInfo {
  workspaceId: string;
  title: string;
  role: string;
  isPrivate: boolean;
}

export interface SyncStatusSnapshot {
  authMode: 'local' | 'account' | string;
  activeUserId: string | null;
  syncEnabled: boolean;
  serverEndpoint: string | null;
  workspaceId: string;
  pendingCount: number;
  lastSyncCursor: string | null;
  lastSyncAt: string | null;
  realtimeActive?: boolean;
  statusMessage: string;
}

export interface ImportLocalTodosResult {
  importedCards: number;
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
  priority?: TodoPriority;
  subtasks?: TodoSubtaskInput[];
}

export interface UpdateTodoCardInput {
  id: string;
  title?: string;
  content?: string;
  columnId?: string;
  priority?: TodoPriority;
  tags?: string[];
  archived?: boolean;
  subtasks?: TodoSubtaskInput[];
}

export interface MoveTodoCardInput {
  id: string;
  columnId: string;
  beforeId?: string;
}

export interface AddTodoAttachmentBytesInput {
  cardId: string;
  subtaskId?: string | null;
  fileName: string;
  bytes: number[];
}

export interface DeleteTodoAttachmentInput {
  cardId: string;
  subtaskId?: string | null;
  attachmentId: string;
}

export interface SetTodoCardCoverInput {
  cardId: string;
  attachmentId: string | null;
}

export interface UpdateTodoAttachmentMetaInput {
  cardId: string;
  subtaskId?: string | null;
  attachmentId: string;
  focalPoint?: TodoAttachmentFocalPoint;
  previewMode?: TodoAttachmentPreviewMode;
}

export interface PickTodoAttachmentResult {
  canceled: boolean;
  state?: TodoState;
}

export interface TodoCardComment {
  id: string;
  cardId: string;
  parentId?: string | null;
  authorId: string;
  authorName: string;
  body: string;
  mentions: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface AddTodoCommentInput {
  cardId: string;
  body: string;
  parentId?: string | null;
}

export interface DeleteTodoCommentInput {
  cardId: string;
  commentId: string;
}

export interface WorkspaceMemberInfo {
  userId: string;
  displayName: string;
  role: string;
}

export interface TodoUnreadCommentItem {
  cardId: string;
  cardTitle: string;
  unreadCount: number;
  mentionCount: number;
  latestCommentId: string;
  latestAuthorId: string;
  latestAuthorName: string;
  latestBodyPreview: string;
  latestCreatedAt: string;
}

export interface TodoUnreadCommentSummary {
  unreadTotal: number;
  mentionTotal: number;
  items: TodoUnreadCommentItem[];
}

export interface TodoCommentNotificationPayload {
  title: string;
  body: string;
  cardId: string;
  mentionCount: number;
  commentCount: number;
  unreadTotal: number;
  mentionTotal: number;
}
