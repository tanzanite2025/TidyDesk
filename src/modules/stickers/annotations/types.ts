import type { SnipPoint } from '../snipGeometry';

export type AnnotationTool =
  | 'select'
  | 'rect'
  | 'ellipse'
  | 'arrow'
  | 'line'
  | 'brush'
  | 'highlighter'
  | 'mosaic'
  | 'text'
  | 'step';

export interface AnnotationStyle {
  color: string;
  strokeWidth: number;
  opacity: number;
  fontSize: number;
  mosaicBlockSize: number;
  filled: boolean;
}

export interface RectAnnotationOp {
  id: string;
  type: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  cornerRadius?: number;
  style: AnnotationStyle;
}

export interface EllipseAnnotationOp {
  id: string;
  type: 'ellipse';
  x: number;
  y: number;
  width: number;
  height: number;
  style: AnnotationStyle;
}

export interface ArrowAnnotationOp {
  id: string;
  type: 'arrow';
  start: SnipPoint;
  end: SnipPoint;
  style: AnnotationStyle;
}

export interface LineAnnotationOp {
  id: string;
  type: 'line';
  start: SnipPoint;
  end: SnipPoint;
  style: AnnotationStyle;
}

export interface StrokeAnnotationOp {
  id: string;
  type: 'brush' | 'highlighter' | 'mosaic';
  points: SnipPoint[];
  style: AnnotationStyle;
}

export interface TextAnnotationOp {
  id: string;
  type: 'text';
  position: SnipPoint;
  text: string;
  style: AnnotationStyle;
}

export interface StepAnnotationOp {
  id: string;
  type: 'step';
  position: SnipPoint;
  number: number;
  radius: number;
  style: AnnotationStyle;
}

export type AnnotationOp =
  | RectAnnotationOp
  | EllipseAnnotationOp
  | ArrowAnnotationOp
  | LineAnnotationOp
  | StrokeAnnotationOp
  | TextAnnotationOp
  | StepAnnotationOp;

export const ANNOTATION_COLORS: readonly string[] = [
  '#ef4444', // Crimson red (default high contrast)
  '#f97316', // Amber orange
  '#eab308', // Vivid yellow
  '#22c55e', // Emerald green
  '#38bdf8', // Sky blue
  '#ffffff', // Pure white
  '#0f172a'  // Ink dark
];

export const STROKE_WIDTH_PRESETS: readonly { label: string; value: number }[] = [
  { label: '细', value: 2 },
  { label: '中', value: 4 },
  { label: '粗', value: 7 }
];

export const FONT_SIZE_PRESETS: readonly { label: string; value: number }[] = [
  { label: '小', value: 14 },
  { label: '中', value: 18 },
  { label: '大', value: 26 }
];

export const MOSAIC_BLOCK_PRESETS: readonly { label: string; value: number }[] = [
  { label: '细格', value: 8 },
  { label: '中格', value: 14 },
  { label: '粗格', value: 22 }
];

export const DEFAULT_ANNOTATION_STYLE: AnnotationStyle = {
  color: '#ef4444',
  strokeWidth: 4,
  opacity: 1,
  fontSize: 18,
  mosaicBlockSize: 14,
  filled: false
};

export function createAnnotationId(prefix = 'op'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
