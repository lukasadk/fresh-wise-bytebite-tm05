export const GROCERY_UNITS = [
  'piece',
  'pack',
  'bag',
  'box',
  'bottle',
  'can',
  'jar',
  'bunch',
  'tray',
  'carton',
  'kg',
  'g',
  'L',
  'mL',
  'unknown',
] as const;

export type GroceryUnit = (typeof GROCERY_UNITS)[number];

export type GroceryCandidate = {
  candidateId: string;
  foodName: string;
  brand: string | null;
  productVariant: string | null;
  netContentText: string | null;
  category: string;
  appCategory: string;
  quantity: number | null;
  unit: GroceryUnit;
  confidence: number;
  reviewRequired: boolean;
  reviewReasons: string[];
  packagingTextEvidence: string[];
  expiryDateCandidate: string | null;
  expiryTextEvidence: string | null;
};

export type ValidatedGroceryResult = {
  items: GroceryCandidate[];
  discardedItems: number;
  duplicateGroupsMerged: number;
  outputRepaired: boolean;
  normalizationWarnings: string[];
};

const NULL_LIKE = new Set(['', 'null', 'none', 'n/a', 'na', 'unknown', 'unreadable']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UNIT_SET = new Set<string>(GROCERY_UNITS);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function compact(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function nullableText(value: unknown, maxLength = 200): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().slice(0, maxLength);
  return NULL_LIKE.has(text.toLocaleLowerCase()) ? null : text;
}

function requiredText(value: unknown, fallback: string, maxLength = 200): string {
  return nullableText(value, maxLength) ?? fallback;
}

function supportedByEvidence(value: string | null, evidence: string[]): boolean {
  if (!value) return true;
  const needle = compact(value);
  return needle.length > 0 && evidence.some((fragment) => compact(fragment).includes(needle));
}

function stripBrandPrefix(foodName: string, brand: string | null): string {
  if (!brand) return foodName;
  const foldedName = foodName.toLocaleLowerCase();
  const foldedBrand = brand.toLocaleLowerCase();
  if (!foldedName.startsWith(foldedBrand)) return foodName;
  const remainder = foodName.slice(brand.length).replace(/^[\s:|/\-–—]+/, '').trim();
  return remainder || foodName;
}

function parseQuantity(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 100) return null;
  return parsed;
}

function parseConfidence(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(1, Math.max(0, parsed));
}

function parseEvidence(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => nullableText(entry, 120)).filter((entry): entry is string => !!entry))].slice(0, 10);
}

function parseUnit(value: unknown): GroceryUnit {
  const unit = nullableText(value, 20) ?? 'unknown';
  return UNIT_SET.has(unit) ? (unit as GroceryUnit) : 'unknown';
}

export function mapToAppCategory(category: string, foodName = ''): string {
  const text = `${category} ${foodName}`.toLocaleLowerCase();
  if (/dairy|milk|yog(?:h)?urt|cheese|butter|cream/.test(text)) return 'Dairy';
  if (/protein|meat|beef|chicken|poultry|fish|seafood|egg|tofu/.test(text)) return 'Protein';
  if (/vegetable|greens?|salad|herb/.test(text)) return 'Vegetables';
  if (/fruit|berry|berries|apple|banana|orange|melon/.test(text)) return 'Fruit';
  if (/frozen|ice cream/.test(text)) return 'Frozen';
  if (/beverage|drink|water|juice|coffee|tea|malt/.test(text)) return 'Beverages';
  if (/pantry|snack|biscuit|cookie|cracker|rice|noodle|pasta|sauce|oil|canned|grain|bread|bakery|condiment/.test(text)) {
    return 'Pantry';
  }
  return 'Other';
}

function firstBalancedObject(text: string): string | null {
  for (let start = text.indexOf('{'); start >= 0; start = text.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const character = text[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === '{') depth += 1;
      else if (character === '}') {
        depth -= 1;
        if (depth === 0) return text.slice(start, index + 1);
      }
    }
  }
  return null;
}

function repairCommonModelJson(text: string): string {
  return text
    // Small VLMs sometimes emit a closing key quote but omit its opening quote.
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)"\s*:/g, '$1"$2":')
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":')
    .replace(/,\s*([}\]])/g, '$1');
}

function extractJson(rawText: string): { payload: unknown; repaired: boolean } {
  const trimmed = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return { payload: JSON.parse(trimmed), repaired: false };
  } catch {
    const balanced = firstBalancedObject(trimmed);
    if (balanced) {
      try {
        return { payload: JSON.parse(balanced), repaired: balanced !== trimmed };
      } catch {
        // Continue to the narrowly scoped syntax repair below.
      }
    }
    if (!trimmed.includes('items')) throw new Error('The model did not return a JSON object.');
    const repairedText = repairCommonModelJson(trimmed);
    const repairedObject = firstBalancedObject(repairedText);
    if (!repairedObject) throw new Error('The model did not return a repairable JSON object.');
    try {
      return { payload: JSON.parse(repairedObject), repaired: true };
    } catch {
      throw new Error('The model did not return a repairable JSON object.');
    }
  }
}

