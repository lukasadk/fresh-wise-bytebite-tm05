import assert from 'node:assert/strict';
import test from 'node:test';

import { validateGroceryModelOutput } from '../src/vlm/schema.ts';

test('normalizes the brand contract and keeps supported packaging fields', () => {
  const result = validateGroceryModelOutput(JSON.stringify({
    items: [{
      food_name: 'Milo Chocolate Malt Drink',
      brand: 'Milo',
      product_variant: 'Chocolate',
      net_content_text: '900g',
      category: 'beverage',
      quantity: 2,
      unit: 'pack',
      confidence: 0.91,
      review_required: false,
      packaging_text_evidence: ['MILO', 'Chocolate Malt', '900g'],
      expiry_date_candidate: null,
      expiry_text_evidence: null,
    }],
  }), ['MILO', 'Chocolate Malt', '900g']);

  assert.equal(result.items[0].foodName, 'Chocolate Malt Drink');
  assert.equal(result.items[0].brand, 'Milo');
  assert.equal(result.items[0].netContentText, '900g');
  assert.equal(result.items[0].quantity, 2);
  assert.equal(result.items[0].appCategory, 'Beverages');
  assert.equal(result.items[0].reviewRequired, false);
});

test('fails closed when packaging claims have no visible text evidence', () => {
  const result = validateGroceryModelOutput(JSON.stringify({
    items: [{
      food_name: 'Fresh milk',
      brand: 'Imagined Brand',
      net_content_text: '1 L',
      category: 'dairy',
      quantity: null,
      unit: 'unknown',
      confidence: 1.7,
      review_required: false,
      packaging_text_evidence: [],
    }],
  }));

  const item = result.items[0];
  assert.equal(item.brand, null);
  assert.equal(item.productVariant, null);
  assert.equal(item.netContentText, null);
  assert.equal(item.quantity, null);
  assert.equal(item.confidence, 1);
  assert.equal(item.reviewRequired, true);
  assert.ok(item.reviewReasons.includes('brand_without_independent_ocr_evidence'));
  assert.ok(item.reviewReasons.includes('quantity_uncertain'));
});

test('repairs the observed 2B key quoting error and removes invented net content', () => {
  const raw = '{"items":[{"food_name":"apple", brand":"", category":"fruit", quantity":"1", unit":"apple", net_content":"100 g", confidence_or_review_required":"1", review_required":"0"}]}]}';
  const result = validateGroceryModelOutput(raw);

  assert.equal(result.outputRepaired, true);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].foodName, 'apple');
  assert.equal(result.items[0].quantity, 1);
  assert.equal(result.items[0].netContentText, null);
  assert.equal(result.items[0].unit, 'unknown');
  assert.equal(result.items[0].reviewRequired, true);
  assert.ok(result.items[0].reviewReasons.includes('model_json_syntax_repaired'));
  assert.ok(result.items[0].reviewReasons.includes('net_content_without_independent_ocr_evidence'));
  assert.ok(result.normalizationWarnings.some((warning) => warning.includes('net content without independent OCR')));
});

test('does not attempt to turn repeated brace output into an inventory result', () => {
  assert.throws(
    () => validateGroceryModelOutput('{"{"{"{"{"{"{"{'),
    /JSON object/,
  );
});

test('keeps a printed expiry candidate only with ISO date and evidence', () => {
  const valid = validateGroceryModelOutput(JSON.stringify({
    items: [{
      food_name: 'Yogurt', category: 'dairy', quantity: 1, unit: 'cup', confidence: 0.9,
      review_required: false, packaging_text_evidence: ['EXP 31/12/2027'],
      expiry_date_candidate: '2027-12-31', expiry_text_evidence: 'EXP 31/12/2027',
    }],
  }), ['EXP 31/12/2027']).items[0];
  assert.equal(valid.expiryDateCandidate, '2027-12-31');
  assert.equal(valid.reviewRequired, true);
  assert.ok(valid.reviewReasons.includes('expiry_candidate_requires_confirmation'));

  const invalid = validateGroceryModelOutput(JSON.stringify({
    items: [{
      food_name: 'Yogurt', category: 'dairy', quantity: 1, unit: 'pack', confidence: 0.9,
      review_required: false, packaging_text_evidence: [],
      expiry_date_candidate: 'next month', expiry_text_evidence: null,
    }],
  })).items[0];
  assert.equal(invalid.expiryDateCandidate, null);
  assert.equal(invalid.expiryTextEvidence, null);
});

test('removes a syntactically valid but unsupported expiry claim', () => {
  const item = validateGroceryModelOutput(JSON.stringify({
    items: [{
      food_name: 'Milk', category: 'dairy', quantity: 1, unit: 'carton', confidence: 0.9,
      review_required: true, packaging_text_evidence: ['EXP 31/12/2027'],
      expiry_date_candidate: '2027-12-31', expiry_text_evidence: 'EXP 31/12/2027',
    }],
  })).items[0];

  assert.equal(item.expiryDateCandidate, null);
  assert.ok(item.reviewReasons.includes('expiry_without_independent_ocr_evidence'));
});

test('collapses exact duplicate model rows without inflating quantity', () => {
  const row = {
    food_name: 'Cream crackers', brand: 'Hup Seng', product_variant: null,
    net_content_text: '428g', category: 'snack', quantity: 1, unit: 'pack',
    confidence: 0.82, review_required: false,
    packaging_text_evidence: ['Hup Seng', '428g'],
  };
  const result = validateGroceryModelOutput(
    JSON.stringify({ items: [row, row] }),
    ['Hup Seng', '428g'],
  );
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].quantity, 1);
  assert.equal(result.duplicateGroupsMerged, 1);
  assert.equal(result.items[0].reviewRequired, true);
  assert.ok(result.items[0].reviewReasons.includes('duplicate_model_rows_collapsed_quantity_not_summed'));
});

test('rejects non-JSON model output', () => {
  assert.throws(() => validateGroceryModelOutput('I can see milk and bread.'), /JSON object/);
});
