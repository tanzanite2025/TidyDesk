import { AssetLabClient, AssetProcessRequest, AssetProcessResponse } from '../contracts/types';

export type TidyDeskAssetLabBridge = {
  processAssetLabRequest: (request: AssetProcessRequest) => Promise<AssetProcessResponse>;
  revealAssetLabFile?: (path: string) => Promise<void>;
  copyAssetLabFilePath?: (path: string) => Promise<void>;
};

export function createElectronAssetLabClient(bridge: TidyDeskAssetLabBridge): AssetLabClient {
  return {
    process: request => bridge.processAssetLabRequest(request),
    revealFile: bridge.revealAssetLabFile
      ? path => bridge.revealAssetLabFile?.(path) ?? Promise.resolve()
      : undefined,
    copyFilePath: bridge.copyAssetLabFilePath
      ? path => bridge.copyAssetLabFilePath?.(path) ?? Promise.resolve()
      : undefined
  };
}

