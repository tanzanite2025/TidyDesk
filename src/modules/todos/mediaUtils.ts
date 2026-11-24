import type React from 'react';
import type { TodoAttachment } from '../../types/todo';

export const MAX_TODO_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const SUPPORTED_RASTER_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/bmp',
  'image/gif'
]);

export function isImageFile(file: File): boolean {
  const mime = (file.type || '').toLowerCase();
  if (mime === 'image/svg+xml' || /\.svg$/i.test(file.name)) return false;
  if (SUPPORTED_RASTER_MIME_TYPES.has(mime)) return true;
  return /\.(png|jpe?g|webp|bmp|gif)$/i.test(file.name);
}

export function isAttachmentFileOversized(file: File): boolean {
  return file.size > MAX_TODO_ATTACHMENT_BYTES;
}

export function formatBytes(sizeBytes?: number): string {
  if (!sizeBytes || sizeBytes <= 0) return '0 B';
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isAttachmentContainMode(att: TodoAttachment): boolean {
  return att.previewMode === 'contain';
}

export function attachmentImageStyle(att: TodoAttachment): React.CSSProperties {
  if (isAttachmentContainMode(att)) {
    return {};
  }
  const fx = typeof att.focalPoint?.x === 'number' ? att.focalPoint.x : 0.5;
  const fy =
    typeof att.focalPoint?.y === 'number'
      ? att.focalPoint.y
      : att.orientation === 'portrait'
        ? 0.36
        : 0.5;
  return {
    objectPosition: `${Math.round(fx * 100)}% ${Math.round(fy * 100)}%`
  };
}

export function formatOrientationLabel(att: TodoAttachment): string {
  if (att.orientation === 'portrait') return '竖图';
  if (att.orientation === 'square') return '方图';
  if (att.orientation === 'landscape') return '横图';
  if (att.height > att.width) return '竖图';
  if (att.width === att.height && att.width > 0) return '方图';
  return '横图';
}
