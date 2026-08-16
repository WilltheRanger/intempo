"""The two plots, as inline SVG.

Server-rendered rather than Plotly or Chart.js. The appendix warns against
building a custom canvas renderer, and this isn't one — it's arithmetic into
`<rect>` and `<line>`, about eighty lines, with no CDN to be offline from and
no bundle to rebuild. Reload is the iteration loop, and reload is instant.

What is genuinely lost is hover-to-read-a-value. The numbers table under each
plot carries the same data exactly, which is also what gets pasted into a
tuning prompt — so the values are readable, they just aren't on the chart.
"""

from __future__ import annotations

from app.services.audio_config import AudioConfig
from app.services.classification import Band, Delta
from app.services.diagnostics import Diagnostics

WAVE_W = 1000
WAVE_H = 150
BARS_H = 170

BAND_FILL = {
    Band.on: "#1D7F46",
    Band.slight: "#8F681C",
    Band.rush_drag: "#C53B3B",
    Band.severe: "#8C1F1F",
}


def _x(t: float, duration: float) -> float:
    if duration <= 0:
        return 0.0
    return max(0.0, min(1.0, t / duration)) * WAVE_W


def waveform_svg(diag: Diagnostics) -> str:
    """Envelope, with detected onsets in red above and the expected grid in blue below."""
    env = diag.envelope
    duration = env.duration_s
    mid = WAVE_H / 2
    parts: list[str] = [
        f'<svg viewBox="0 0 {WAVE_W} {WAVE_H}" class="plot" preserveAspectRatio="none" '
        f'role="img" aria-label="Waveform with detected and expected onsets">'
    ]

    if env.peaks:
        step = WAVE_W / len(env.peaks)
        for i, peak in enumerate(env.peaks):
            height = max(0.6, peak * (WAVE_H - 40))
            parts.append(
                f'<rect x="{i * step:.2f}" y="{mid - height / 2:.2f}" '
                f'width="{step:.2f}" height="{height:.2f}" fill="#C9C2B4"/>'
            )

    # Expected first, so a detected onset sitting on top of one is still visible.
    for t in diag.expected_onsets:
        x = _x(t, duration)
        parts.append(f'<line x1="{x:.2f}" y1="{WAVE_H - 22:.0f}" x2="{x:.2f}" y2="{WAVE_H:.0f}" stroke="#2B5CA8" stroke-width="2"/>')

    for t in diag.detected_onsets:
        x = _x(t, duration)
        parts.append(f'<line x1="{x:.2f}" y1="0" x2="{x:.2f}" y2="22" stroke="#C53B3B" stroke-width="2"/>')
        parts.append(f'<circle cx="{x:.2f}" cy="22" r="3" fill="#C53B3B"/>')

    parts.append("</svg>")
    return "".join(parts)


def deviation_svg(deltas: list[Delta], cfg: AudioConfig) -> str:
    """One bar per matched note. Up is late (dragging), down is early (rushing)."""
    if not deltas:
        return '<p class="empty">No matched notes to chart.</p>'

    mid = BARS_H / 2
    # Scale to the largest deviation or the outer tolerance band, whichever is
    # bigger — so a clean clip doesn't have its ±3 ms magnified into drama, and
    # a disastrous one still fits.
    sec_per_beat = 60.0 / 60.0
    outer_ms = max(cfg.tolerance.rushing_outer_pct, cfg.tolerance.dragging_outer_pct) / 100 * sec_per_beat * 1000
    ceiling = max(max(abs(d.delta_ms) for d in deltas), outer_ms, 1.0)

    width = WAVE_W / len(deltas)
    parts: list[str] = [
        f'<svg viewBox="0 0 {WAVE_W} {BARS_H}" class="plot" preserveAspectRatio="none" '
        f'role="img" aria-label="Per-note deviation in milliseconds">'
    ]

    for fraction, dashed in ((0.5, True), (1.0, True)):
        for sign in (-1, 1):
            y = mid - sign * fraction * (BARS_H / 2 - 6)
            parts.append(
                f'<line x1="0" y1="{y:.1f}" x2="{WAVE_W}" y2="{y:.1f}" stroke="#E6E2DA" '
                f'stroke-width="1"{" stroke-dasharray=\"4 4\"" if dashed else ""}/>'
            )

    for i, d in enumerate(deltas):
        height = abs(d.delta_ms) / ceiling * (BARS_H / 2 - 6)
        # `delta_ms` is drag-positive (actual - expected), and the appendix asks
        # for positive bars to read as late. SVG's y grows downward, so a late
        # note's rect starts above the centre line and an early note's starts on
        # it — the opposite of the arithmetic, which is the easy way to get this
        # backwards.
        y = mid - height if d.delta_ms >= 0 else mid
        parts.append(
            f'<rect x="{i * width + width * 0.15:.2f}" y="{y:.2f}" '
            f'width="{width * 0.7:.2f}" height="{max(height, 0.8):.2f}" '
            f'fill="{BAND_FILL.get(d.band, "#7A7367")}"><title>note {d.global_index} '
            f'(bar {d.measure_number}): {d.delta_ms:+.0f} ms, {d.delta_pct:+.1f}% — {d.band.value}</title></rect>'
        )

    parts.append(f'<line x1="0" y1="{mid}" x2="{WAVE_W}" y2="{mid}" stroke="#14110E" stroke-width="1"/>')
    parts.append("</svg>")
    return "".join(parts)


