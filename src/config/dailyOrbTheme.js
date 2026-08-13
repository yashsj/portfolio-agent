// Single source of truth for every orb palette tried — both the live daily
// rotation (below) and the /orb-lab comparison page pull from this list, so
// adding a variant in one place surfaces it in both.
export const ALL_ORB_PALETTES = [
  { label: "Pure blue / near-black",    near: [30, 90, 180],   far: [3, 8, 18] },
  { label: "Molten ember",              near: [255, 130, 40],  far: [35, 4, 0] },
  { label: "Ultraviolet",               near: [200, 60, 255],  far: [15, 0, 40] },
  { label: "Acid lime",                 near: [190, 255, 70],  far: [8, 25, 6] },
  { label: "Teal-green / deep blue",    near: [30, 150, 130],  far: [5, 15, 60] },
  { label: "Fire ember / deep blue",    near: [255, 110, 30],  far: [4, 12, 45] },
  { label: "Forest green / sky blue",   near: [12, 55, 25],    far: [70, 170, 240] },
  { label: "Golden yellow / deep blue", near: [255, 205, 60],  far: [20, 55, 160] },
  { label: "Earth",                     near: [50, 130, 210],  far: [20, 75, 35] },
  { label: "Sun",                       near: [255, 225, 130], far: [220, 80, 15] },
  { label: "Mars",                      near: [205, 100, 55],  far: [45, 18, 12] },
  { label: "Moon",                      near: [205, 205, 210], far: [40, 40, 44] },
  { label: "Jupiter",                   near: [225, 195, 150], far: [110, 65, 40] },
  { label: "Neptune",                   near: [80, 120, 225],  far: [10, 20, 75] },
];

// Deterministic string hash (djb2-ish) — same calendar day always maps to
// the same index, but which palette lands on which day looks unpredictable
// rather than a fixed Mon/Tue/Wed rotation. Whole-day granularity (not
// per-session) so the orb doesn't visibly flicker between colors on reload.
const hashString = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
};

export const getDailyOrbTheme = () => {
  const d = new Date();
  const dateKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const index = hashString(dateKey) % ALL_ORB_PALETTES.length;
  return ALL_ORB_PALETTES[index];
};
