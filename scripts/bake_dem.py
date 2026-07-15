#!/usr/bin/env python3
"""Bake a real Jezero-Crater terrain window into static Flight Deck assets.

GIS-free (tifffile + numpy + Pillow — no GDAL). Reads the USGS Mars 2020 CTX
mosaics (Equirectangular, Mars 2000 sphere), crops a square ground window
centred on the Octavia E. Butler landing site, and writes:

  public/terrain/heightmap.png  1024x1024 RGB, elevation packed 16-bit as R*256+G
  public/terrain/texture.png    2048x2048 RGB, CTX albedo graded to Mars ochre
  public/terrain/meta.json      sizeM, heightMin/Max (m), anchor lat/lon, landmarks

The runtime (src/scenes/terrain.ts) samples these; with no assets it falls back
to the procedural heightfield, so the app stays offline-safe either way.

Source data (public domain, NASA/JPL-Caltech/USGS):
  DEM   M20_JezeroCrater_CTXDEM_20m.tif          (20 m/px, float m)
  Ortho JEZ_ctx_B_soc_008_orthoMosaic_6m_*.tif   (6 m/px, panchromatic)

Usage:
  pip install tifffile numpy pillow
  python scripts/bake_dem.py DEM.tif --ortho ORTHO.tif \
      --lat 18.4446 --lon 77.4509 --half-m 5000 --out public/terrain
"""
from __future__ import annotations
import argparse, json, math, sys
from pathlib import Path

R_MARS = 3396190.0  # Mars 2000 sphere radius (m), per the GeoTIFF params


def georef(page):
    """Return (X0, Y0, mpp, phi1_deg) for an Equirectangular Mars-2000 page."""
    tags = {t.name: t.value for t in page.tags}
    scale = tags["ModelPixelScaleTag"]
    tie = tags["ModelTiepointTag"]
    mpp = float(scale[0])
    x0, y0 = float(tie[3]), float(tie[4])  # world XY at pixel (0,0)
    # standard parallel: the non-zero lat in GeoDoubleParams (0 for the global ortho)
    phi1 = 0.0
    for v in tags.get("GeoDoubleParamsTag", ()):
        if 1.0 < abs(v) < 90.0:
            phi1 = float(v)
            break
    return x0, y0, mpp, phi1


def lonlat_to_px(lon, lat, gr):
    """lon/lat (deg) -> fractional (col, row) in the raster."""
    x0, y0, mpp, phi1 = gr
    x = R_MARS * math.cos(math.radians(phi1)) * math.radians(lon)
    y = R_MARS * math.radians(lat)
    return (x - x0) / mpp, (y0 - y) / mpp


def sample_window(arr, gr, lat_c, lon_c, half_m, out_n, nodata=None):
    """Resample a square `2*half_m` ground window to out_n x out_n (bilinear).

    Output grid is uniform in ground metres (north-up); each output cell maps to
    lon/lat then to a source pixel. Returns float array (nodata -> nan)."""
    import numpy as np
    a = arr.astype("float64")
    if nodata is not None:
        a[a <= nodata] = np.nan
    dlat = math.degrees(half_m / R_MARS)
    dlon = math.degrees(half_m / (R_MARS * math.cos(math.radians(lat_c))))
    # output ground grid: north (row 0) -> south, west (col 0) -> east
    lats = lat_c + dlat * (1 - 2 * (np.arange(out_n) + 0.5) / out_n)  # +dlat..-dlat
    lons = lon_c + dlon * (2 * (np.arange(out_n) + 0.5) / out_n - 1)  # -dlon..+dlon
    x0, y0, mpp, phi1 = gr
    cosp = math.cos(math.radians(phi1))
    cols = (R_MARS * cosp * np.radians(lons) - x0) / mpp           # (out_n,)
    rows = (y0 - R_MARS * np.radians(lats)) / mpp                  # (out_n,)
    C, Rw = np.meshgrid(cols, rows)                               # (n,n)
    c0 = np.clip(np.floor(C).astype(int), 0, a.shape[1] - 2)
    r0 = np.clip(np.floor(Rw).astype(int), 0, a.shape[0] - 2)
    fc, fr = C - c0, Rw - r0
    v00 = a[r0, c0]; v01 = a[r0, c0 + 1]; v10 = a[r0 + 1, c0]; v11 = a[r0 + 1, c0 + 1]
    top = v00 * (1 - fc) + v01 * fc
    bot = v10 * (1 - fc) + v11 * fc
    return top * (1 - fr) + bot * fr


