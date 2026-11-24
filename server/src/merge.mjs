/**
 * Deterministic member-level CRDT-inspired merge helpers for TODO cards,
 * subtasks, and attachments so concurrent edits on desktop & mobile preserve work cleanly.
 */

function toEpochMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const asNum = Number(value);
    if (Number.isFinite(asNum) && asNum > 0) return asNum;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export function mergeMembersById(existingList = [], incomingList = []) {
  const byId = new Map();
  const order = [];

  for (const item of existingList) {
    if (!item || typeof item.id !== 'string' || !item.id) continue;
    byId.set(item.id, structuredClone(item));
    order.push(item.id);
  }

  for (const incoming of incomingList) {
    if (!incoming || typeof incoming.id !== 'string' || !incoming.id) continue;
    const existing = byId.get(incoming.id);
    if (!existing) {
      byId.set(incoming.id, structuredClone(incoming));
      order.push(incoming.id);
      continue;
    }

    const existingTs = Math.max(toEpochMs(existing.updatedAt), toEpochMs(existing.deletedAt));
    const incomingTs = Math.max(toEpochMs(incoming.updatedAt), toEpochMs(incoming.deletedAt));
    const mergedAttachments =
      Array.isArray(existing.attachments) || Array.isArray(incoming.attachments)
        ? mergeMembersById(existing.attachments || [], incoming.attachments || [])
        : undefined;

    if (incomingTs >= existingTs) {
      const next = structuredClone(incoming);
      if (mergedAttachments) next.attachments = mergedAttachments;
      if (existing.deletedAt && !next.deletedAt && toEpochMs(existing.deletedAt) >= incomingTs) {
        next.deletedAt = existing.deletedAt;
      }
      byId.set(incoming.id, next);
    } else if (mergedAttachments) {
      existing.attachments = mergedAttachments;
      byId.set(incoming.id, existing);
    }
  }

  return order.map(id => byId.get(id)).filter(Boolean);
}

export function mergeCardOnServer(existing, incoming, actorId) {
  const now = String(Date.now());
  if (!existing) {
    const created = structuredClone(incoming);
    created.revision = Math.max(1, Number(created.revision) || 1);
    created.updatedBy = actorId;
    created.updatedAt = created.updatedAt || now;
    delete created.baseRevision;
    return { card: created, conflict: null };
  }

  const baseRev = Number(incoming.baseRevision ?? incoming.revision ?? 0);
  const currentRev = Math.max(1, Number(existing.revision) || 1);
  const hasDiverged = baseRev > 0 && baseRev < currentRev;

  const mergedSubtasks = mergeMembersById(existing.subtasks || [], incoming.subtasks || []);
  const mergedAttachments = mergeMembersById(
    existing.attachments || [],
    incoming.attachments || []
  );

  // Respect deletion tombstone cleanly
  if (incoming.deletedAt) {
    const deleted = {
      ...structuredClone(existing),
      deletedAt: incoming.deletedAt,
      attachments: [],
      subtasks: [],
      coverAttachmentId: null,
      content: '',
      revision: currentRev + 1,
      updatedBy: actorId,
      updatedAt: now
    };
    return { card: deleted, conflict: null };
  }

  if (existing.deletedAt && !incoming.deletedAt) {
    if (toEpochMs(existing.updatedAt) > toEpochMs(incoming.updatedAt)) {
      return {
        card: existing,
        conflict: { entityId: existing.id, reason: 'remote_deleted', serverRevision: currentRev }
      };
    }
  }

  const incomingTs = toEpochMs(incoming.updatedAt);
  const existingTs = toEpochMs(existing.updatedAt);
  const incomingIsNewer = incomingTs >= existingTs;

  let mergedContent = incomingIsNewer
    ? incoming.content ?? existing.content ?? ''
    : existing.content ?? incoming.content ?? '';
  let conflict = null;

  if (
    hasDiverged &&
    typeof existing.content === 'string' &&
    typeof incoming.content === 'string' &&
    existing.content.trim() !== incoming.content.trim() &&
    existing.content.trim() !== '' &&
    incoming.content.trim() !== ''
  ) {
    const primary = incomingIsNewer ? incoming.content : existing.content;
    const secondary = incomingIsNewer ? existing.content : incoming.content;
    if (!primary.includes(secondary)) {
      mergedContent = `${primary}\n\n---\n> [多端并发冲突保留副本]\n${secondary}`;
      conflict = {
        entityId: existing.id,
        reason: 'content_concurrent_edit',
        serverRevision: currentRev + 1
      };
    }
  }

  const next = {
    ...structuredClone(incomingIsNewer ? existing : incoming),
    ...structuredClone(incomingIsNewer ? incoming : existing),
    id: existing.id,
    content: mergedContent,
    subtasks: mergedSubtasks,
    attachments: mergedAttachments,
    revision: currentRev + 1,
    updatedBy: actorId,
    updatedAt: now,
    deletedAt: null
  };
  delete next.baseRevision;

  return { card: next, conflict };
}
