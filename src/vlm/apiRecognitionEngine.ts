import { API_BASE_URL, API_KEY, API_KEY_HEADER } from '../api/config.ts';
import { hasNativeImageBase64Reader, readImageBase64 } from '../native/photoFilePicker';
import { GROCERY_UNITS, mapToAppCategory } from './schema.ts';
import type {
  GroceryBoundingBox,
  GroceryCandidate,
  GroceryUnit,
  ValidatedGroceryResult,
} from './schema.ts';

export type GroceryRecognitionMode = 'photo' | 'receipt';

export type GroceryAIStatus = {
  enabled: boolean;
  configurationError: string | null;
  receiptReady: boolean;
};

export type ApiGroceryAnalysis = ValidatedGroceryResult & {
  imageUri: string;
  reviewImageUri: string | null;
  inputType: 'grocery_photo' | 'receipt';
  analysisId: string;
  timing: { totalMs: number };
};

type ApiItem = Record<string, unknown>;
type ApiAnalysis = {
  analysis_id?: unknown;
  input_type?: unknown;
  items?: unknown;
  warnings?: unknown;
  generation_attempts?: unknown;
  latency_ms?: unknown;
  review_image_url?: unknown;
};

const configuredBaseUrl = (
  process.env.EXPO_PUBLIC_GROCERY_AI_API_URL
  ?? process.env.EXPO_PUBLIC_WASTEWISE_BROWSER_MODEL_API_URL
  ?? API_BASE_URL
).trim().replace(/\/+$/, '');

const serviceKey = (process.env.EXPO_PUBLIC_GROCERY_AI_SERVICE_KEY ?? '').trim();
const requestTimeoutMs = 180_000;
const unitSet = new Set<string>(GROCERY_UNITS);
const isWebRuntime = typeof document !== 'undefined';
const sharesMainApi = configuredBaseUrl === API_BASE_URL.replace(/\/+$/, '');

export const GROCERY_AI_API_BASE_URL = configuredBaseUrl;

function headers(json = false): Record<string, string> {
  const result: Record<string, string> = { Accept: 'application/json' };
  if (json) result['Content-Type'] = 'application/json';
  if (serviceKey) result['X-WasteWise-API-Key'] = serviceKey;
  if (sharesMainApi && API_KEY) result[API_KEY_HEADER] = API_KEY;
  return result;
}

async function withTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error('AI recognition timed out. Please try a clearer, smaller photo.');
    }
    throw new Error(`Cannot reach the AI recognition service at ${configuredBaseUrl}.`, { cause: error });
  } finally {
    clearTimeout(timer);
  }
}

async function responseDetail(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { detail?: unknown };
    if (typeof payload.detail === 'string' && payload.detail.trim()) return payload.detail.trim();
  } catch {
    // Fall through to HTTP status.
  }
  return `${response.status} ${response.statusText}`.trim();
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function capitalizeFirstLetter(value: string): string {
  return value.replace(/\p{L}/u, (letter) => letter.toLocaleUpperCase());
}

function nullableText(value: unknown): string | null {
  const parsed = text(value);
  return parsed || null;
}

function absoluteApiUrl(pathOrUrl: unknown): string | null {
  const parsed = text(pathOrUrl);
  if (!parsed) return null;
  if (/^https?:\/\//i.test(parsed)) return parsed;
  return `${configuredBaseUrl}${parsed.startsWith('/') ? '' : '/'}${parsed}`;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string' && !!entry.trim())
    .map((entry) => entry.trim());
}

function positiveNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function confidence(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0;
}

function unit(value: unknown): GroceryUnit {
  const parsed = text(value, 'unknown');
  return unitSet.has(parsed) ? parsed as GroceryUnit : 'unknown';
}

function boundingBox(value: unknown): GroceryBoundingBox | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const coordinates = value.map(Number).map(Math.round);
  if (coordinates.some((coordinate) => !Number.isFinite(coordinate))) return null;
  const [x1, y1, x2, y2] = coordinates;
  if (x1 < 0 || y1 < 0 || x2 > 1000 || y2 > 1000 || x2 <= x1 || y2 <= y1) return null;
  return [x1, y1, x2, y2];
}

function productDisplayName(item: ApiItem): string {
  const foodName = text(item.food_name, 'Unidentified grocery');
  const brand = nullableText(item.brand);
  const variant = nullableText(item.product_variant);
  const parts: string[] = [];
  for (const part of [brand, foodName, variant]) {
    if (!part) continue;
    const compact = part.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    if (parts.some((existing) => existing.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '').includes(compact))) {
      continue;
    }
    parts.push(part);
  }
  return capitalizeFirstLetter(parts.join(' ')).slice(0, 200);
}

