export type WasteWiseVlmModelStatus = {
  nativeModuleAvailable: boolean;
  modelBundled: boolean;
  modelReady: boolean;
  modelVersion: string | null;
  quantization: string | null;
  copiedBytes: number;
  totalBytes: number;
  error: string | null;
};

export type WasteWiseVlmNativeResult = {
  rawText: string;
  ocrTextEvidence: string[];
  modelVersion: string;
  totalMs: number;
  visionMs: number | null;
  prefillMs: number | null;
  decodeMs: number | null;
  promptTokens: number | null;
  generatedTokens: number | null;
};
