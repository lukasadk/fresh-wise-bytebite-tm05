"""Small Railway-friendly Pantry API used by the mobile demo.

This intentionally mirrors the subset of the FreshWise FastAPI contract that
the React Native app needs for a usable APK: users, pantry items, outcome logs,
and a few read-only support endpoints. It is not a replacement for the full
Postgres backend; it is a lightweight hosted store so the APK can run without
the older Railway service's unknown API key.
"""

from __future__ import annotations

import json
import threading
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field

from .config import PROJECT_ROOT


router = APIRouter(prefix="/v1")

_LOCK = threading.Lock()
_STORE_PATH = PROJECT_ROOT / "data" / "lightweight_pantry.json"


class UserIn(BaseModel):
    user_id: str | None = None
    household_size: int = Field(default=1, ge=1, le=20)
    location: str | None = None


class UserPatch(BaseModel):
    household_size: int | None = Field(default=None, ge=1, le=20)
    location: str | None = None


class PantryIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    category: str | None = None
    canonical_food_name: str | None = None
    barcode: str | None = None
    quantity: float = Field(default=1, gt=0)
    unit: str | None = None
    purchase_date: str | None = None
    expiry_date: str | None = None
    source: str = "manual"
    storage: str | None = None


class PantryPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    category: str | None = None
    canonical_food_name: str | None = None
    quantity: float | None = Field(default=None, gt=0)
    unit: str | None = None
    expiry_date: str | None = None
    storage: str | None = None
    status: str | None = None


class OutcomeIn(BaseModel):
    item_id: str
    status: str
    quantity: float = Field(gt=0)
    waste_reason: str | None = None
    notes: str | None = None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _today() -> date:
    return datetime.now(timezone.utc).date()


def _device_id(request: Request) -> str:
    return (
        request.headers.get("X-Device-Id")
        or request.headers.get("x-device-id")
        or "anonymous-device"
    )


def _load() -> dict[str, Any]:
    if not _STORE_PATH.is_file():
        return {"users": {}, "pantry": {}, "logs": []}
    try:
        payload = json.loads(_STORE_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        payload = {}
    return {
        "users": dict(payload.get("users") or {}),
        "pantry": dict(payload.get("pantry") or {}),
        "logs": list(payload.get("logs") or []),
    }


def _save(payload: dict[str, Any]) -> None:
    _STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = _STORE_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(_STORE_PATH)


def _default_user(user_id: str, household_size: int = 1, location: str | None = None) -> dict[str, Any]:
    return {
        "user_id": user_id,
        "household_size": household_size,
        "location": location,
        "risk_score": "low",
        "created_at": _now(),
        "push_token": None,
    }


def _ensure_user(payload: dict[str, Any], request: Request) -> dict[str, Any]:
    user_id = _device_id(request)
    users = payload["users"]
    if user_id not in users:
        users[user_id] = _default_user(user_id)
    return users[user_id]


def _days_to_expiry(expiry_date: str | None) -> int | None:
    if not expiry_date:
        return None
    try:
        return (date.fromisoformat(expiry_date) - _today()).days
    except ValueError:
        return None


def _normalize_source(source: str | None) -> str:
    return source if source in {"manual", "barcode", "photo"} else "manual"


def _normalize_status(value: str | None) -> str:
    return value if value in {"active", "partially_used", "consumed", "wasted"} else "active"


def _public_item(item: dict[str, Any]) -> dict[str, Any]:
    copy = dict(item)
    copy["days_to_expiry"] = _days_to_expiry(copy.get("expiry_date"))
    return copy


def _get_item_for_user(payload: dict[str, Any], user_id: str, item_id: str) -> dict[str, Any]:
    item = payload["pantry"].get(item_id)
    if not item or item.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="Pantry item not found.")
    return item


@router.post("/users")
def create_user(body: UserIn, request: Request) -> dict[str, Any]:
    with _LOCK:
        payload = _load()
        user_id = body.user_id or _device_id(request)
        user = payload["users"].get(user_id)
        if not user:
            user = _default_user(user_id, body.household_size, body.location)
            payload["users"][user_id] = user
            _save(payload)
        return user


@router.get("/users/me")
def get_me(request: Request) -> dict[str, Any]:
    with _LOCK:
        payload = _load()
        user = _ensure_user(payload, request)
        _save(payload)
        return user


