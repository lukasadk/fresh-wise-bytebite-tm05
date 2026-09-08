import { NativeModule, requireOptionalNativeModule } from 'expo-modules-core';

import type { WasteWiseVlmModelStatus, WasteWiseVlmNativeResult } from './WasteWiseVlm.types';

declare class NativeWasteWiseVlmModule extends NativeModule {
  getModelStatusAsync(): Promise<WasteWiseVlmModelStatus>;
  prepareModelAsync(): Promise<WasteWiseVlmModelStatus>;
  analyzeImageAsync(
    imageUri: string,
    prompt: string,
    maxNewTokens: number,
    maxImageEdge: number,
  ): Promise<WasteWiseVlmNativeResult>;
  releaseAsync(): Promise<void>;
}

export default requireOptionalNativeModule<NativeWasteWiseVlmModule>('WasteWiseVlm');
