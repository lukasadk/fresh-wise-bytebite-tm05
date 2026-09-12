import assert from 'node:assert/strict';
import test from 'node:test';

import { mapApiAnalysisResponse } from '../src/vlm/apiRecognitionEngine.ts';

test('maps API grocery output to the three-field review contract', () => {
  const result = mapApiAnalysisResponse({
    analysis_id: 'analysis-1',
    input_type: 'grocery_photo',
    latency_ms: 2350,
    generation_attempts: 1,
    warnings: [],
    items: [{
      item_id: 'item-1',
      food_name: 'full cream milk',
      brand: 'Goodday',
      product_variant: null,
      category: 'dairy',
      quantity: 1,
      unit: 'carton',
      bounding_box: [100, 80, 520, 900],
      confidence: 0.91,
      review_required: false,
      review_reasons: [],
      packaging_text_evidence: ['Goodday', 'FULL CREAM MILK'],
      expiry_date_candidate: null,
      estimated_expiry_date: '2027-03-12',
      expiry_estimate_days: 180,
      expiry_estimate_basis: 'shelf-stable UHT milk',
    }],
  }, 'file:test.jpg');

  assert.equal(result.analysisId, 'analysis-1');
  assert.equal(result.inputType, 'grocery_photo');
  assert.equal(result.items[0]?.foodName, 'Goodday full cream milk');
  assert.equal(result.items[0]?.estimatedExpiryDate, '2027-03-12');
  assert.deepEqual(result.items[0]?.boundingBox, [100, 80, 520, 900]);
  assert.equal(result.timing.totalMs, 2350);
});

test('receipt mapping rejects unsafe item positions', () => {
  const result = mapApiAnalysisResponse({
    input_type: 'receipt',
    items: [{
      food_name: 'banana', category: 'fruit', quantity: 2, unit: 'piece',
      bounding_box: [-1, 0, 1100, 800], confidence: 0.8,
      review_required: false, review_reasons: [], packaging_text_evidence: ['BANANA X2'],
      estimated_expiry_date: '2026-09-18',
    }],
  }, 'file:receipt.jpg');

  assert.equal(result.inputType, 'receipt');
  assert.equal(result.items[0]?.boundingBox, null);
  assert.equal(result.items[0]?.reviewRequired, true);
  assert.ok(result.items[0]?.reviewReasons.includes('position_uncertain'));
});
