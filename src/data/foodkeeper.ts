// Storage guidance lookups against GET /v1/reference/foodkeeper (public, no
// X-Device-Id needed -- see backend/backend/app/routers/reference.py). This data
// isn't stored per pantry item at all; it's looked up live by name/category every
// time Food Detail is opened.
import { api } from './api';

export type FoodkeeperStorage = {
  foodkeeperId: number;
  canonicalFoodName: string;
  categoryName: string | null;
  name: string | null;
  pantryTips: string | null;
  refrigerateTips: string | null;
  freezeTips: string | null;
};

type BackendFoodkeeperStorage = {
  foodkeeper_id: number;
  canonical_food_name: string;
  category_name: string | null;
  name: string | null;
  pantry_tips: string | null;
  refrigerate_tips: string | null;
  freeze_tips: string | null;
};

function fromBackend(raw: BackendFoodkeeperStorage): FoodkeeperStorage {
  return {
    foodkeeperId: raw.foodkeeper_id,
    canonicalFoodName: raw.canonical_food_name,
    categoryName: raw.category_name,
    name: raw.name,
    pantryTips: raw.pantry_tips,
    refrigerateTips: raw.refrigerate_tips,
    freezeTips: raw.freeze_tips,
  };
}

// Tries the item's own name first (most specific), falling back to its category
// (broader, more likely to match something). Returns the first match, or null if
// neither query finds anything -- matching is exact-ish on the backend, so a lot of
// free-text item names won't hit.
export async function getStorageGuidance(name: string, category: string): Promise<FoodkeeperStorage | null> {
  for (const query of [name, category]) {
    if (!query) continue;
    const results = await api.get<BackendFoodkeeperStorage[]>(
      `/v1/reference/foodkeeper?canonical_food_name=${encodeURIComponent(query.toLowerCase().trim())}`
    );
    if (results.length > 0) return fromBackend(results[0]);
  }
  return null;
}