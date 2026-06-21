"""
AI-style recommendation engine for layer search results.

Uses category affinity, keyword overlap, tag similarity, and PostGIS distance
to rank curated POIs and stored OSM POIs. Optionally enriches reasons via OpenAI
when OPENAI_API_KEY is set.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any

CATEGORY_AFFINITY: dict[str, dict[str, float]] = {
    "heritage": {
        "temple": 0.95, "attraction": 0.9, "park": 0.65, "hotel": 0.5,
        "restaurant": 0.55, "shopping": 0.45, "adventure": 0.4,
    },
    "temple": {
        "heritage": 0.95, "attraction": 0.75, "park": 0.55, "hotel": 0.5,
        "restaurant": 0.5, "shopping": 0.4, "adventure": 0.35,
    },
    "attraction": {
        "heritage": 0.85, "temple": 0.7, "park": 0.75, "hotel": 0.65,
        "restaurant": 0.7, "shopping": 0.65, "adventure": 0.6,
    },
    "hotel": {
        "restaurant": 0.85, "attraction": 0.7, "shopping": 0.65, "park": 0.55,
        "heritage": 0.5, "temple": 0.45, "adventure": 0.5,
    },
    "restaurant": {
        "hotel": 0.8, "shopping": 0.7, "attraction": 0.65, "park": 0.5,
        "heritage": 0.45, "temple": 0.4, "adventure": 0.35,
    },
    "park": {
        "attraction": 0.75, "heritage": 0.6, "adventure": 0.7, "hotel": 0.45,
        "restaurant": 0.5, "temple": 0.5, "shopping": 0.4,
    },
    "adventure": {
        "park": 0.85, "attraction": 0.7, "hotel": 0.55, "restaurant": 0.5,
        "heritage": 0.45, "temple": 0.35, "shopping": 0.4,
    },
    "shopping": {
        "restaurant": 0.8, "attraction": 0.65, "hotel": 0.6, "heritage": 0.5,
        "temple": 0.45, "park": 0.4, "adventure": 0.35,
    },
}

STOP_WORDS = {
    "the", "a", "an", "and", "or", "in", "on", "at", "to", "for", "of", "with",
    "kathmandu", "lalitpur", "bhaktapur", "nepal", "valley", "district",
}


def tokenize(text: str | None) -> set[str]:
    if not text:
        return set()
    tokens = re.findall(r"[a-z0-9]+", text.lower())
    return {t for t in tokens if len(t) > 2 and t not in STOP_WORDS}


def keyword_overlap(query: str | None, *texts: str | None) -> float:
    q = tokenize(query)
    if not q:
        return 0.0
    corpus = set()
    for text in texts:
        corpus |= tokenize(text)
    if not corpus:
        return 0.0
    return len(q & corpus) / len(q)


def category_affinity(source_categories: set[str], candidate_category: str) -> float:
    if not source_categories:
        return 0.5
    if candidate_category in source_categories:
        return 1.0
    best = 0.0
    for src in source_categories:
        best = max(best, CATEGORY_AFFINITY.get(src, {}).get(candidate_category, 0.25))
    return best


def distance_score(distance_m: float | None, max_m: float = 8000.0) -> float:
    if distance_m is None:
        return 0.35
    if distance_m <= 500:
        return 1.0
    if distance_m >= max_m:
        return 0.1
    return max(0.1, 1.0 - (distance_m / max_m))


def build_reason(candidate: dict[str, Any], search_value: str | None, source_categories: set[str]) -> str:
    cat = candidate.get("category", "")
    name = candidate.get("name", "this place")
    dist = candidate.get("distance_m")
    dist_txt = f" ({round(dist)} m away)" if dist is not None else ""

    if search_value and keyword_overlap(search_value, name, candidate.get("description")) >= 0.5:
        return f"Matches your search for “{search_value}”{dist_txt}."
    if cat in source_categories:
        return f"Similar {cat} spot near your selection{dist_txt}."
    if source_categories:
        src = next(iter(source_categories))
        return f"Popular {cat} option for visitors exploring {src} areas{dist_txt}."
    return f"Recommended {cat}: {name}{dist_txt}."


def score_candidate(
    candidate: dict[str, Any],
    *,
    search_value: str | None,
    source_categories: set[str],
) -> float:
    cat_score = category_affinity(source_categories, candidate.get("category", ""))
    text_score = keyword_overlap(
        search_value,
        candidate.get("name"),
        candidate.get("description"),
        candidate.get("address"),
        json.dumps(candidate.get("tags") or {}),
    )
    dist_score = distance_score(candidate.get("distance_m"))
    rating = candidate.get("rating")
    rating_score = min(float(rating or 3.5) / 5.0, 1.0) if rating else 0.55
    source_bonus = 0.08 if candidate.get("data_source") == "osm_pois" else 0.0

    return round(
        cat_score * 0.32
        + text_score * 0.28
        + dist_score * 0.22
        + rating_score * 0.13
        + source_bonus
        + 0.05,
        4,
    )


def rank_recommendations(
    candidates: list[dict[str, Any]],
    *,
    search_value: str | None,
    source_categories: set[str],
    limit: int = 5,
) -> list[dict[str, Any]]:
    seen: set[str] = set()
    scored: list[dict[str, Any]] = []

    for cand in candidates:
        key = f"{cand.get('data_source')}:{cand.get('id')}"
        if key in seen:
            continue
        seen.add(key)
        score = score_candidate(cand, search_value=search_value, source_categories=source_categories)
        scored.append({
            **cand,
            "rec_score": round(min(score * 10, 10.0), 1),
            "reason": build_reason(cand, search_value, source_categories),
        })

    scored.sort(key=lambda r: (r["rec_score"], -(r.get("distance_m") or 99999)), reverse=True)
    return scored[:limit]


def maybe_enrich_with_openai(recommendations: list[dict[str, Any]], search_context: dict[str, Any]) -> list[dict[str, Any]]:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key or not recommendations:
        return recommendations

    try:
        from urllib.request import Request, urlopen

        payload = {
            "model": os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are a Kathmandu Valley tourism assistant. "
                        "Rewrite each recommendation reason in one friendly sentence for tourists. "
                        "Return JSON array of strings only, same order as input."
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps({
                        "search": search_context,
                        "places": [{"name": r["name"], "category": r["category"], "reason": r["reason"]} for r in recommendations],
                    }),
                },
            ],
            "temperature": 0.4,
        }
        req = Request(
            "https://api.openai.com/v1/chat/completions",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            method="POST",
        )
        with urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        content = data["choices"][0]["message"]["content"].strip()
        if content.startswith("```"):
            content = re.sub(r"^```(?:json)?|```$", "", content, flags=re.MULTILINE).strip()
        reasons = json.loads(content)
        if isinstance(reasons, list) and len(reasons) == len(recommendations):
            for i, reason in enumerate(reasons):
                if isinstance(reason, str) and reason.strip():
                    recommendations[i]["reason"] = reason.strip()
            recommendations[0]["ai_enriched"] = True
    except Exception:
        pass

    return recommendations