export function validateGroceryModelOutput(
  rawText: string,
  trustedOcrTextEvidence: string[] = [],
): ValidatedGroceryResult {
  const extracted = extractJson(rawText);
  const payload = record(extracted.payload);
  if (!payload || !Array.isArray(payload.items)) {
    throw new Error('The model response is missing an items array.');
  }

  const normalizationWarnings: string[] = extracted.repaired
    ? ['Model JSON syntax was repaired; every recovered item requires review.']
    : [];
  const trustedEvidence = parseEvidence(trustedOcrTextEvidence);
  let discardedItems = Math.max(0, payload.items.length - 50);
  let duplicateGroupsMerged = 0;
  const validated: GroceryCandidate[] = [];
  const byIdentity = new Map<string, GroceryCandidate>();

  for (const [index, rawItem] of payload.items.slice(0, 50).entries()) {
    const item = record(rawItem);
    if (!item) {
      discardedItems += 1;
      continue;
    }

    const reasons: string[] = [];
    const modelEvidence = parseEvidence(item.packaging_text_evidence);
    // Only independently observed OCR text is shown to the user as visible
    // evidence. A model repeating its own claim is not corroboration.
    const evidence = trustedEvidence;
    let brand = nullableText(item.brand, 100);
    const usedLegacyNetContent = item.net_content_text == null && item.net_content != null;
    let netContentText = nullableText(item.net_content_text ?? item.net_content, 80);
    let productVariant = nullableText(item.product_variant, 120);
    let foodName = requiredText(item.food_name, 'Unidentified grocery');
    foodName = stripBrandPrefix(foodName, brand);
    const category = requiredText(item.category, 'other', 100);
    const quantity = parseQuantity(item.quantity);
    const unit = parseUnit(item.unit);
    const confidence = parseConfidence(item.confidence);

    if (!supportedByEvidence(brand, trustedEvidence)) {
      brand = null;
      reasons.push('brand_without_independent_ocr_evidence');
      normalizationWarnings.push(`Item ${index + 1}: brand without independent OCR evidence was removed.`);
    }
    if (!supportedByEvidence(netContentText, trustedEvidence)) {
      netContentText = null;
      reasons.push('net_content_without_independent_ocr_evidence');
      normalizationWarnings.push(`Item ${index + 1}: net content without independent OCR evidence was removed.`);
    }
    if (!supportedByEvidence(productVariant, trustedEvidence)) {
      productVariant = null;
      reasons.push('product_variant_without_independent_ocr_evidence');
      normalizationWarnings.push(`Item ${index + 1}: product variant without independent OCR evidence was removed.`);
    }
    if (modelEvidence.length > 0 && trustedEvidence.length === 0) {
      reasons.push('model_reported_ocr_was_not_independently_verified');
    }
    if (usedLegacyNetContent) reasons.push('legacy_net_content_alias_normalized');
    if (extracted.repaired) reasons.push('model_json_syntax_repaired');
    if (quantity === null) reasons.push('quantity_uncertain');
    if (unit === 'unknown') reasons.push('unit_uncertain');
    if (confidence < 0.75) reasons.push('low_visual_confidence');
    if (foodName === 'Unidentified grocery') reasons.push('identity_uncertain');

    let expiryDateCandidate = nullableText(item.expiry_date_candidate, 10);
    let expiryTextEvidence = nullableText(item.expiry_text_evidence, 120);
    if (
      !expiryDateCandidate
      || !expiryTextEvidence
      || !ISO_DATE.test(expiryDateCandidate)
      || !supportedByEvidence(expiryTextEvidence, trustedEvidence)
    ) {
      if (expiryDateCandidate || expiryTextEvidence) {
        reasons.push('expiry_without_independent_ocr_evidence');
        normalizationWarnings.push(`Item ${index + 1}: unsupported expiry claim was removed.`);
      }
      expiryDateCandidate = null;
      expiryTextEvidence = null;
    } else {
      reasons.push('expiry_candidate_requires_confirmation');
    }

    const modelReviewRequired = item.review_required !== false;
    const candidate: GroceryCandidate = {
      candidateId: `candidate-${index + 1}`,
      foodName,
      brand,
      productVariant,
      netContentText,
      category,
      appCategory: mapToAppCategory(category, foodName),
      quantity,
      unit,
      confidence,
      reviewRequired: modelReviewRequired || reasons.length > 0,
      reviewReasons: reasons,
      packagingTextEvidence: evidence,
      expiryDateCandidate,
      expiryTextEvidence,
    };

    const key = [foodName, brand, productVariant, netContentText, unit].map((value) => compact(value ?? '')).join('|');
    const previous = byIdentity.get(key);
    if (previous) {
      // Identical generated rows may be decoder repetition. Never inflate the
      // physical count by summing them; retain the largest candidate count and
      // force the user to verify it.
      previous.quantity = previous.quantity !== null && quantity !== null
        ? Math.max(previous.quantity, quantity)
        : previous.quantity ?? quantity;
      previous.confidence = Math.min(previous.confidence, confidence);
      previous.reviewRequired = true;
      previous.reviewReasons = [
        ...new Set([...previous.reviewReasons, ...reasons, 'duplicate_model_rows_collapsed_quantity_not_summed']),
      ];
      previous.packagingTextEvidence = [...new Set([...previous.packagingTextEvidence, ...evidence])].slice(0, 10);
      duplicateGroupsMerged += 1;
    } else {
      byIdentity.set(key, candidate);
      validated.push(candidate);
    }
  }

  return {
    items: validated,
    discardedItems,
    duplicateGroupsMerged,
    outputRepaired: extracted.repaired,
    normalizationWarnings: [...new Set(normalizationWarnings)],
  };
}