@router.patch("/users/me")
def patch_me(body: UserPatch, request: Request) -> dict[str, Any]:
    with _LOCK:
        payload = _load()
        user = _ensure_user(payload, request)
        if body.household_size is not None:
            user["household_size"] = body.household_size
        if body.location is not None:
            user["location"] = body.location
        _save(payload)
        return user


@router.delete("/users/me", status_code=status.HTTP_204_NO_CONTENT)
def delete_me(request: Request) -> Response:
    with _LOCK:
        payload = _load()
        user_id = _device_id(request)
        payload["users"].pop(user_id, None)
        payload["pantry"] = {
            item_id: item
            for item_id, item in payload["pantry"].items()
            if item.get("user_id") != user_id
        }
        payload["logs"] = [log for log in payload["logs"] if log.get("user_id") != user_id]
        _save(payload)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/pantry")
def list_pantry(
    request: Request,
    status_filter: str | None = Query(default=None, alias="status"),
    expiring_within_days: int | None = Query(default=None, ge=0, le=3650),
) -> list[dict[str, Any]]:
    with _LOCK:
        payload = _load()
        user = _ensure_user(payload, request)
        items = [
            _public_item(item)
            for item in payload["pantry"].values()
            if item.get("user_id") == user["user_id"]
        ]
        if status_filter:
            items = [item for item in items if item.get("status") == status_filter]
        else:
            items = [
                item
                for item in items
                if item.get("status") in {"active", "partially_used"}
            ]
        if expiring_within_days is not None:
            items = [
                item
                for item in items
                if item.get("days_to_expiry") is not None
                and item["days_to_expiry"] <= expiring_within_days
            ]
        items.sort(key=lambda item: (item.get("days_to_expiry") is None, item.get("days_to_expiry") or 99999, item["name"].lower()))
        _save(payload)
        return items


@router.post("/pantry", status_code=status.HTTP_201_CREATED)
def create_pantry_item(body: PantryIn, request: Request) -> dict[str, Any]:
    with _LOCK:
        payload = _load()
        user = _ensure_user(payload, request)
        item_id = str(uuid4())
        item = {
            "item_id": item_id,
            "user_id": user["user_id"],
            "name": body.name.strip(),
            "category": body.category,
            "canonical_food_name": body.canonical_food_name or body.name.strip().lower(),
            "barcode": body.barcode,
            "quantity": float(body.quantity),
            "unit": body.unit,
            "purchase_date": body.purchase_date or _today().isoformat(),
            "expiry_date": body.expiry_date,
            "source": _normalize_source(body.source),
            "status": "active",
            "storage": body.storage,
            "created_at": _now(),
        }
        payload["pantry"][item_id] = item
        _save(payload)
        return _public_item(item)


@router.get("/pantry/{item_id}")
def get_pantry_item(item_id: str, request: Request) -> dict[str, Any]:
    with _LOCK:
        payload = _load()
        user = _ensure_user(payload, request)
        return _public_item(_get_item_for_user(payload, user["user_id"], item_id))


@router.patch("/pantry/{item_id}")
def patch_pantry_item(item_id: str, body: PantryPatch, request: Request) -> dict[str, Any]:
    with _LOCK:
        payload = _load()
        user = _ensure_user(payload, request)
        item = _get_item_for_user(payload, user["user_id"], item_id)
        patch = body.model_dump(exclude_unset=True)
        for key, value in patch.items():
            if key == "name" and isinstance(value, str):
                item[key] = value.strip()
                item.setdefault("canonical_food_name", value.strip().lower())
            elif key == "status":
                item[key] = _normalize_status(value)
            else:
                item[key] = value
        _save(payload)
        return _public_item(item)


