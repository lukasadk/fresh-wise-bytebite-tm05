/** Compact schema for the experimental 2B offline model. */
export const GROCERY_PHOTO_PROMPT = `Inspect this one photo and return only visible food or drink items.

Return one valid minified JSON object with one top-level key named items and nothing else.
Every item object must use exactly these keys: food_name, brand, product_variant, net_content_text, category, quantity, unit, confidence, review_required, packaging_text_evidence, expiry_date_candidate, expiry_text_evidence.

Rules:
1. Output only visible groceries. Do not add likely or related items.
   If a food package or loose food is clearly visible, include it even when OCR is unreadable; use a conservative visual name such as milk, apple, or packaged food and keep uncertain packaging fields null.
2. quantity is the visible number of physical units. Use null if uncertain.
3. brand, product_variant and net_content_text are allowed only when the exact printed words are readable and copied into packaging_text_evidence. Otherwise use null. Never estimate weight, volume or pack size. For loose fruit or vegetables these fields must normally be null.
4. unit must be one of piece, pack, bag, box, bottle, can, jar, bunch, tray, carton, kg, g, L, mL, unknown.
5. Never infer an expiry date. Use a date only when its expiry/use-by/best-before label and date are both clearly readable; copy that exact text into expiry_text_evidence. Otherwise both expiry fields are null.
6. food_name and category must describe the actual visible item. Never output placeholder words such as name, category, string, value, or example.
7. Set review_required to true for every item. Do not repeat item objects. Close every quote, array and object.
8. If no grocery can be identified, return {"items":[]}.`;

export const OFFLINE_MAX_NEW_TOKENS = 512;
export const OFFLINE_MAX_IMAGE_EDGE = 512;
