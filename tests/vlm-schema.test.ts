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
      bounding_box: [100, 120, 760, 900],
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
  assert.deepEqual(result.items[0].boundingBox, [100, 120, 760, 900]);
  assert.equal(result.items[0].appCategory, 'Beverages');
  assert.equal(result.items[0].reviewRequired, false);
});

test('keeps valid Qwen grounding coordinates and rejects unsafe boxes', () => {
  const valid = validateGroceryModelOutput(JSON.stringify({
    items: [{
      food_name: 'Green apple', category: 'fruit', quantity: 1, unit: 'piece',
      bounding_box: [101.4, 202.6, 701.2, 902.8], confidence: 0.9,
      review_required: false,
    }],
  })).items[0];

  assert.deepEqual(valid.boundingBox, [101, 203, 701, 903]);
  assert.ok(!valid.reviewReasons.includes('position_uncertain'));

  const invalid = validateGroceryModelOutput(JSON.stringify({
    items: [{
      food_name: 'Milk', category: 'dairy', quantity: 1, unit: 'carton',
      bounding_box: [-10, 20, 1100, 800], confidence: 0.9,
      review_required: false,
    }],
  })).items[0];

  assert.equal(invalid.boundingBox, null);
  assert.equal(invalid.reviewRequired, true);
  assert.ok(invalid.reviewReasons.includes('position_uncertain'));
});

test('keeps a diverse multi-product basket without a three-class whitelist', () => {
  const names = [
    'Julies cream crackers',
    'Dutch Lady UHT milk',
    'Maggi curry noodles',
    'Ayam Brand sardines',
    'Jasmine fragrant rice',
    'Gardenia wholemeal bread',
    'eggs',
    'bok choy',
    'chicken breast',
    'tofu',
    'bananas',
    'cooking oil',
  ];
  const result = validateGroceryModelOutput(JSON.stringify({
    items: names.map((foodName, index) => ({
      food_name: foodName,
      category: 'other',
      quantity: index === 6 ? 6 : 1,
      unit: index === 6 ? 'tray' : 'pack',
      bounding_box: [10 + index * 20, 20 + index * 20, 180 + index * 20, 220 + index * 20],
      confidence: 0.9,
      review_required: false,
    })),
  }));

  assert.equal(result.items.length, names.length);
  assert.deepEqual(result.items.map((item) => item.foodName), names);
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

test('recovers only complete item rows when the root JSON is token-truncated', () => {
  const raw = '{"items":['
    + '{"food_name":"milk","brand":"Goodday","product_variant":"Full Cream Milk","net_content_text":null,"category":"dairy","quantity":1,"unit":"carton","packaging_text_evidence":["Goodday","Full Cream Milk"]},'
    + '{"food_name":"apple","brand":null,"product_variant":null,"net_content_text":null,"category":"fruit","quantity":1,"unit":"piece","packaging_text_evidence":[]},'
    + '{"food_name":"water","brand":"Summer","packaging_text_evidence":["Summer","Summer","Summer"';
  const result = validateGroceryModelOutput(raw, ['Goodday', 'Full Cream Milk']);

  assert.equal(result.outputRepaired, true);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].brand, 'Goodday');
  assert.equal(result.items[1].foodName, 'apple');
  assert.ok(result.items.every((item) => item.reviewRequired));
  assert.ok(result.items.every((item) => item.reviewReasons.includes('model_json_syntax_repaired')));
});

test('does not invent an item when truncation happens before the first row closes', () => {
  assert.throws(
    () => validateGroceryModelOutput('{"items":[{"food_name":"milk","brand":"Goodday"'),
    /repairable JSON object/,
  );
});

test('accepts the compact recovery contract without inventing omitted fields', () => {
  const result = validateGroceryModelOutput(JSON.stringify({
    items: [
      {
        food_name: 'Goodday full cream milk',
        quantity: 1,
        bounding_box: [80, 60, 420, 920],
        expiry_date_candidate: null,
        expiry_text_evidence: null,
      },
      {
        food_name: 'mineral water',
        quantity: 1,
        bounding_box: [520, 80, 900, 920],
        expiry_date_candidate: null,
        expiry_text_evidence: null,
      },
    ],
  }));

  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].foodName, 'Goodday full cream milk');
  assert.equal(result.items[0].quantity, 1);
  assert.equal(result.items[0].unit, 'unknown');
  assert.equal(result.items[0].expiryDateCandidate, null);
  assert.ok(result.items.every((item) => item.reviewRequired));
});