@router.delete("/pantry/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_pantry_item(item_id: str, request: Request) -> Response:
    with _LOCK:
        payload = _load()
        user = _ensure_user(payload, request)
        _get_item_for_user(payload, user["user_id"], item_id)
        payload["pantry"].pop(item_id, None)
        _save(payload)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/logs", status_code=status.HTTP_201_CREATED)
def create_log(body: OutcomeIn, request: Request) -> dict[str, Any]:
    if body.status not in {"consumed", "wasted"}:
        raise HTTPException(status_code=422, detail="status must be consumed or wasted.")
    with _LOCK:
        payload = _load()
        user = _ensure_user(payload, request)
        item = _get_item_for_user(payload, user["user_id"], body.item_id)
        logged_quantity = min(float(body.quantity), float(item.get("quantity") or 0))
        remaining = max(0.0, float(item.get("quantity") or 0) - logged_quantity)
        item["quantity"] = remaining if remaining > 0 else logged_quantity
        item["status"] = "partially_used" if remaining > 0 else body.status
        log = {
            "log_id": str(uuid4()),
            "user_id": user["user_id"],
            "item_id": body.item_id,
            "status": body.status,
            "quantity": logged_quantity,
            "waste_reason": body.waste_reason if body.status == "wasted" else None,
            "notes": body.notes,
            "logged_at": _now(),
            "item_name": item.get("name"),
            "item_unit": item.get("unit"),
        }
        payload["logs"].append(log)
        _save(payload)
        return {k: v for k, v in log.items() if k != "user_id"}


@router.get("/logs")
def list_logs(
    request: Request,
    item_id: str | None = None,
    status_filter: str | None = Query(default=None, alias="status"),
) -> list[dict[str, Any]]:
    with _LOCK:
        payload = _load()
        user = _ensure_user(payload, request)
        logs = [log for log in payload["logs"] if log.get("user_id") == user["user_id"]]
        if item_id:
            logs = [log for log in logs if log.get("item_id") == item_id]
        if status_filter:
            logs = [log for log in logs if log.get("status") == status_filter]
        return [{k: v for k, v in log.items() if k != "user_id"} for log in logs]


@router.get("/dashboard/summary")
def dashboard_summary(request: Request, days: int = Query(default=30, ge=1, le=3650)) -> dict[str, Any]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    with _LOCK:
        payload = _load()
        user = _ensure_user(payload, request)
        logs = [
            log
            for log in payload["logs"]
            if log.get("user_id") == user["user_id"]
            and datetime.fromisoformat(str(log["logged_at"]).replace("Z", "+00:00")) >= cutoff
        ]
        wasted = [log for log in logs if log.get("status") == "wasted"]
        consumed = [log for log in logs if log.get("status") == "consumed"]
        total_wasted = sum(float(log.get("quantity") or 0) for log in wasted)
        total_consumed = sum(float(log.get("quantity") or 0) for log in consumed)
        denominator = total_wasted + total_consumed
        return {
            "range_days": days,
            "total_wasted_events": len(wasted),
            "total_wasted_quantity": total_wasted,
            "total_consumed_events": len(consumed),
            "total_consumed_quantity": total_consumed,
            "waste_rate": (total_wasted / denominator) if denominator else None,
            "top_waste_reasons": [],
        }


@router.get("/dashboard/weekly-waste")
def weekly_waste(_: Request, weeks: int = Query(default=12, ge=1, le=104)) -> list[dict[str, Any]]:
    today = _today()
    return [
        {
            "week_start": (today - timedelta(days=today.weekday() + 7 * offset)).isoformat(),
            "waste_reason": None,
            "waste_events": 0,
            "total_quantity_wasted": 0,
        }
        for offset in range(weeks)
    ]


@router.get("/recipes/recommendations")
def legacy_recipe_recommendations() -> list[dict[str, Any]]:
    return []


@router.get("/recipes/{recipe_id}")
def legacy_recipe_detail(recipe_id: str) -> dict[str, Any]:
    return {"recipe_id": recipe_id, "recipe_name": None, "steps": None}


@router.get("/diet-preferences")
def list_diet_preferences() -> list[dict[str, Any]]:
    return []


@router.post("/diet-preferences", status_code=status.HTTP_201_CREATED)
def add_diet_preference(body: dict[str, Any]) -> dict[str, Any]:
    return {"preference_id": str(uuid4()), **body}


@router.delete("/diet-preferences/{preference_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_diet_preference(preference_id: str) -> Response:
    del preference_id
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/reference/foodkeeper")
def reference_foodkeeper() -> list[dict[str, Any]]:
    return []


@router.get("/reference/price")
def reference_price() -> list[dict[str, Any]]:
    return []


@router.get("/reference/price/by-state")
def reference_price_by_state() -> list[dict[str, Any]]:
    return []


@router.get("/reference/product")
def search_products() -> list[dict[str, Any]]:
    return []


@router.get("/reference/product/{barcode}")
def lookup_product(barcode: str) -> dict[str, Any]:
    raise HTTPException(status_code=404, detail=f"Product {barcode} was not found.")
