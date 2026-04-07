const Product = require("../../models/product.model");
const mixCategoryHelper = require("../../helper/mix-category.helper");
const { getRule, computeClipZones, clipZonePercents, isSnakeChainType } = require("../../config/mix-rules");
const mongoose = require("mongoose");

const parseSize = (value) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
};

const buildCategoryMatchValues = (ids) => {
  const out = [];
  for (const raw of ids || []) {
    const s = String(raw);
    if (!s) continue;
    out.push(s);
    if (mongoose.Types.ObjectId.isValid(s)) {
      out.push(new mongoose.Types.ObjectId(s));
    }
  }
  return out;
};

module.exports.getBracelets = async (req, res) => {
  try {
    const typeCode = req.query.typeCode ? String(req.query.typeCode) : null;
    const sizeCm = req.query.sizeCm ? parseSize(req.query.sizeCm) : null;

    let categoryIds = null;
    if (typeCode) {
      categoryIds = await mixCategoryHelper.getBraceletTypeSubtreeIds(typeCode);
      if (!categoryIds) {
        return res.status(400).json({ message: `Unknown typeCode '${typeCode}'` });
      }
    } else {
      categoryIds = await mixCategoryHelper.getBraceletRootSubtreeIds();
      if (!categoryIds) {
        return res.status(400).json({ message: "Missing bracelet root category (slug 'bracelet')" });
      }
    }

    const find = { deleted: false };
    if (categoryIds) {
      find.category = { $in: buildCategoryMatchValues(categoryIds) };
    }

    // Use aggregate to avoid Mongoose casting issues if `category` is stored as string.
    const products = await Product.aggregate([
      { $match: find },
      { $sort: { createdAt: -1 } },
      { $project: { name: 1, description: 1, category: 1, variants: 1, slug: 1 } },
    ]);

    let rule = null;
    if (typeCode && sizeCm) {
      const r = getRule(typeCode, sizeCm);
      if (r) {
        const slotCount = Number(r.maxCharms) || 0;
        rule = {
          typeCode,
          sizeCm,
          recommendedCharms: Number(r.recommendedCharms) || 0,
          slotCount,
          clipZonePercents,
          clipZones: isSnakeChainType(typeCode) ? computeClipZones(slotCount) : [],
        };
      }
    }

    return res.status(200).json({
      data: products,
      rule,
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

module.exports.getCharms = async (req, res) => {
  try {
    const kind = req.query.kind ? String(req.query.kind) : null;

    const charmIds = await mixCategoryHelper.getCharmRootSubtreeIds();
    if (!charmIds) {
      return res.status(400).json({ message: "Missing charm root category (slug 'charm')" });
    }
    const clipIds = await mixCategoryHelper.getClipSubtreeIds();
    const find = { deleted: false };

    if (kind === "clip") {
      find.category = { $in: buildCategoryMatchValues(clipIds) };
    } else if (kind === "regular") {
      find.category = {
        $in: buildCategoryMatchValues(charmIds),
        $nin: buildCategoryMatchValues(clipIds),
      };
    } else {
      find.category = { $in: buildCategoryMatchValues(charmIds) };
    }

    const products = await Product.aggregate([
      { $match: find },
      { $sort: { createdAt: -1 } },
      { $project: { name: 1, description: 1, category: 1, variants: 1, slug: 1 } },
    ]);

    return res.status(200).json({ data: products });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};
