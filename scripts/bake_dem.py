#!/usr/bin/env python3
"""Bake a HiRISE/CTX DTM GeoTIFF into static Flight Deck terrain assets.

The runtime stays GIS-free: this script downsamples a Jezero-area DTM into
  public/terrain/heightmap.png   16-bit grayscale height raster
  public/terrain/texture.png     optional ortho-image texture (if provided)
  public/terrain/meta.json       bounds, scale, and height range

The scene loader (src/scenes/terrain.ts) can then swap its procedural
heightfield for these assets without any code changes elsewhere.

Suggested source data (Jezero delta, ~18.44 N / 77.45 E):
  HiRISE DTM  DTEEC_045994_1985_046060_1985 (uahirise.org/dtm/)
  or the CTX Jezero mosaic DTM from the Murray Lab.

Usage:
  pip install rasterio pillow numpy
  python scripts/bake_dem.py path/to/DTM.tif --size 512 \
      [--ortho path/to/ortho.tif] [--out public/terrain]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("dtm", help="input DTM GeoTIFF")
    ap.add_argument("--ortho", help="optional ortho-image GeoTIFF for the texture")
    ap.add_argument("--size", type=int, default=512, help="output raster size (px, square)")
    ap.add_argument("--out", default="public/terrain", help="output directory")
    args = ap.parse_args()

    try:
        import numpy as np
        import rasterio
        from PIL import Image
        from rasterio.enums import Resampling
    except ImportError as exc:  # pragma: no cover
        print(f"missing dependency: {exc}. Run: pip install rasterio pillow numpy", file=sys.stderr)
        return 2

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    with rasterio.open(args.dtm) as src:
        data = src.read(
            1,
            out_shape=(args.size, args.size),
            resampling=Resampling.bilinear,
            masked=True,
        ).astype("float64")
        # fill nodata with the median so edges don't spike
        fill = float(np.ma.median(data))
        heights = np.ma.filled(data, fill)
        bounds = src.bounds
        crs = str(src.crs)
        # meters per pixel after downsampling (projected CRS assumed)
        mpp_x = (bounds.right - bounds.left) / args.size
        mpp_z = (bounds.top - bounds.bottom) / args.size

    h_min, h_max = float(heights.min()), float(heights.max())
    span = max(1e-6, h_max - h_min)
    norm = ((heights - h_min) / span * 65535.0).astype("uint16")
    Image.fromarray(norm, mode="I;16").save(out / "heightmap.png")

    if args.ortho:
        with rasterio.open(args.ortho) as osrc:
            tex = osrc.read(
                out_shape=(min(3, osrc.count), args.size, args.size),
                resampling=Resampling.bilinear,
            )
        tex = tex.astype("float64")
        lo, hi = tex.min(), tex.max()
        tex8 = ((tex - lo) / max(1e-6, hi - lo) * 255).astype("uint8")
        if tex8.shape[0] == 1:
            img = Image.fromarray(tex8[0], mode="L").convert("RGB")
        else:
            img = Image.fromarray(np.moveaxis(tex8[:3], 0, -1), mode="RGB")
        img.save(out / "texture.png")

    meta = {
        "source": Path(args.dtm).name,
        "crs": crs,
        "bounds": {
            "left": bounds.left,
            "right": bounds.right,
            "top": bounds.top,
            "bottom": bounds.bottom,
        },
        "sizePx": args.size,
        "metersPerPixel": {"x": mpp_x, "z": mpp_z},
        "heightMinM": h_min,
        "heightMaxM": h_max,
        "anchor": {"lat_deg": 18.44, "lon_deg": 77.45, "note": "Jezero delta local frame origin"},
        "hasTexture": bool(args.ortho),
    }
    (out / "meta.json").write_text(json.dumps(meta, indent=2))
    print(f"baked {args.size}x{args.size} terrain -> {out}/ (height {h_min:.1f}..{h_max:.1f} m)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
