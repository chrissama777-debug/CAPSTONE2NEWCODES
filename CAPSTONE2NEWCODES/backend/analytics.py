from __future__ import annotations

import random
from datetime import datetime

import numpy as np

from .models import Phone

MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
FUTURE_LABELS = ["Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def build_price_trend(phone_id: int) -> dict:
    phone = Phone.query.get_or_404(phone_id)
    historical_prices = _synthetic_history(phone.price)
    historical_labels = MONTH_LABELS[: len(historical_prices)]

    try:
        from sklearn.linear_model import LinearRegression
    except Exception:
        predicted_prices = _fallback_forecast(historical_prices)
    else:
        x = np.arange(len(historical_prices)).reshape(-1, 1)
        y = np.array(historical_prices)
        model = LinearRegression()
        model.fit(x, y)
        future_x = np.arange(len(historical_prices), len(historical_prices) + 6).reshape(-1, 1)
        predicted_prices = model.predict(future_x).tolist()

    predicted_prices = [round(max(0, value), 2) for value in predicted_prices]
    historical_prices = [round(value, 2) for value in historical_prices]

    return {
        "phone_name": phone.name,
        "historical_labels": historical_labels,
        "historical_prices": historical_prices,
        "predicted_labels": FUTURE_LABELS,
        "predicted_prices": predicted_prices,
        "current_price": phone.price,
        "lowest_recorded": min(historical_prices),
        "predicted_in_6_months": predicted_prices[-1] if predicted_prices else phone.price,
        "insight": _trend_insight(historical_prices, predicted_prices),
    }


def _synthetic_history(base_price: float) -> list[float]:
    prices = []
    current = float(base_price)
    for _ in range(12):
        drift = random.uniform(-0.05, 0.05)
        current = max(1, current * (1 + drift))
        prices.append(current)
    return prices


def _fallback_forecast(history: list[float]) -> list[float]:
    x = np.arange(len(history))
    slope = (history[-1] - history[0]) / max(1, len(history) - 1)
    return [history[-1] + slope * step for step in range(1, 7)]


def _trend_insight(history: list[float], predicted: list[float]) -> str:
    direction = "rising" if predicted and predicted[-1] > history[-1] else "softening"
    volatility = max(history) - min(history)
    return f"The modeled price trend is {direction} with an observed range of ${volatility:.2f} across the last 12 months."