def prompt_block(clip_label: str, filename: str, diag: Diagnostics) -> str:
    """The numbers, in the shape the appendix's §4 prompt pattern wants them.

    Tuning is supposed to be driven by pasting real data, and the fastest way
    to make that happen is to have it already formatted. Copying is the whole
    feature.
    """

    def row(values: list[float], fmt: str) -> str:
        cells = [format(v, fmt) for v in values]
        lines, line = [], "    "
        for cell in cells:
            if len(line) + len(cell) + 2 > 76:
                lines.append(line.rstrip())
                line = "    "
            line += cell + ", "
        lines.append(line.rstrip().rstrip(","))
        return "\n".join(lines)

    out = [f"Dashboard output for {clip_label} [{filename}]:", ""]
    out.append("  Detected onsets (s):")
    out.append(row(diag.detected_onsets, ".3f") or "    (none)")
    out.append("")
    out.append(f"  Expected onsets (s, scaled to target {diag.target_bpm:g} BPM):")
    out.append(row(diag.expected_onsets, ".3f") or "    (none)")

    if diag.deltas:
        out.append("")
        out.append("  Deviations (ms):")
        out.append(row(diag.deviations_ms, "+.0f"))
        out.append("")
        out.append("  Deviations (% of one beat):")
        out.append(row([d.delta_pct for d in diag.deltas], "+.1f"))

    out.append("")
    out.append(
        f"  Detector found {diag.n_detected} onsets; expected {diag.n_expected}. "
        f"Matched {len(diag.matched)}, missed {len(diag.missed_expected)}, "
        f"extra {len(diag.extra_detected)}."
    )
    out.append(f"  Alignment quality {diag.quality:.3f}. Status: {diag.status}.")

    if diag.missed_expected:
        bars = _bars_for(diag, diag.missed_expected)
        out.append(f"  Missed expected onsets at indices {diag.missed_expected} (bars {bars}).")
    if diag.extra_detected:
        out.append(f"  Extra detected onsets at indices {diag.extra_detected}.")

    cfg = diag.config
    if cfg is not None:
        out.append("")
        out.append(
            f"  Parameters: delta={cfg.onset.delta}, pre_max={cfg.onset.pre_max}, "
            f"post_max={cfg.onset.post_max}, wait_ms={cfg.onset.wait_ms}, "
            f"sr={cfg.onset.sr}, double_bass={diag.double_bass}"
            + (f" (db delta={cfg.onset.double_bass_delta}, highpass={cfg.onset.double_bass_highpass_hz}Hz)"
               if diag.double_bass else "")
        )
    return "\n".join(out)


def _bars_for(diag: Diagnostics, expected_indices: list[int]) -> list[int]:
    """Which bars the missed notes fall in — the appendix asks for this specifically."""
    bars: list[int] = []
    for index in expected_indices:
        for d in diag.deltas:
            if d.global_index == index:
                bars.append(d.measure_number)
                break
    return sorted(set(bars))
