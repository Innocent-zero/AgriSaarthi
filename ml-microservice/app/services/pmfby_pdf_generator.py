"""
PMFBY claim passbook — one template built on pdf_report_base.

Compiles farmer identity, GPS field boundary, pre/post-event NDVI, weather
anomaly logs and a damage assessment into a single official-format PDF the
farmer can hand to the insurance surveyor — collapsing a months-long manual
ground-assessment cycle into one click.

This module owns only PMFBY-specific things: section content, field
labels, and loss-severity classification. Page layout, styles, tables,
and the branded header/footer all live in pdf_report_base.py and are
shared with any future report template.
"""
from __future__ import annotations

import os
from typing import Any, Dict, List

from reportlab.platypus import Paragraph, Spacer, Table, TableStyle, KeepTogether
from reportlab.lib.units import mm

from app.services.pdf_report_base import (
    DEFAULT_THEME, build_styles, kv_table, grid_table, render_pdf, make_ref,
)


def _classify_loss(pct: float) -> str:
    if pct >= 50:
        return "SEVERE — Category A (immediate survey warranted)"
    if pct >= 33:
        return "SIGNIFICANT — Category B (above PMFBY threshold)"
    if pct >= 15:
        return "MODERATE — Category C"
    return "MINOR — Category D (below typical indemnity threshold)"


