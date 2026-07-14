from __future__ import annotations

from math import isfinite

from .models import Phone


def _safe_divide(numerator: float, denominator: float) -> float:
    if not denominator:
        return 0.0
    value = numerator / denominator
    return value if isfinite(value) else 0.0


def recommend_phones(*, budget: float, min_ram: int, min_storage: int, min_battery: int, camera_priority: int, performance_priority: int, brand_preference: str | None = None, limit: int = 10) -> list[dict]:
    phones = Phone.query.all()
    if not phones:
        return []

    filtered = []
    for phone in phones:
        if phone.price > budget:
            continue
        if phone.ram < min_ram or phone.storage < min_storage or phone.battery < min_battery:
            continue
        if brand_preference and phone.brand.lower() != brand_preference.lower():
            continue
        filtered.append(phone)

    if not filtered:
        return []

    max_camera = max(phone.camera for phone in phones) or 1
    max_battery = max(phone.battery for phone in phones) or 1

    scored = []
    for phone in filtered:
        price_score = max(0.0, 1 - _safe_divide(phone.price, budget))
        camera_score = _safe_divide(phone.camera, max_camera)
        battery_score = _safe_divide(phone.battery, max_battery)
        performance_score = _safe_divide(phone.performance_score, 10)
        total_score = (
            price_score * 0.30
            + camera_score * (camera_priority / 5) * 0.25
            + battery_score * 0.20
            + performance_score * (performance_priority / 5) * 0.25
        )
        scored.append({**phone.to_dict(), "similarity_score": round(total_score * 100, 2)})

    scored.sort(key=lambda item: item["similarity_score"], reverse=True)
    return scored[:limit]
