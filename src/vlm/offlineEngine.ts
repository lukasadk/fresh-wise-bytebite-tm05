import { Platform } from 'react-native';

import WasteWiseVlm, {
  type WasteWiseVlmModelStatus,
  type WasteWiseVlmNativeResult,
} from '../../modules/wastewise-vlm';
import { GROCERY_PHOTO_PROMPT, OFFLINE_MAX_IMAGE_EDGE, OFFLINE_MAX_NEW_TOKENS } from './prompt';
import { validateGroceryModelOutput, type ValidatedGroceryResult } from './schema';

export type OfflineGroceryAnalysis = ValidatedGroceryResult & {
  imageUri: string;
  modelVersion: string;
  timing: Omit<WasteWiseVlmNativeResult, 'rawText' | 'modelVersion' | 'ocrTextEvidence'>;
};

const unavailableStatus: WasteWiseVlmModelStatus = {
  nativeModuleAvailable: false,
  modelBundled: false,
  modelReady: false,
  modelVersion: null,
  quantization: null,
  copiedBytes: 0,
  totalBytes: 0,
  error: 'Offline recognition requires the Android APK with the WasteWise native module.',
};

export async function getOfflineModelStatus(): Promise<WasteWiseVlmModelStatus> {
  if (Platform.OS !== 'android' || !WasteWiseVlm) return unavailableStatus;
  return WasteWiseVlm.getModelStatusAsync();
}

export async function prepareOfflineModel(): Promise<WasteWiseVlmModelStatus> {
  if (Platform.OS !== 'android' || !WasteWiseVlm) throw new Error(unavailableStatus.error as string);
  return WasteWiseVlm.prepareModelAsync();
}

export async function analyzeGroceryPhotoOffline(imageUri: string): Promise<OfflineGroceryAnalysis> {
  if (Platform.OS !== 'android' || !WasteWiseVlm) throw new Error(unavailableStatus.error as string);
  const native = await WasteWiseVlm.analyzeImageAsync(
    imageUri,
    GROCERY_PHOTO_PROMPT,
    OFFLINE_MAX_NEW_TOKENS,
    OFFLINE_MAX_IMAGE_EDGE,
  );
  const parsed = validateGroceryModelOutput(native.rawText, native.ocrTextEvidence);
  const { rawText: _rawText, ocrTextEvidence: _ocrTextEvidence, modelVersion, ...timing } = native;
  return { ...parsed, imageUri, modelVersion, timing };
}