def generate_pmfby_report(payload: Dict[str, Any]) -> bytes:
    st = build_styles()
    org = os.getenv("PMFBY_ORG_NAME", "AgriSaarthi Digital Advisory")
    ref = make_ref("AGS-PMFBY", payload)

    farmer = payload.get("farmer", {}) or {}
    farm = payload.get("farm", {}) or {}
    ndvi = payload.get("ndvi", {}) or {}
    weather_log: List[Dict[str, Any]] = payload.get("weather_anomalies", []) or []
    boundary: List[Dict[str, float]] = farm.get("boundary", []) or []

    pre = float(ndvi.get("pre_event_mean", 0.0) or 0.0)
    post = float(ndvi.get("post_event_mean", 0.0) or 0.0)
    drop_pct = ((pre - post) / pre * 100.0) if pre > 0 else 0.0
    loss_pct = float(payload.get("estimated_loss_pct") or drop_pct)

    story: List[Any] = []

    story.append(Paragraph("Pradhan Mantri Fasal Bima Yojana", st["title"]))
    story.append(Paragraph("Crop Loss Intimation &amp; Evidence Passbook — for submission to the insurer / surveyor",
                           st["subtitle"]))

    # ── Farmer ──
    story.append(Paragraph("1. Farmer &amp; Policy Particulars", st["h2"]))
    story.append(kv_table([
        ["Farmer name", str(farmer.get("name", "—"))],
        ["Father / Spouse", str(farmer.get("guardian", "—"))],
        ["Mobile", str(farmer.get("phone", "—"))],
        ["Aadhaar (masked)", str(farmer.get("aadhaar_masked", "—"))],
        ["Bank account (masked)", str(farmer.get("bank_masked", "—"))],
        ["Policy / Application no.", str(farmer.get("policy_no", "—"))],
        ["Village / Block", f"{farmer.get('village', '—')} / {farmer.get('block', '—')}"],
        ["District / State", f"{farmer.get('district', '—')} / {farmer.get('state', '—')}"],
    ]))

    # ── Farm ──
    story.append(Paragraph("2. Insured Field Particulars", st["h2"]))
    story.append(kv_table([
        ["Survey / Khasra no.", str(farm.get("survey_no", "—"))],
        ["Crop &amp; variety", f"{farm.get('crop', '—')} ({farm.get('variety', '—')})"],
        ["Season", str(farm.get("season", "—"))],
        ["Sown area", f"{farm.get('area_ha', '—')} hectares"],
        ["Sowing date", str(farm.get("sowing_date", "—"))],
        ["Field centroid", f"{farm.get('lat', '—')}, {farm.get('lon', '—')}"],
        ["Irrigation source", str(farm.get("irrigation", "—"))],
    ]))

    if boundary:
        rows = [[str(i + 1), f"{p.get('lat', 0):.6f}", f"{p.get('lon', 0):.6f}"]
                for i, p in enumerate(boundary[:12])]
        story.append(Spacer(1, 5))
        story.append(Paragraph("GPS boundary vertices (WGS-84, captured in-app):", st["body"]))
        story.append(Spacer(1, 3))
        story.append(grid_table(["#", "Latitude", "Longitude"], rows, [16 * mm, 45 * mm, 45 * mm]))

    # ── Event ──
    story.append(Paragraph("3. Loss Event", st["h2"]))
    story.append(kv_table([
        ["Cause of loss", str(payload.get("cause", "—"))],
        ["Date of occurrence", str(payload.get("event_date", "—"))],
        ["Reported within 72 hrs", "Yes" if payload.get("reported_within_72h", True) else "No"],
        ["Affected area", f"{payload.get('affected_area_ha', '—')} hectares"],
        ["Farmer's description", str(payload.get("description", "—"))],
    ]))

    # ── Satellite evidence ──
    story.append(Paragraph("4. Satellite Vegetation Evidence (Sentinel-2 NDVI)", st["h2"]))
    ndvi_rows = [[
        str(ndvi.get("pre_event_date", "—")),
        f"{pre:.3f}",
        str(ndvi.get("post_event_date", "—")),
        f"{post:.3f}",
        f"{drop_pct:.1f}%",
    ]]
    story.append(grid_table(
        ["Pre-event date", "Pre NDVI", "Post-event date", "Post NDVI", "Decline"],
        ndvi_rows,
        [34 * mm, 26 * mm, 36 * mm, 26 * mm, 26 * mm],
    ))
    story.append(Spacer(1, 5))
    story.append(Paragraph(
        f"NDVI (Normalised Difference Vegetation Index) fell from {pre:.3f} to {post:.3f}, "
        f"a decline of {drop_pct:.1f}%. Values were computed as the field-polygon mean from "
        f"cloud-masked Sentinel-2 L2A imagery. A decline beyond 30% over a fortnight during the "
        f"vegetative or reproductive stage is materially inconsistent with normal phenology and "
        f"corroborates the reported damage.",
        st["body"],
    ))

    # ── Weather ──
    if weather_log:
        story.append(Paragraph("5. Weather Anomaly Log", st["h2"]))
        rows = [[
            str(e.get("date", "—")),
            str(e.get("parameter", "—")),
            str(e.get("observed", "—")),
            str(e.get("normal", "—")),
            str(e.get("deviation", "—")),
        ] for e in weather_log[:14]]
        story.append(grid_table(
            ["Date", "Parameter", "Observed", "Normal", "Deviation"],
            rows,
            [26 * mm, 42 * mm, 32 * mm, 28 * mm, 26 * mm],
        ))

    # ── Assessment ──
    story.append(Paragraph("6. Preliminary Assessment", st["h2"]))
    story.append(KeepTogether([
        kv_table([
            ["Estimated crop loss", f"{loss_pct:.1f}%"],
            ["Loss category", _classify_loss(loss_pct)],
            ["Sum insured (declared)", f"INR {payload.get('sum_insured_inr', '—')}"],
            ["Indicative claim", f"INR {payload.get('indicative_claim_inr', '—')}"],
        ]),
        Spacer(1, 6),
        Paragraph(
            f"Indicative loss of {loss_pct:.1f}% — {_classify_loss(loss_pct)}. "
            "This is a decision-support estimate, not a final settlement figure.",
            st["verdict"],
        ),
    ]))

    # ── Declaration ──
    story.append(Paragraph("7. Declaration &amp; Signatures", st["h2"]))
    story.append(Paragraph(
        "I declare that the particulars furnished above are true to the best of my knowledge and that "
        "the loss described has genuinely occurred on the insured field. I understand that a false "
        "declaration may lead to rejection of the claim and recovery of any amount paid.",
        st["body"],
    ))
    story.append(Spacer(1, 16))
    sig = Table([
        ["___________________________", "___________________________", "___________________________"],
        ["Farmer / Insured", "Village Revenue Officer", "Insurance Surveyor"],
    ], colWidths=[56 * mm, 56 * mm, 56 * mm])
    sig.setStyle(TableStyle([
        ("FONTNAME", (0, 1), (-1, 1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("TEXTCOLOR", (0, 1), (-1, 1), DEFAULT_THEME.muted),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("TOPPADDING", (0, 1), (-1, 1), 3),
    ]))
    story.append(sig)

    story.append(Spacer(1, 12))
    story.append(Paragraph(
        f"Disclaimer: This passbook is generated by {org} from open satellite and meteorological data as a "
        "decision-support aid. It does not constitute an insurance assessment or a guarantee of settlement. "
        "Final indemnity is determined by the empanelled insurer under PMFBY operational guidelines. "
        f"Document reference {ref}.",
        st["small"],
    ))

    return render_pdf(story=story, doc_title="PMFBY CROP LOSS CLAIM PASSBOOK", ref=ref, org=org,
                       footer_note="Satellite-assisted assessment")