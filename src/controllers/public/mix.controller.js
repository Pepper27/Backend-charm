const mongoose = require("mongoose");
const Product = require("../../models/product.model");
const {
  getRule,
  computeClipZones,
  clipZonePercents,
  isSnakeChainType,
} = require("../../config/mix-rules");
const mixCategoryHelper = require("../../helper/mix-category.helper");

const findVariantByCode = (product, variantCode) => {
  const code = String(variantCode || "");
  return (product?.variants || []).find((v) => String(v?.code) === code) || null;
};

const buildError = (field, message, meta) => ({ field, message, ...(meta ? { meta } : {}) });

module.exports.validateMix = async (req, res) => {
  try {
    const bracelet = req.body?.bracelet || {};
    const items = Array.isArray(req.body?.items) ? req.body.items : [];

    const errors = [];
    const braceletProductId = bracelet.productId;
    const braceletVariantCode = bracelet.variantCode;
    const sizeCm = Number.parseInt(bracelet.sizeCm, 10);

    if (!braceletProductId || !mongoose.Types.ObjectId.isValid(braceletProductId)) {
      errors.push(buildError("bracelet.productId", "Invalid bracelet productId"));
    }
    if (!braceletVariantCode) {
      errors.push(buildError("bracelet.variantCode", "Missing bracelet variantCode"));
    }
    if (!Number.isFinite(sizeCm)) {
      errors.push(buildError("bracelet.sizeCm", "Invalid sizeCm"));
    }

    if (!Array.isArray(items)) {
      errors.push(buildError("items", "Items must be an array"));
    }

    // Basic item shape check.
    const slotSet = new Set();
    for (let i = 0; i < items.length; i++) {
      const it = items[i] || {};
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
      return res.status(200).json({
        valid: false,
        errors,
        slotCount: 0,
        recommendedCharms: 0,
        clipZones: [],
        pricing: { braceletPrice: 0, charmsPrice: 0, total: 0 },
        clipZonePercents,
      });
    }

    const braceletProduct = await Product.findOne({
      _id: braceletProductId,
      deleted: false,
    }).lean();
    if (!braceletProduct) {
      return res.status(200).json({
        valid: false,
        errors: [buildError("bracelet.productId", "Bracelet product not found")],
        slotCount: 0,
        recommendedCharms: 0,
        clipZones: [],
        pricing: { braceletPrice: 0, charmsPrice: 0, total: 0 },
        clipZonePercents,
      });
    }

    const typeCode = await mixCategoryHelper.inferBraceletTypeCodeFromCategoryId(
      braceletProduct.category
    );
    if (!typeCode) {
      return res.status(200).json({
        valid: false,
        errors: [buildError("bracelet", "Unable to infer bracelet typeCode from category")],
        slotCount: 0,
        recommendedCharms: 0,
        clipZones: [],
        pricing: { braceletPrice: 0, charmsPrice: 0, total: 0 },
        clipZonePercents,
      });
    }

    const rule = getRule(typeCode, sizeCm);
    if (!rule) {
      return res.status(200).json({
        valid: false,
        errors: [
          buildError("bracelet.sizeCm", `No mix rule for type '${typeCode}' and size '${sizeCm}'`),
        ],
        slotCount: 0,
        recommendedCharms: 0,
        clipZones: [],
        pricing: { braceletPrice: 0, charmsPrice: 0, total: 0 },
        clipZonePercents,
      });
    }

    const slotCount = Number(rule.maxCharms) || 0;
    const recommendedCharms = Number(rule.recommendedCharms) || 0;
    const clipZones = isSnakeChainType(typeCode) ? computeClipZones(slotCount) : [];

    // Slot range validation.
    const rangeErrors = [];
    for (let i = 0; i < items.length; i++) {
      const slotIndex = Number.parseInt(items[i]?.slotIndex, 10);
      if (slotIndex < 0 || slotIndex >= slotCount) {
        rangeErrors.push(
          buildError(`items[${i}].slotIndex`, "slotIndex out of range", { slotIndex, slotCount })
        );
      }
    }
    if (rangeErrors.length) {
      return res.status(200).json({
        valid: false,
        errors: rangeErrors,
        slotCount,
        recommendedCharms,
        clipZones,
        pricing: { braceletPrice: 0, charmsPrice: 0, total: 0 },
        clipZonePercents,
      });
    }

    const braceletVariant = findVariantByCode(braceletProduct, braceletVariantCode);
    if (!braceletVariant) {
      return res.status(200).json({
        valid: false,
        errors: [buildError("bracelet.variantCode", "Bracelet variant not found")],
        slotCount,
        recommendedCharms,
        clipZones,
        pricing: { braceletPrice: 0, charmsPrice: 0, total: 0 },
        clipZonePercents,
      });
    }

    // Load charm products.
    const charmIds = [...new Set(items.map((it) => String(it.charmProductId)))];
    const charmProducts = await Product.find({ _id: { $in: charmIds }, deleted: false }).lean();
    const charmById = new Map(charmProducts.map((p) => [String(p._id), p]));

    const validationErrors = [];
    let charmsPrice = 0;

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const charm = charmById.get(String(it.charmProductId));
      if (!charm) {
        validationErrors.push(buildError(`items[${i}].charmProductId`, "Charm product not found"));
        continue;
      }

      const charmVariant = findVariantByCode(charm, it.charmVariantCode);
      if (!charmVariant) {
        validationErrors.push(
          buildError(`items[${i}].charmVariantCode`, "Charm variant not found")
        );
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

      charmsPrice += Number(charmVariant.price) || 0;
    }

    const braceletPrice = Number(braceletVariant.price) || 0;
    const total = braceletPrice + charmsPrice;

    if (validationErrors.length) {
      return res.status(200).json({
        valid: false,
        errors: validationErrors,
        slotCount,
        recommendedCharms,
        clipZones,
        pricing: { braceletPrice, charmsPrice, total },
        clipZonePercents,
      });
    }

    return res.status(200).json({
      valid: true,
      errors: [],
      slotCount,
      recommendedCharms,
      clipZones,
      pricing: { braceletPrice, charmsPrice, total },
      clipZonePercents,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};
