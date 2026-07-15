/** Heightfield sampler + 16-bit decode — pure math, no DOM. */
import { describe, expect, it } from 'vitest';
import { buildHeightfield, decodeHeights, type TerrainMeta } from '../src/scenes/heightfield';

const meta = (over: Partial<TerrainMeta> = {}): TerrainMeta => ({
  sizeM: 10000,
  heightMinM: -100,
  heightMaxM: 100,
  ...over,
});

describe('buildHeightfield.sample', () => {
  // 3x3 grid where value = row*10 + col (row 0 = north, col 0 = west)
  const heights = Float32Array.from([0, 1, 2, 10, 11, 12, 20, 21, 22]);
  const hf = buildHeightfield(heights, 3, meta());

  it('maps local-meter corners to grid corners (origin = centre)', () => {
    expect(hf.sample(-5000, -5000)).toBe(0); // west + north
    expect(hf.sample(5000, -5000)).toBe(2); // east + north
    expect(hf.sample(-5000, 5000)).toBe(20); // west + south
    expect(hf.sample(5000, 5000)).toBe(22); // east + south
    expect(hf.sample(0, 0)).toBe(11); // centre
  });

  it('bilinearly interpolates between cells', () => {
    expect(hf.sample(2500, 0)).toBeCloseTo(11.5, 6); // halfway col1→col2 at centre row
    expect(hf.sample(0, 2500)).toBeCloseTo(16, 6); // halfway row1→row2 at centre col
  });

  it('clamps outside the window', () => {
    expect(hf.sample(-99999, -99999)).toBe(0);
    expect(hf.sample(99999, 99999)).toBe(22);
  });

  it('carries meta through (size, range, landmarks, credit)', () => {
    const hf2 = buildHeightfield(heights, 3, meta({ landmarks: [{ name: 'X', x: 1, z: 2 }], credit: 'NASA' }));
    expect(hf2.sizeM).toBe(10000);
    expect(hf2.heightMinM).toBe(-100);
    expect(hf2.landmarks).toHaveLength(1);
    expect(hf2.credit).toBe('NASA');
  });
});

describe('decodeHeights', () => {
  it('decodes R+G-packed 16-bit back to metres', () => {
    // one pixel, mid-range: u16 = 128*256 = 32768 -> ~0 m over [-100,100]
    const rgba = new Uint8ClampedArray([128, 0, 0, 255]);
    const h = decodeHeights(rgba, 1, meta());
    expect(h).toHaveLength(1);
    expect(h[0]).toBeCloseTo(0, 1);
  });

  it('decodes min and max endpoints', () => {
    const lo = decodeHeights(new Uint8ClampedArray([0, 0, 0, 255]), 1, meta());
    const hi = decodeHeights(new Uint8ClampedArray([255, 255, 0, 255]), 1, meta());
    expect(lo[0]).toBeCloseTo(-100, 4);
    expect(hi[0]).toBeCloseTo(100, 4);
  });
});
