const mongoose = require("mongoose");
const Product = require("../models/product.model");
const { getRule, computeClipZones, clipZonePercents, isSnakeChainType } = require("../config/mix-rules");
const mixCategoryHelper = require("./mix-category.helper");

const findVariantByCode = (product, variantCode) => {
  const code = String(variantCode || "");
  return (product?.variants || []).find((v) => String(v?.code) === code) || null;
};

const buildError = (field, message, meta) => ({ field, message, ...(meta ? { meta } : {}) });

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

// Offset is a client-only preview tweak; keep it bounded to avoid storing crazy values.
const normalizeOffsetN = (offsetN) => {
  const x = Number(offsetN?.x);
  const y = Number(offsetN?.y);
  return {
    x: clamp(Number.isFinite(x) ? x : 0, -0.35, 0.35),
    y: clamp(Number.isFinite(y) ? y : 0, -0.35, 0.35),
  };
};

// Used by cart/design flows to ensure rule correctness and stable snapshots.
const validateAndPrice = async ({ bracelet, items }) => {
  const errors = [];
  const braceletProductId = bracelet?.productId;
  const braceletVariantCode = bracelet?.variantCode;
  const sizeCm = Number.parseInt(bracelet?.sizeCm, 10);

  if (!braceletProductId || !mongoose.Types.ObjectId.isValid(braceletProductId)) {
    errors.push(buildError("bracelet.productId", "Invalid bracelet productId"));
  }
  if (!braceletVariantCode) {
    errors.push(buildError("bracelet.variantCode", "Missing bracelet variantCode"));
  }
  if (!Number.isFinite(sizeCm)) {
    errors.push(buildError("bracelet.sizeCm", "Invalid sizeCm"));
  }

  const safeItems = Array.isArray(items) ? items : [];
  const slotSet = new Set();
  for (let i = 0; i < safeItems.length; i++) {
    const it = safeItems[i] || {};
    const slotIndex = Number.parseInt(it.slotIndex, 10);
    if (!Number.isFinite(slotIndex)) {
      errors.push(buildError(`items[${i}].slotIndex`, "Invalid slotIndex"));
    } else if (slotSet.has(slotIndex)) {
      errors.push(buildError(`items[${i}].slotIndex`, "Duplicate slotIndex", { slotIndex }));
    } else {
      slotSet.add(slotIndex);
    }

    if (!it.charmProductId || !mongoose.Types.ObjectId.isValid(it.charmProductId)) {
      errors.push(buildError(`items[${i}].charmProductId`, "Invalid charmProductId"));
    }
    if (!it.charmVariantCode) {
      errors.push(buildError(`items[${i}].charmVariantCode`, "Missing charmVariantCode"));
    }
  }

  if (errors.length) {
    return {
      valid: false,
      errors,
      slotCount: 0,
      recommendedCharms: 0,
      clipZones: [],
      pricing: { braceletPrice: 0, charmsPrice: 0, total: 0 },
      clipZonePercents,
      braceletSnapshot: null,
      itemsSnapshot: null,
    };
  }

  const braceletProduct = await Product.findOne({ _id: braceletProductId, deleted: false }).lean();
  if (!braceletProduct) {
    return {
      valid: false,
      errors: [buildError("bracelet.productId", "Bracelet product not found")],
      slotCount: 0,
      recommendedCharms: 0,
      clipZones: [],
      pricing: { braceletPrice: 0, charmsPrice: 0, total: 0 },
      clipZonePercents,
      braceletSnapshot: null,
      itemsSnapshot: null,
    };
  }

  const typeCode = await mixCategoryHelper.inferBraceletTypeCodeFromCategoryId(braceletProduct.category);
  if (!typeCode) {
    return {
      valid: false,
      errors: [buildError("bracelet", "Unable to infer bracelet typeCode from category")],
      slotCount: 0,
      recommendedCharms: 0,
      clipZones: [],
      pricing: { braceletPrice: 0, charmsPrice: 0, total: 0 },
      clipZonePercents,
      braceletSnapshot: null,
      itemsSnapshot: null,
    };
  }

  const rule = getRule(typeCode, sizeCm);
  if (!rule) {
    return {
      valid: false,
      errors: [buildError("bracelet.sizeCm", `No mix rule for type '${typeCode}' and size '${sizeCm}'`)],
      slotCount: 0,
      recommendedCharms: 0,
      clipZones: [],
      pricing: { braceletPrice: 0, charmsPrice: 0, total: 0 },
      clipZonePercents,
      braceletSnapshot: null,
      itemsSnapshot: null,
    };
  }

  const slotCount = Number(rule.maxCharms) || 0;
  const recommendedCharms = Number(rule.recommendedCharms) || 0;
  const clipZones = isSnakeChainType(typeCode) ? computeClipZones(slotCount) : [];

  // Range validation.
  const rangeErrors = [];
  for (let i = 0; i < safeItems.length; i++) {
    const slotIndex = Number.parseInt(safeItems[i]?.slotIndex, 10);
    if (slotIndex < 0 || slotIndex >= slotCount) {
      rangeErrors.push(buildError(`items[${i}].slotIndex`, "slotIndex out of range", { slotIndex, slotCount }));
    }
  }
  if (rangeErrors.length) {
    return {
      valid: false,
      errors: rangeErrors,
      slotCount,
      recommendedCharms,
      clipZones,
      pricing: { braceletPrice: 0, charmsPrice: 0, total: 0 },
      clipZonePercents,
      braceletSnapshot: null,
      itemsSnapshot: null,
    };
  }

  const braceletVariant = findVariantByCode(braceletProduct, braceletVariantCode);
  if (!braceletVariant) {
    return {
      valid: false,
      errors: [buildError("bracelet.variantCode", "Bracelet variant not found")],
      slotCount,
      recommendedCharms,
      clipZones,
      pricing: { braceletPrice: 0, charmsPrice: 0, total: 0 },
      clipZonePercents,
      braceletSnapshot: null,
      itemsSnapshot: null,
    };
  }

  const charmIds = [...new Set(safeItems.map((it) => String(it.charmProductId)))];
  const charmProducts = await Product.find({ _id: { $in: charmIds }, deleted: false }).lean();
  const charmById = new Map(charmProducts.map((p) => [String(p._id), p]));

  const validationErrors = [];
  let charmsPrice = 0;

  for (let i = 0; i < safeItems.length; i++) {
    const it = safeItems[i];
    const charm = charmById.get(String(it.charmProductId));
    if (!charm) {
      validationErrors.push(buildError(`items[${i}].charmProductId`, "Charm product not found"));
      continue;
    }
    const charmVariant = findVariantByCode(charm, it.charmVariantCode);
    if (!charmVariant) {
      validationErrors.push(buildError(`items[${i}].charmVariantCode`, "Charm variant not found"));
      continue;
    }

    const isClip = await mixCategoryHelper.isClipCategoryId(charm.category);
    if (isSnakeChainType(typeCode) && isClip) {
      const slotIndex = Number.parseInt(it.slotIndex, 10);
      if (!clipZones.includes(slotIndex)) {
        validationErrors.push(
          buildError(`items[${i}].slotIndex`, "Clip charm must be placed in a clip zone", {
            slotIndex,
            clipZones,
          })
        );
      }
    }

    // Stock checks are required for cart/design-save flows.
    if (Number(charmVariant.quantity) <= 0) {
      validationErrors.push(buildError(`items[${i}]`, "Charm variant out of stock", { charmVariantCode: it.charmVariantCode }));
    }

    charmsPrice += Number(charmVariant.price) || 0;
  }

  if (Number(braceletVariant.quantity) <= 0) {
    validationErrors.push(buildError("bracelet.variantCode", "Bracelet variant out of stock", { braceletVariantCode }));
  }

  const braceletPrice = Number(braceletVariant.price) || 0;
  const total = braceletPrice + charmsPrice;

  if (validationErrors.length) {
    return {
      valid: false,
      errors: validationErrors,
      slotCount,
      recommendedCharms,
      clipZones,
      pricing: { braceletPrice, charmsPrice, total },
      clipZonePercents,
      braceletSnapshot: null,
      itemsSnapshot: null,
    };
  }

  return {
    valid: true,
    errors: [],
    slotCount,
    recommendedCharms,
    clipZones,
    pricing: { braceletPrice, charmsPrice, total },
    clipZonePercents,
    braceletSnapshot: {
      productId: String(braceletProduct._id),
      variantCode: String(braceletVariantCode),
      sizeCm,
      typeCode,
    },
    itemsSnapshot: safeItems.map((it) => ({
      slotIndex: Number.parseInt(it.slotIndex, 10),
      charmProductId: String(it.charmProductId),
      charmVariantCode: String(it.charmVariantCode),
      offsetN: normalizeOffsetN(it.offsetN),
    })),
  };
};

module.exports = {
  validateAndPrice,
};
