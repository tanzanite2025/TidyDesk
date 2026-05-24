import { AssetOutputJob, AssetPreset, AssetPresetOutput } from './types';

export const DEFAULT_ASSET_PRESETS: AssetPreset[] = [
  {
    id: 'web-banner-960x320',
    label: '960 x 320',
    description: 'Site banner',
    width: 960,
    height: 320,
    fit: 'cover',
    outputs: [
      {
        id: 'png',
        label: 'PNG',
        format: 'png',
        fileSuffix: 'banner-960x320'
      },
      {
        id: 'webp',
        label: 'WebP',
        format: 'webp',
        fileSuffix: 'banner-960x320',
        quality: 82,
        requires: 'webp-encoder'
      }
    ]
  },
  {
    id: 'og-1200x630',
    label: '1200 x 630',
    description: 'Open Graph image',
    width: 1200,
    height: 630,
    fit: 'cover',
    outputs: [
      {
        id: 'png',
        label: 'PNG',
        format: 'png',
        fileSuffix: 'og-1200x630'
      },
      {
        id: 'webp',
        label: 'WebP',
        format: 'webp',
        fileSuffix: 'og-1200x630',
        quality: 82,
        requires: 'webp-encoder'
      }
    ]
  },
  {
    id: 'square-512',
    label: '512 x 512',
    description: 'App icon base',
    width: 512,
    height: 512,
    fit: 'cover',
    outputs: [
      {
        id: 'png',
        label: 'PNG',
        format: 'png',
        fileSuffix: 'icon-512'
      }
    ]
  },
  {
    id: 'favicon-ico',
    label: 'Favicon ICO',
    description: '16/32/48/256 ICO',
    width: 256,
    height: 256,
    fit: 'cover',
    outputs: [
      {
        id: 'ico',
        label: 'ICO',
        format: 'ico',
        fileSuffix: 'favicon',
        sizes: [16, 32, 48, 256],
        requires: 'ico-encoder'
      }
    ]
  }
];

function extensionForOutput(output: AssetPresetOutput) {
  return output.format === 'jpeg' ? 'jpg' : output.format;
}

export function createJobsFromPresets(presets: AssetPreset[]): AssetOutputJob[] {
  return presets.flatMap(preset =>
    preset.outputs.map(output => ({
      id: `${preset.id}:${output.id}`,
      presetId: preset.id,
      label: `${preset.label} ${output.label}`,
      width: preset.width,
      height: preset.height,
      fit: preset.fit,
      format: output.format,
      quality: output.quality,
      sizes: output.sizes,
      background: preset.background,
      fileName: `${output.fileSuffix}.${extensionForOutput(output)}`
    }))
  );
}