def mars_grade(gray):
    """Panchromatic albedo (0..1) -> Mars regolith RGB (dark rust -> tan ochre)."""
    import numpy as np
    lo = np.array([0.30, 0.17, 0.11]); hi = np.array([0.72, 0.53, 0.36])
    g = np.clip(gray, 0, 1)[..., None]
    rgb = lo + (hi - lo) * g
    rgb *= 0.9 + 0.2 * g  # gentle contrast lift on bright regolith
    return np.clip(rgb, 0, 1)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("dtm")
    ap.add_argument("--ortho")
    ap.add_argument("--lat", type=float, default=18.4446)  # Octavia E. Butler Landing
    ap.add_argument("--lon", type=float, default=77.4509)
    ap.add_argument("--half-m", type=float, default=5000.0)  # -> 10 km window
    ap.add_argument("--height-size", type=int, default=1024)
    ap.add_argument("--tex-size", type=int, default=2048)
    ap.add_argument("--out", default="public/terrain")
    a = ap.parse_args()

    try:
        import numpy as np, tifffile
        from PIL import Image
    except ImportError as e:
        print(f"missing dep: {e}. pip install tifffile numpy pillow", file=sys.stderr)
        return 2

    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    size_m = 2 * a.half_m

    with tifffile.TiffFile(a.dtm) as tf:
        dem = tf.pages[0].asarray()
        gr = georef(tf.pages[0])
    print(f"DEM {dem.shape} georef X0={gr[0]:.0f} Y0={gr[1]:.0f} mpp={gr[2]} phi1={gr[3]}")
    hz = sample_window(dem, gr, a.lat, a.lon, a.half_m, a.height_size, nodata=-1e30)
    med = float(np.nanmedian(hz)); hz = np.where(np.isnan(hz), med, hz)
    hmin, hmax = float(hz.min()), float(hz.max())
    span = max(1e-6, hmax - hmin)
    print(f"window height {hmin:.1f}..{hmax:.1f} m (relief {span:.1f} m over {size_m/1000:.0f} km)")
    u16 = np.clip((hz - hmin) / span * 65535.0, 0, 65535).astype("uint16")
    rgb = np.zeros((a.height_size, a.height_size, 3), "uint8")
    rgb[..., 0] = (u16 >> 8).astype("uint8")   # high byte
    rgb[..., 1] = (u16 & 255).astype("uint8")  # low byte
    Image.fromarray(rgb, "RGB").save(out / "heightmap.png")

    has_tex = False
    if a.ortho:
        with tifffile.TiffFile(a.ortho) as tf:
            ortho = tf.pages[0].asarray()
            ogr = georef(tf.pages[0])
        if ortho.ndim == 3:
            ortho = ortho[..., 0]
        g = sample_window(ortho, ogr, a.lat, a.lon, a.half_m, a.tex_size)
        g = np.where(np.isnan(g), np.nanmedian(g), g) / 255.0
        tex = (mars_grade(g) * 255).astype("uint8")
        Image.fromarray(tex, "RGB").save(out / "texture.png")
        has_tex = True
        print(f"texture {a.tex_size}x{a.tex_size} baked from ortho")

    def landmark(name, lat, lon):
        east = math.radians(lon - a.lon) * R_MARS * math.cos(math.radians(a.lat))
        north = math.radians(lat - a.lat) * R_MARS
        return {"name": name, "x": round(east, 1), "z": round(-north, 1)}

    meta = {
        "source": "NASA/JPL-Caltech/USGS — Mars 2020 CTX DEM & orthomosaic",
        "credit": "Elevation & imagery: NASA/JPL-Caltech/USGS",
        "sizeM": size_m,
        "sizePx": a.height_size,
        "heightMinM": round(hmin, 2),
        "heightMaxM": round(hmax, 2),
        "anchor": {"lat_deg": a.lat, "lon_deg": a.lon, "note": "Octavia E. Butler Landing (origin)"},
        "hasTexture": has_tex,
        "landmarks": [
            landmark("Octavia E. Butler Landing", 18.4446, 77.4509),
            landmark("Western delta", 18.470, 77.410),
            landmark("Kodiak butte", 18.461, 77.423),
            landmark("Crater rim (NW)", 18.55, 77.30),
        ],
    }
    (out / "meta.json").write_text(json.dumps(meta, indent=2))
    print(f"baked -> {out}/  (relief {hmin:.1f}..{hmax:.1f} m, {size_m/1000:.0f} km window)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
