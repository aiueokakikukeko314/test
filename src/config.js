// Quality presets. "auto" picks one from the device and then adapts resolution at runtime.
export const QUALITY = {
  low: {
    name: 'low', maxPixelRatio: 0.8, msaa: 0, shadowSize: 2048, shadowRange: 48, terrainRes: 241,
    treeSpacing: 7.8, leafDensity: 0.7, lod: [18, 48, 150], undergrowth: 0.5, plantRange: 34, plantDensity: 0.45,
    reflection: false, reflectionSize: 256, reflectionEvery: 2, volumetric: false, volSteps: 12,
    ao: false, bloom: true, dof: false, grassBlades: 40000, grassRange: 18, anisotropy: 2, particles: 0.4,
  },
  medium: {
    name: 'medium', maxPixelRatio: 1, msaa: 0, shadowSize: 2048, shadowRange: 56, terrainRes: 361,
    treeSpacing: 7.0, leafDensity: 0.85, lod: [26, 64, 175], undergrowth: 0.8, plantRange: 40, plantDensity: 0.7,
    reflection: true, reflectionSize: 512, reflectionEvery: 2, volumetric: true, volSteps: 16,
    ao: false, bloom: true, dof: false, grassBlades: 90000, grassRange: 24, anisotropy: 4, particles: 0.7,
  },
  high: {
    name: 'high', maxPixelRatio: 1.25, msaa: 4, shadowSize: 4096, shadowRange: 68, terrainRes: 481,
    treeSpacing: 6.3, leafDensity: 1.0, lod: [34, 82, 200], undergrowth: 1.0, plantRange: 48, plantDensity: 0.9,
    reflection: true, reflectionSize: 1024, reflectionEvery: 2, volumetric: true, volSteps: 24,
    ao: true, bloom: true, dof: true, grassBlades: 150000, grassRange: 28, anisotropy: 8, particles: 1.0,
  },
  ultra: {
    name: 'ultra', maxPixelRatio: 2, msaa: 4, shadowSize: 4096, shadowRange: 76, terrainRes: 601,
    treeSpacing: 5.8, leafDensity: 1.15, lod: [48, 110, 240], undergrowth: 1.2, plantRange: 64, plantDensity: 1.15,
    reflection: true, reflectionSize: 1536, reflectionEvery: 1, volumetric: true, volSteps: 36,
    ao: true, bloom: true, dof: true, grassBlades: 260000, grassRange: 34, anisotropy: 16, particles: 1.3,
  },
};

export function pickQuality(params) {
  const q = params.get('q');
  if (q && QUALITY[q]) return QUALITY[q];
  const saved = (() => { try { return localStorage.getItem('forest-quality'); } catch { return null; } })();
  if (saved && QUALITY[saved]) return QUALITY[saved];
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 900);
  if (mobile) return QUALITY.low;
  const cores = navigator.hardwareConcurrency || 4;
  return cores >= 8 ? QUALITY.high : QUALITY.medium;
}