export function mapApiAnalysisResponse(payload: ApiAnalysis, imageUri: string): ApiGroceryAnalysis {
  if (!Array.isArray(payload.items)) throw new Error('The AI service returned an invalid item list.');
  const items = payload.items.map((raw, index): GroceryCandidate | null => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const item = raw as ApiItem;
    const baseFoodName = text(item.food_name, 'Unidentified grocery');
    const category = text(item.category, 'other');
    const reasons = stringList(item.review_reasons);
    const itemQuantity = positiveNumber(item.quantity);
    const itemBox = boundingBox(item.bounding_box);
    if (itemQuantity === null && !reasons.includes('quantity_uncertain')) reasons.push('quantity_uncertain');
    if (itemBox === null && !reasons.includes('position_uncertain')) reasons.push('position_uncertain');
    return {
      candidateId: text(item.item_id, `api-item-${index + 1}`),
      foodName: productDisplayName(item),
      brand: nullableText(item.brand),
      productVariant: nullableText(item.product_variant),
      netContentText: nullableText(item.net_content_text),
      category,
      appCategory: mapToAppCategory(category, baseFoodName),
      quantity: itemQuantity,
      unit: unit(item.unit),
      boundingBox: itemBox,
      confidence: confidence(item.confidence),
      reviewRequired: item.review_required !== false || reasons.length > 0,
      reviewReasons: reasons,
      packagingTextEvidence: stringList(item.packaging_text_evidence),
      expiryDateCandidate: nullableText(item.expiry_date_candidate),
      expiryTextEvidence: nullableText(item.expiry_text_evidence),
      estimatedExpiryDate: nullableText(item.estimated_expiry_date),
      expiryEstimateDays: positiveNumber(item.expiry_estimate_days),
      expiryEstimateBasis: nullableText(item.expiry_estimate_basis),
    };
  }).filter((item): item is GroceryCandidate => item !== null);

  return {
    imageUri,
    reviewImageUri: absoluteApiUrl(payload.review_image_url),
    inputType: payload.input_type === 'receipt' ? 'receipt' : 'grocery_photo',
    analysisId: text(payload.analysis_id),
    items,
    discardedItems: Math.max(0, payload.items.length - items.length),
    duplicateGroupsMerged: 0,
    outputRepaired: Number(payload.generation_attempts) > 1,
    normalizationWarnings: stringList(payload.warnings),
    timing: { totalMs: Math.max(0, Number(payload.latency_ms) || 0) },
  };
}

export async function getGroceryAIStatus(): Promise<GroceryAIStatus> {
  const response = await withTimeout(`${configuredBaseUrl}/v1/api-recognition/config`, {
    method: 'GET',
    headers: headers(),
  });
  if (!response.ok) throw new Error(`AI service check failed: ${await responseDetail(response)}`);
  const payload = await response.json() as Record<string, unknown>;
  return {
    enabled: payload.enabled === true,
    configurationError: nullableText(payload.configuration_error),
    receiptReady: payload.receipt_prompt_loaded === true,
  };
}

async function imagePart(imageUri: string): Promise<Blob | Record<string, string>> {
  const lower = imageUri.split('?')[0].toLocaleLowerCase();
  const extension = lower.endsWith('.png') ? 'png' : lower.endsWith('.webp') ? 'webp' : 'jpg';
  const type = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg';
  const name = `grocery-image.${extension}`;
  if (!isWebRuntime) {
    return { uri: imageUri, name, type };
  }
  const response = await fetch(imageUri);
  if (!response.ok) throw new Error('The selected image could not be read.');
  return response.blob();
}

function imageContentType(imageUri: string): 'image/jpeg' | 'image/png' | 'image/webp' {
  const lower = imageUri.split('?')[0].toLocaleLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

export async function analyzeGroceryImage(
  imageUri: string,
  mode: GroceryRecognitionMode,
): Promise<ApiGroceryAnalysis> {
  if (!isWebRuntime && hasNativeImageBase64Reader()) {
    const endpoint = mode === 'receipt'
      ? '/v1/api-recognition/receipt-json'
      : '/v1/api-recognition/analyze-json';
    const contentType = imageContentType(imageUri);
    const imageBase64 = await readImageBase64(imageUri);
    const response = await withTimeout(`${configuredBaseUrl}${endpoint}`, {
      method: 'POST',
      headers: headers(true),
      body: JSON.stringify({
        image_base64: imageBase64,
        content_type: contentType,
      }),
    });
    if (!response.ok) throw new Error(`AI recognition failed: ${await responseDetail(response)}`);
    const analysis = mapApiAnalysisResponse(await response.json() as ApiAnalysis, imageUri);
    return {
      ...analysis,
      // Android's RN Image pipeline can render app-cache file:// URIs as a blank
      // drawable on some MIUI builds. The native picker now normalizes the source
      // to a reasonably sized JPEG first, so keeping this same JPEG as a data URI
      // gives the result page a self-contained preview for the SVG overlay.
      reviewImageUri: `data:${contentType};base64,${imageBase64}`,
    };
  }

  const form = new FormData();
  const part = await imagePart(imageUri);
  if (isWebRuntime) form.append('file', part as Blob, 'grocery-image.jpg');
  else form.append('file', part as any);
  const endpoint = mode === 'receipt'
    ? '/v1/api-recognition/receipt'
    : '/v1/api-recognition/analyze';
  const response = await withTimeout(`${configuredBaseUrl}${endpoint}`, {
    method: 'POST',
    headers: headers(),
    body: form,
  });
  if (!response.ok) throw new Error(`AI recognition failed: ${await responseDetail(response)}`);
  return mapApiAnalysisResponse(await response.json() as ApiAnalysis, imageUri);
}

export async function estimateExpiryWithApi(foodName: string, category?: string): Promise<{
  date: string;
  days: number;
  basis: string;
}> {
  const response = await withTimeout(`${configuredBaseUrl}/v1/expiry-estimates`, {
    method: 'POST',
    headers: headers(true),
    body: JSON.stringify({ food_name: foodName, category: category || null }),
  });
  if (!response.ok) throw new Error(`Expiry estimate failed: ${await responseDetail(response)}`);
  const payload = await response.json() as Record<string, unknown>;
  const date = text(payload.estimated_expiry_date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('The expiry service returned an invalid date.');
  return {
    date,
    days: positiveNumber(payload.estimate_days) ?? 30,
    basis: text(payload.basis, 'grocery estimate'),
  };
}
