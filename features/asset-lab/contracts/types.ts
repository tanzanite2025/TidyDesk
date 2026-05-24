export type AssetSourceKind = 'file' | 'clipboard-image' | 'sticker';

export type AssetOutputFormat = 'png' | 'jpg' | 'jpeg' | 'webp' | 'ico';

export type AssetFitMode = 'cover' | 'contain' | 'stretch';

export type AssetEncoderCapability = 'webp-encoder' | 'ico-encoder';

export type AssetSourceRef = {
  id?: string;
  kind: AssetSourceKind;
  name: string;
  path: string;
  previewUrl?: string;
  width?: number;
  height?: number;
};

export type AssetPresetOutput = {
  id: string;
  label: string;
  format: AssetOutputFormat;
  fileSuffix: string;
  quality?: number;
  sizes?: number[];
  requires?: AssetEncoderCapability;
};

export type AssetPreset = {
  id: string;
  label: string;
  description: string;
  width: number;
  height: number;
  fit: AssetFitMode;
  background?: string;
  outputs: AssetPresetOutput[];
};

export type AssetOutputJob = {
  id: string;
  presetId: string;
  label: string;
  width: number;
  height: number;
  fit: AssetFitMode;
  format: AssetOutputFormat;
  quality?: number;
  sizes?: number[];
  background?: string;
  fileName?: string;
};

export type AssetProcessRequest = {
  requestId: string;
  input: AssetSourceRef;
  outputDir?: string;
  overwrite?: boolean;
  jobs: AssetOutputJob[];
};

export type AssetProcessFile = {
  jobId: string;
  presetId: string;
  label: string;
  path: string;
  fileName: string;
  format: AssetOutputFormat;
  width: number;
  height: number;
  bytes: number;
};

export type AssetProcessError = {
  jobId?: string;
  code: string;
  message: string;
};

export type AssetProcessResponse = {
  requestId: string;
  ok: boolean;
  files: AssetProcessFile[];
  errors: AssetProcessError[];
  durationMs?: number;
};

export type AssetLabClient = {
  process: (request: AssetProcessRequest) => Promise<AssetProcessResponse>;
  revealFile?: (path: string) => Promise<void>;
  copyFilePath?: (path: string) => Promise<void>;
};