test('preserves the valid phone result around an orphan member and discards the empty row', () => {
  const raw = '{"items":['
    + '{"food_name":"ICE FOUNTAIN","quantity":1,"unit":"bottle","bounding_box":[0,0,483,695],"expiry_date_candidate":null,"expiry_text_evidencenull"},'
    + '{"food_name":"","quantity":"unknown","unit":"","bounding_box":[-1,-1,1002,998],"expiry_data_candidate":"1/11 / 19/22","expiry_textr_evi_dence":"N/A"}'
    + ']}';
  const result = validateGroceryModelOutput(raw, ['ICE FOUNTAIN', 'Goodday', 'FULL CREAM MILK']);

  assert.equal(result.outputRepaired, true);
  assert.equal(result.items.length, 1);
  assert.equal(result.discardedItems, 1);
  assert.equal(result.items[0].foodName, 'ICE FOUNTAIN');
  assert.equal(result.items[0].quantity, 1);
  assert.equal(result.items[0].unit, 'bottle');
  assert.deepEqual(result.items[0].boundingBox, [0, 0, 483, 695]);
  assert.equal(result.items[0].expiryDateCandidate, null);
  assert.equal(result.items[0].expiryTextEvidence, null);
  assert.ok(result.normalizationWarnings.some((warning) => warning.includes('empty or unidentified')));
});

test('drops a syntactically valid row that has no product identity', () => {
  const result = validateGroceryModelOutput(JSON.stringify({
    items: [
      { food_name: '', quantity: 1, unit: 'piece', bounding_box: null },
      { food_name: 'banana', quantity: 2, unit: 'piece', bounding_box: [10, 10, 400, 600] },
    ],
  }));

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].foodName, 'banana');
  assert.equal(result.discardedItems, 1);
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

test('accepts packaging text split across adjacent OCR lines', () => {
  const item = validateGroceryModelOutput(JSON.stringify({
    items: [{
      food_name: 'milk', brand: 'Goodday', product_variant: 'Full Cream Milk',
      net_content_text: null, category: 'dairy', quantity: 1, unit: 'carton',
      confidence: 0.95, review_required: true,
      packaging_text_evidence: ['GOODDAY', 'FULL CREAM', 'MILK'],
    }],
  }), ['GOODDAY', 'FULL CREAM', 'MILK']).items[0];

  assert.equal(item.brand, 'Goodday');
  assert.equal(item.productVariant, 'Full Cream Milk');
  assert.ok(!item.reviewReasons.includes('product_variant_without_independent_ocr_evidence'));
});

test('uses trusted OCR evidence after the first ten fragments', () => {
  const trustedEvidence = [
    'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'Goodday',
  ];
  const item = validateGroceryModelOutput(JSON.stringify({
    items: [{
      food_name: 'milk', brand: 'Goodday', product_variant: null,
      net_content_text: null, category: 'dairy', quantity: 1, unit: 'carton',
      confidence: 0.9, review_required: true, packaging_text_evidence: ['Goodday'],
    }],
  }), trustedEvidence).items[0];

  assert.equal(item.brand, 'Goodday');
  assert.equal(item.packagingTextEvidence.length, trustedEvidence.length);
});

test('does not combine non-adjacent OCR text into packaging evidence', () => {
  const item = validateGroceryModelOutput(JSON.stringify({
    items: [{
      food_name: 'milk', brand: null, product_variant: 'Full Cream Milk',
      net_content_text: null, category: 'dairy', quantity: 1, unit: 'carton',
      confidence: 0.9, review_required: true, packaging_text_evidence: [],
    }],
  }), ['FULL', 'unrelated text', 'from another package', 'CREAM', 'MILK']).items[0];

  assert.equal(item.productVariant, null);
  assert.ok(item.reviewReasons.includes('product_variant_without_independent_ocr_evidence'));
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
