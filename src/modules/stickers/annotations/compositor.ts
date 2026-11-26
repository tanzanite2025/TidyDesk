import {
  logicalRectToPhysical,
  type SnipRect,
  type SnipViewportSize
} from '../snipGeometry';
import { renderAnnotationsLayer } from './renderer';
import type { AnnotationOp } from './types';

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Encode arbitrary binary PNG buffers to base64 without JSON array bloat or call-stack limits. */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    parts.push(String.fromCharCode(...slice));
  }
  return btoa(parts.join(''));
}

/** Load an offscreen HTMLImageElement from URL with explicit failure on load errors. */
export function loadBackdropImageElement(imageUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (img.naturalWidth <= 0 || img.naturalHeight <= 0) {
        reject(new Error('[CRITICAL] Loaded screenshot backdrop has zero physical dimensions'));
        return;
      }
      resolve(img);
    };
    img.onerror = () => {
      reject(new Error(`[CRITICAL] Failed to decode screenshot backdrop from ${imageUrl}`));
    };
    img.src = imageUrl;
  });
}

function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async blob => {
      if (!blob || blob.size === 0) {
        reject(new Error('[CRITICAL] Offscreen compositor returned empty PNG blob'));
        return;
      }
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      if (
        bytes.length < PNG_MAGIC.length ||
        !PNG_MAGIC.every((byte, index) => bytes[index] === byte)
      ) {
        reject(new Error('[CRITICAL] Offscreen compositor emitted invalid PNG signature'));
        return;
      }
      resolve(bytes);
    }, 'image/png');
  });
}

/**
 * Composite cropped physical monitor backdrop and non-destructive vector/mosaic annotations
 * into a lossless PNG byte buffer at native display resolution.
 */
export async function exportAnnotatedSelectionPng(params: {
  backdropImage: HTMLImageElement;
  selection: SnipRect;
  viewport: SnipViewportSize;
  ops: readonly AnnotationOp[];
}): Promise<Uint8Array> {
  const { backdropImage, selection, viewport, ops } = params;
  const imgW = backdropImage.naturalWidth || backdropImage.width;
  const imgH = backdropImage.naturalHeight || backdropImage.height;
  if (imgW <= 0 || imgH <= 0) {
    throw new Error('[CRITICAL] Cannot export annotated PNG without valid physical backdrop');
  }

  const physicalCrop = logicalRectToPhysical(selection, viewport, {
    width: imgW,
    height: imgH
  });

  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = physicalCrop.width;
  exportCanvas.height = physicalCrop.height;

  const ctx = exportCanvas.getContext('2d');
  if (!ctx) {
    throw new Error('[CRITICAL] Failed to acquire 2D context for offscreen PNG compositor');
  }

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    backdropImage,
    physicalCrop.x,
    physicalCrop.y,
    physicalCrop.width,
    physicalCrop.height,
    0,
    0,
    physicalCrop.width,
    physicalCrop.height
  );

  renderAnnotationsLayer(ctx, ops, {
    backdropImage,
    mosaicCache: new Map<number, HTMLCanvasElement>(),
    transform: {
      offsetX: -selection.x,
      offsetY: -selection.y,
      scaleX: physicalCrop.scaleX,
      scaleY: physicalCrop.scaleY,
      backdropScaleX: physicalCrop.scaleX,
      backdropScaleY: physicalCrop.scaleY
    }
  });

  return canvasToPngBytes(exportCanvas);
}
