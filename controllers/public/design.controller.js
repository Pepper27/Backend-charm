const crypto = require("crypto");
const mongoose = require("mongoose");
const Cart = require("../../models/cart.model");
const Design = require("../../models/design.model");
const { ensureGuestIdCookie } = require("../../helper/guest.helper");
const { validateAndPrice } = require("../../helper/mix-validate.helper");

module.exports.listDesigns = async (req, res) => {
  try {
    const guestId = ensureGuestIdCookie(req, res);
    const find = req.client?._id
      ? { userId: new mongoose.Types.ObjectId(req.client._id) }
      : { guestId };
    const designs = await Design.find(find).sort({ createdAt: -1 }).lean();
    return res.status(200).json({ data: designs || [] });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Save a design AND add it to cart as one bundle line item.
module.exports.saveDesignAndAddToCart = async (req, res) => {
  try {
    const guestId = ensureGuestIdCookie(req, res);
    const { name, bracelet, items, userId } = req.body || {};

    // Prefer authenticated client over FE-provided userId.
    let parsedUserId = req.client?._id ? new mongoose.Types.ObjectId(req.client._id) : null;
    if (!parsedUserId && userId !== undefined && userId !== null && String(userId).trim()) {
      const v = String(userId).trim();
      if (!mongoose.Types.ObjectId.isValid(v)) {
        return res.status(400).json({ message: "Invalid userId" });
      }
      parsedUserId = new mongoose.Types.ObjectId(v);
    }

    const result = await validateAndPrice({ bracelet, items });
    if (!result.valid) {
      return res.status(200).json(result);
    }

    const bundleId = crypto.randomUUID();
    const bundle = {
      bundleId,
      name: typeof name === "string" ? name.trim() : "",
      bracelet: result.braceletSnapshot,
      items: result.itemsSnapshot,
      rulesSnapshot: {
        slotCount: result.slotCount,
        recommendedCharms: result.recommendedCharms,
        clipZonePercents: result.clipZonePercents,
      },
      priceSnapshot: result.pricing,
      quantity: 1,
      createdAt: new Date(),
    };

    // Cart upsert.
    let cart = null;
    try {
      const cartKey = parsedUserId ? { userId: String(parsedUserId) } : { guestId };
      cart = await Cart.findOneAndUpdate(
        cartKey,
        {
          $setOnInsert: { ...(parsedUserId ? { userId: String(parsedUserId) } : { guestId }), products: [] },
          $push: { bundles: bundle },
        },
        { upsert: true, new: true }
      ).lean();

      // Per spec: we do not persist "My designs" for guest.
      // Only persist a Design document when the user is authenticated / has userId.
      let design = null;
      if (parsedUserId) {
        design = await Design.create({
          guestId,
          userId: parsedUserId,
          name: typeof name === "string" ? name.trim() : "",
          bracelet: result.braceletSnapshot,
          items: result.itemsSnapshot,
          rulesSnapshot: {
            slotCount: result.slotCount,
            recommendedCharms: result.recommendedCharms,
            clipZonePercents: result.clipZonePercents,
          },
          priceSnapshot: result.pricing,
          createdBundleId: bundleId,
        });
      }

        return res.status(200).json({
          valid: true,
          errors: [],
          slotCount: result.slotCount,
          recommendedCharms: result.recommendedCharms,
          clipZones: result.clipZones,
          pricing: result.pricing,
          clipZonePercents: result.clipZonePercents,
          bundleId,
          design,
          cart,
        });
    } catch (error) {
      // Best-effort rollback: if design save fails after cart write.
      if (bundleId) {
        const cartKey = parsedUserId ? { userId: String(parsedUserId) } : { guestId };
        await Cart.updateOne(cartKey, { $pull: { bundles: { bundleId } } }).catch(() => {});
      }
      throw error;
    }
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

module.exports.deleteDesign = async (req, res) => {
  try {
    const guestId = ensureGuestIdCookie(req, res);
    const { designId } = req.params;
    if (!designId) return res.status(400).json({ message: "Missing designId" });
    if (!mongoose.Types.ObjectId.isValid(designId)) return res.status(400).json({ message: "Invalid designId" });

    const key = req.client?._id
      ? { _id: designId, userId: new mongoose.Types.ObjectId(req.client._id) }
      : { _id: designId, guestId };
    const deleted = await Design.findOneAndDelete(key).lean();
    return res.status(200).json({ data: deleted || null });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};
