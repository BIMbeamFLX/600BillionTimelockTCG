"""Place the official circular 600B mark as a subtle, reusable watermark."""

from __future__ import annotations

from PIL import Image, ImageOps

WATERMARK_OPACITY = 78
WATERMARK_WIDTH_RATIO = 0.075
WATERMARK_MARGIN_RATIO = 0.022


def paste_subtle_watermark(
    canvas: Image.Image,
    logo: Image.Image,
    bounds: tuple[int, int, int, int] | None = None,
    *,
    width_ratio: float = WATERMARK_WIDTH_RATIO,
    opacity: int = WATERMARK_OPACITY,
    margin_ratio: float = WATERMARK_MARGIN_RATIO,
) -> tuple[int, int, int, int]:
    """Paste a low-opacity logo in the lower-right corner and return its box."""
    if not 0 < width_ratio < 1:
        raise ValueError("width_ratio must be between 0 and 1")
    if not 0 <= opacity <= 255:
        raise ValueError("opacity must be between 0 and 255")

    left, top, right, bottom = bounds or (0, 0, canvas.width, canvas.height)
    area_width = right - left
    area_height = bottom - top
    if area_width <= 0 or area_height <= 0:
        raise ValueError("watermark bounds must have positive dimensions")

    target_width = max(1, round(area_width * width_ratio))
    mark = ImageOps.contain(
        logo.convert("RGBA"),
        (target_width, target_width),
        Image.Resampling.LANCZOS,
    )
    alpha = mark.getchannel("A").point(lambda value: value * opacity // 255)
    mark.putalpha(alpha)

    margin = max(2, round(area_width * margin_ratio))
    x = right - margin - mark.width
    y = bottom - margin - mark.height
    canvas.paste(mark, (x, y), mark)
    return x, y, x + mark.width, y + mark.height
