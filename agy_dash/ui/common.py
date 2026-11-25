"""Theme, formatting, and the shared request context. Framework-free."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pandas as pd

from .. import metrics, pricing, source
from ..config import Config

DARK = {
    "bg": "#141617",
    "panel_solid": "#1b1e20",
    "panel_alt": "#23272a",
    "border": "#33383b",
    "text": "#c7cdd1",
    "muted": "#a0aab0",
    "accent": "#78ddea",
    "fresh": "#8b99a6",
    "cached": "#527b85",
    "output": "#d3dbe1",
    "warn": "#e0b879",
    "bad": "#eea3a1",
    "cost": "#78ddea",
    "grid": "#33383b",
}

LIGHT = {
    "bg": "#f4f5f4",
    "panel_solid": "#ffffff",
    "panel_alt": "#edf0ef",
    "border": "#d8dedd",
    "text": "#414c50",
    "muted": "#555f63",
    "accent": "#006b7b",
    "fresh": "#697885",
    "cached": "#46747d",
    "output": "#a3afb6",
    "warn": "#845609",
    "bad": "#a63639",
    "cost": "#006b7b",
    "grid": "#d8dedd",
}

CURRENCY_SYMBOLS = {"INR": "₹", "USD": "$", "EUR": "€", "GBP": "£"}


def colors(theme: str) -> dict[str, str]:
    return LIGHT if str(theme).lower() == "light" else DARK


def currency_symbol(curr: str) -> str:
    return CURRENCY_SYMBOLS.get(curr.upper(), f"{curr} ")


def fmt_tokens(n: float | int | None) -> str:
    if n is None:
        return "-"
    n = float(n)
    if n >= 1e9:
        return f"{n / 1e9:.2f}B"
    if n >= 1e6:
        return f"{n / 1e6:.2f}M"
    if n >= 1e3:
        return f"{n / 1e3:.1f}K" if n < 1e5 else f"{n / 1e3:.0f}K"
    return f"{int(n):,}"


def fmt_money(val: float | None, curr: str = "INR") -> str:
    if val is None:
        return "-"
    sym = currency_symbol(curr)
    return f"{sym}{val:,.2f}"


def fmt_rate(val: float | None, curr: str = "INR") -> str:
    if val is None:
        return "-"
    sym = currency_symbol(curr)
    return f"{sym}{val:,.4f}/Mtok"


def fmt_pct(val: float | None, decimals: int = 1) -> str:
    if val is None:
        return "-"
    return f"{val * 100:.{decimals}f}%"


@dataclass
class Ctx:
    config: Config
    usage: source.UsageData
    sessions: pd.DataFrame
    daily: pd.DataFrame
    catalog: pricing.Catalog
    prices: pricing.PriceEntry
    model_id: str
    price_note: str | None
    currency: str
    usd_inr: float
    subscription_amount: float
    theme: str
    runner: Any
    overview: metrics.Overview

    def to_currency(self, usd: float) -> float:
        return metrics.currency_from_usd(usd, self.currency, self.usd_inr)

    def money(self, usd: float) -> str:
        return fmt_money(self.to_currency(usd), self.currency)


def build_ctx(
    config: Config,
    usage: source.UsageData,
    sessions: pd.DataFrame,
    daily: pd.DataFrame,
    catalog: pricing.Catalog,
    prices: pricing.PriceEntry,
    model_id: str,
    price_note: str | None,
    currency: str,
    usd_inr: float,
    subscription_amount: float,
    theme: str,
    runner: Any,
) -> Ctx:
    overview = metrics.update_overview(
        sessions, daily, prices,
        currency=currency, usd_inr=usd_inr,
        subscription_amount=subscription_amount,
        model_name=prices.name, price_note=price_note,
    )
    return Ctx(
        config=config, usage=usage, sessions=sessions, daily=daily,
        catalog=catalog, prices=prices, model_id=model_id, price_note=price_note,
        currency=currency, usd_inr=usd_inr, subscription_amount=subscription_amount,
        theme=theme, runner=runner, overview=overview,
    )
