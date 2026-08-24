"""
PMFBY claim passbook generator.

Compiles farmer identity, GPS field boundary, pre/post-event NDVI, weather
anomaly logs and a damage assessment into a single official-format PDF the
farmer can hand to the insurance surveyor — collapsing a months-long manual
ground-assessment cycle into one click.
"""
from __future__ import annotations

import io
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether,
)

BRAND = colors.HexColor("#1B7A43")
BRAND_LIGHT = colors.HexColor("#E8F4EC")
INK = colors.HexColor("#1A1A1A")
MUTED = colors.HexColor("#5A5A5A")
DANGER = colors.HexColor("#B3261E")


def _styles() -> Dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle("t", parent=base["Title"], fontName="Helvetica-Bold",
                                fontSize=17, textColor=BRAND, alignment=TA_CENTER, spaceAfter=2),
        "subtitle": ParagraphStyle("st", parent=base["Normal"], fontName="Helvetica",
                                   fontSize=9.5, textColor=MUTED, alignment=TA_CENTER, spaceAfter=10),
        "h2": ParagraphStyle("h2", parent=base["Heading2"], fontName="Helvetica-Bold",
                             fontSize=11.5, textColor=BRAND, spaceBefore=11, spaceAfter=5),
        "body": ParagraphStyle("b", parent=base["Normal"], fontName="Helvetica",
                               fontSize=9.2, textColor=INK, leading=13, alignment=TA_LEFT),
        "small": ParagraphStyle("s", parent=base["Normal"], fontName="Helvetica",
                                fontSize=7.6, textColor=MUTED, leading=10),
        "verdict": ParagraphStyle("v", parent=base["Normal"], fontName="Helvetica-Bold",
                                  fontSize=10.5, textColor=DANGER, leading=14),
    }


def _kv_table(rows: List[List[str]], col_widths: Optional[List[float]] = None) -> Table:
    widths = col_widths or [52 * mm, 118 * mm]
    t = Table(rows, colWidths=widths, hAlign="LEFT")
    t.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTNAME", (1, 0), (1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("TEXTCOLOR", (0, 0), (0, -1), MUTED),
        ("TEXTCOLOR", (1, 0), (1, -1), INK),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("LINEBELOW", (0, 0), (-1, -2), 0.3, colors.HexColor("#E0E0E0")),
    ]))
    return t


def _grid_table(header: List[str], body: List[List[str]], widths: List[float]) -> Table:
    t = Table([header] + body, colWidths=widths, hAlign="LEFT", repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BRAND),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 8.2),
        ("ALIGN", (1, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#C8D8CD")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, BRAND_LIGHT]),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return t


def _classify_loss(pct: float) -> str:
    if pct >= 50:
        return "SEVERE — Category A (immediate survey warranted)"
    if pct >= 33:
        return "SIGNIFICANT — Category B (above PMFBY threshold)"
    if pct >= 15:
        return "MODERATE — Category C"
    return "MINOR — Category D (below typical indemnity threshold)"


def generate_pmfby_report(payload: Dict[str, Any]) -> bytes:
    st = _styles()
    org = os.getenv("PMFBY_ORG_NAME", "AgriSaarthi Digital Advisory")
    generated = datetime.now(timezone.utc).strftime("%d %b %Y, %H:%M UTC")
    ref = f"AGS-PMFBY-{datetime.now(timezone.utc).strftime('%Y%m%d')}-{abs(hash(str(payload))) % 100000:05d}"

    farmer = payload.get("farmer", {}) or {}
    farm = payload.get("farm", {}) or {}
    ndvi = payload.get("ndvi", {}) or {}
    weather_log: List[Dict[str, Any]] = payload.get("weather_anomalies", []) or []
    boundary: List[Dict[str, float]] = farm.get("boundary", []) or []

    pre = float(ndvi.get("pre_event_mean", 0.0) or 0.0)
    post = float(ndvi.get("post_event_mean", 0.0) or 0.0)
    drop_pct = ((pre - post) / pre * 100.0) if pre > 0 else 0.0
    loss_pct = float(payload.get("estimated_loss_pct") or drop_pct)

    buf = io.BytesIO()

    def _decorate(canvas, doc):  # header + footer on every page
        canvas.saveState()
        canvas.setFillColor(BRAND)
        canvas.rect(0, A4[1] - 14 * mm, A4[0], 14 * mm, stroke=0, fill=1)
        canvas.setFillColor(colors.white)
        canvas.setFont("Helvetica-Bold", 9)
        canvas.drawString(15 * mm, A4[1] - 9.5 * mm, "PMFBY CROP LOSS CLAIM PASSBOOK")
        canvas.setFont("Helvetica", 8)
        canvas.drawRightString(A4[0] - 15 * mm, A4[1] - 9.5 * mm, f"Ref: {ref}")

        canvas.setFillColor(MUTED)
        canvas.setFont("Helvetica", 7)
        canvas.drawString(15 * mm, 10 * mm,
                          f"{org} · Satellite-assisted assessment · Generated {generated}")
        canvas.drawRightString(A4[0] - 15 * mm, 10 * mm, f"Page {doc.page}")
        canvas.setStrokeColor(colors.HexColor("#DDDDDD"))
        canvas.line(15 * mm, 13 * mm, A4[0] - 15 * mm, 13 * mm)
        canvas.restoreState()

    doc = BaseDocTemplate(buf, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm,
                          topMargin=20 * mm, bottomMargin=16 * mm,
                          title=f"PMFBY Claim {ref}", author=org)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="main")
    doc.addPageTemplates([PageTemplate(id="std", frames=[frame], onPage=_decorate)])

    story: List[Any] = []

    story.append(Paragraph("Pradhan Mantri Fasal Bima Yojana", st["title"]))
    story.append(Paragraph("Crop Loss Intimation &amp; Evidence Passbook — for submission to the insurer / surveyor",
                           st["subtitle"]))

    # ── Farmer ──
    story.append(Paragraph("1. Farmer &amp; Policy Particulars", st["h2"]))
    story.append(_kv_table([
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
    story.append(_kv_table([
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
        story.append(_grid_table(["#", "Latitude", "Longitude"], rows, [16 * mm, 45 * mm, 45 * mm]))

    # ── Event ──
    story.append(Paragraph("3. Loss Event", st["h2"]))
    story.append(_kv_table([
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
    story.append(_grid_table(
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
        story.append(_grid_table(
            ["Date", "Parameter", "Observed", "Normal", "Deviation"],
            rows,
            [26 * mm, 42 * mm, 32 * mm, 28 * mm, 26 * mm],
        ))

    # ── Assessment ──
    story.append(Paragraph("6. Preliminary Assessment", st["h2"]))
    story.append(KeepTogether([
        _kv_table([
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
        ("TEXTCOLOR", (0, 1), (-1, 1), MUTED),
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

    doc.build(story)
    return buf.getvalue()