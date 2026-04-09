// Mix rules (Pandora-like) for guest MVP.
// Backend infers typeCode from bracelet category slug under `bracelet`.

const clipZonePercents = [0.25, 0.5, 0.75];

// Default rule set (can be adjusted without DB migrations).
// Key: typeCode (category slug under `bracelet`)
// Value: sizeCm -> { recommendedCharms, maxCharms }
const rulesByTypeAndSize = {
  "snake-chain": {
    16: { recommendedCharms: 14, maxCharms: 18 },
    17: { recommendedCharms: 15, maxCharms: 19 },
    18: { recommendedCharms: 16, maxCharms: 20 },
    19: { recommendedCharms: 17, maxCharms: 21 },
    20: { recommendedCharms: 18, maxCharms: 22 },
  },
  // Dataset slug alias (VN): "vong-tay-mem" behaves like snake-chain.
  "vong-tay-mem": {
    16: { recommendedCharms: 14, maxCharms: 18 },
    17: { recommendedCharms: 15, maxCharms: 19 },
    18: { recommendedCharms: 16, maxCharms: 20 },
    19: { recommendedCharms: 17, maxCharms: 21 },
    20: { recommendedCharms: 18, maxCharms: 22 },
  },
  bangle: {
    16: { recommendedCharms: 10, maxCharms: 14 },
    17: { recommendedCharms: 11, maxCharms: 15 },
    18: { recommendedCharms: 12, maxCharms: 16 },
    19: { recommendedCharms: 13, maxCharms: 17 },
    20: { recommendedCharms: 14, maxCharms: 18 },
  },
  // Dataset slug alias (VN): "vong-kieng" behaves like bangle.
  "vong-kieng": {
    16: { recommendedCharms: 10, maxCharms: 14 },
    17: { recommendedCharms: 11, maxCharms: 15 },
    18: { recommendedCharms: 12, maxCharms: 16 },
    19: { recommendedCharms: 13, maxCharms: 17 },
    20: { recommendedCharms: 14, maxCharms: 18 },
  },
  leather: {
    16: { recommendedCharms: 8, maxCharms: 12 },
    17: { recommendedCharms: 9, maxCharms: 13 },
    18: { recommendedCharms: 10, maxCharms: 14 },
    19: { recommendedCharms: 11, maxCharms: 15 },
    20: { recommendedCharms: 12, maxCharms: 16 },
  },
  // Dataset slug alias (VN): "vong-da-*" behaves like leather.
  "vong-da": {
    16: { recommendedCharms: 8, maxCharms: 12 },
    17: { recommendedCharms: 9, maxCharms: 13 },
    18: { recommendedCharms: 10, maxCharms: 14 },
    19: { recommendedCharms: 11, maxCharms: 15 },
    20: { recommendedCharms: 12, maxCharms: 16 },
  },
  "vong-da-U2oezSEXV": {
    16: { recommendedCharms: 8, maxCharms: 12 },
    17: { recommendedCharms: 9, maxCharms: 13 },
    18: { recommendedCharms: 10, maxCharms: 14 },
    19: { recommendedCharms: 11, maxCharms: 15 },
    20: { recommendedCharms: 12, maxCharms: 16 },
  },
};

const clampInt = (value, min, max) => {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(n, min), max);
};

// Ensure we return 3 unique, sorted indices within [0..slotCount-1].
const computeClipZones = (slotCount, percents = clipZonePercents) => {
  const n = clampInt(slotCount, 0, 10_000);
  if (n <= 0) return [];
  const maxIdx = n - 1;

  const raw = percents.map((p) => {
    const percent = Number(p);
    const safe = Number.isFinite(percent) ? percent : 0;
    return clampInt(Math.round(maxIdx * safe), 0, maxIdx);
  });

  const result = [];
  const used = new Set();
  for (const idx of raw) {
    if (!used.has(idx)) {
      used.add(idx);
      result.push(idx);
      continue;
    }

    // Resolve collisions by searching nearest available index.
    let found = null;
    for (let delta = 1; delta <= maxIdx; delta++) {
      const cand1 = idx - delta;
      const cand2 = idx + delta;
      if (cand1 >= 0 && !used.has(cand1)) {
        found = cand1;
        break;
      }
      if (cand2 <= maxIdx && !used.has(cand2)) {
        found = cand2;
        break;
      }
    }
    if (found !== null) {
      used.add(found);
      result.push(found);
    }
  }

  return result.sort((a, b) => a - b).slice(0, 3);
};

const getRule = (typeCode, sizeCm) => {
  const typeRules = rulesByTypeAndSize[String(typeCode || "")] || null;
  if (!typeRules) return null;
  const key = Number.parseInt(sizeCm, 10);
  if (!Number.isFinite(key)) return null;
  return typeRules[key] || null;
};

// Type guard helpers (dataset can use VN slugs).
const isSnakeChainType = (typeCode) => {
  const t = String(typeCode || "");
  return t === "snake-chain" || t === "vong-tay-mem";
};

module.exports = {
  clipZonePercents,
  rulesByTypeAndSize,
  computeClipZones,
  getRule,
  isSnakeChainType,
};
