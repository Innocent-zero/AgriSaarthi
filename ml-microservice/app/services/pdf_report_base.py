"""
Shared PDF scaffolding for AgriSaarthi report generators.

Any report generator (PMFBY claims, mandi profit summaries, field
inspection reports, etc.) reuses this: a themed style set, two
general-purpose table builders, a branded header/footer, and a single
render_pdf() entry point. A generator's only job is to build a `story`
list of ReportLab flowables and hand it here — it owns its own domain
logic (loss thresholds, field labels, whatever) and nothing about page
layout, fonts, or the header bar.
"""
from __future__ import annotations

import io
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import BaseDocTemplate, Frame, PageTemplate, Table, TableStyle


@dataclass(frozen=True)
class ReportTheme:
    """Swap this per report type if a template ever needs a different
    brand color (e.g. an amber theme for weather alerts) without touching
    any layout code."""
    brand: colors.Color = colors.HexColor("#1B7A43")
    brand_light: colors.Color = colors.HexColor("#E8F4EC")
    ink: colors.Color = colors.HexColor("#1A1A1A")
    muted: colors.Color = colors.HexColor("#5A5A5A")
    danger: colors.Color = colors.HexColor("#B3261E")


DEFAULT_THEME = ReportTheme()


def build_styles(theme: ReportTheme = DEFAULT_THEME) -> Dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle("t", parent=base["Title"], fontName="Helvetica-Bold",
                                fontSize=17, textColor=theme.brand, alignment=TA_CENTER, spaceAfter=2),
        "subtitle": ParagraphStyle("st", parent=base["Normal"], fontName="Helvetica",
                                   fontSize=9.5, textColor=theme.muted, alignment=TA_CENTER, spaceAfter=10),
        "h2": ParagraphStyle("h2", parent=base["Heading2"], fontName="Helvetica-Bold",
                             fontSize=11.5, textColor=theme.brand, spaceBefore=11, spaceAfter=5),
        "body": ParagraphStyle("b", parent=base["Normal"], fontName="Helvetica",
                               fontSize=9.2, textColor=theme.ink, leading=13, alignment=TA_LEFT),
        "small": ParagraphStyle("s", parent=base["Normal"], fontName="Helvetica",
                                fontSize=7.6, textColor=theme.muted, leading=10),
        "verdict": ParagraphStyle("v", parent=base["Normal"], fontName="Helvetica-Bold",
                                  fontSize=10.5, textColor=theme.danger, leading=14),
    }


def kv_table(rows: List[List[str]], theme: ReportTheme = DEFAULT_THEME,
             col_widths: Optional[List[float]] = None) -> Table:
    """Two-column label/value table — e.g. 'Farmer name' / 'Ramesh Kumar'."""
    widths = col_widths or [52 * mm, 118 * mm]
    t = Table(rows, colWidths=widths, hAlign="LEFT")
    t.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTNAME", (1, 0), (1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("TEXTCOLOR", (0, 0), (0, -1), theme.muted),
        ("TEXTCOLOR", (1, 0), (1, -1), theme.ink),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("LINEBELOW", (0, 0), (-1, -2), 0.3, colors.HexColor("#E0E0E0")),
    ]))
    return t


def grid_table(header: List[str], body: List[List[str]], widths: List[float],
               theme: ReportTheme = DEFAULT_THEME) -> Table:
    """Multi-column data table with a branded header row and striped body —
    e.g. the NDVI readings table or the weather anomaly log."""
    t = Table([header] + body, colWidths=widths, hAlign="LEFT", repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), theme.brand),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 8.2),
        ("ALIGN", (1, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#C8D8CD")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, theme.brand_light]),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return t


def make_header_footer(*, doc_title: str, ref: str, org: str, generated: str,
                        footer_note: Optional[str] = None,
                        theme: ReportTheme = DEFAULT_THEME) -> Callable:
    """Returns an onPage callback for PageTemplate: branded color bar with
    the report title + reference number, muted footer with org name,
    optional short note (e.g. 'Satellite-assisted assessment'), generation
    timestamp, and page number. Identical on every page."""
    footer_left = f"{org} · {footer_note} · Generated {generated}" if footer_note else f"{org} · Generated {generated}"

    def _decorate(canvas, doc):
        canvas.saveState()
        canvas.setFillColor(theme.brand)
        canvas.rect(0, A4[1] - 14 * mm, A4[0], 14 * mm, stroke=0, fill=1)
        canvas.setFillColor(colors.white)
        canvas.setFont("Helvetica-Bold", 9)
        canvas.drawString(15 * mm, A4[1] - 9.5 * mm, doc_title)
        canvas.setFont("Helvetica", 8)
        canvas.drawRightString(A4[0] - 15 * mm, A4[1] - 9.5 * mm, f"Ref: {ref}")

        canvas.setFillColor(theme.muted)
        canvas.setFont("Helvetica", 7)
        canvas.drawString(15 * mm, 10 * mm, footer_left)
        canvas.drawRightString(A4[0] - 15 * mm, 10 * mm, f"Page {doc.page}")
        canvas.setStrokeColor(colors.HexColor("#DDDDDD"))
        canvas.line(15 * mm, 13 * mm, A4[0] - 15 * mm, 13 * mm)
        canvas.restoreState()
    return _decorate


def render_pdf(*, story: List[Any], doc_title: str, ref: str, org: str,
                footer_note: Optional[str] = None,
                theme: ReportTheme = DEFAULT_THEME) -> bytes:
    """The one entry point every report template calls. Wraps a flowables
    `story` with the standard page size, margins, and branded header/footer,
    and returns the finished PDF as bytes."""
    generated = datetime.now(timezone.utc).strftime("%d %b %Y, %H:%M UTC")
    buf = io.BytesIO()
    doc = BaseDocTemplate(buf, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm,
                          topMargin=20 * mm, bottomMargin=16 * mm,
                          title=f"{doc_title} {ref}", author=org)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="main")
    decorate = make_header_footer(doc_title=doc_title, ref=ref, org=org, generated=generated,
                                   footer_note=footer_note, theme=theme)
    doc.addPageTemplates([PageTemplate(id="std", frames=[frame], onPage=decorate)])
    doc.build(story)
    return buf.getvalue()


def make_ref(prefix: str, payload: Any) -> str:
    """Deterministic-enough, human-scannable document reference, e.g.
    AGS-PMFBY-20260826-04213. Not cryptographically unique — good enough
    for a printed reference number, not a database primary key."""
    return f"{prefix}-{datetime.now(timezone.utc).strftime('%Y%m%d')}-{abs(hash(str(payload))) % 100000:05d}"