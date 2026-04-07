const crypto = require("crypto");
const Cart = require("../../models/cart.model");
const { ensureGuestIdCookie } = require("../../helper/guest.helper");
const { validateAndPrice } = require("../../helper/mix-validate.helper");

module.exports.getCart = async (req, res) => {
  try {
    const guestId = ensureGuestIdCookie(req, res);
    const cart = req.client?._id
      ? await Cart.findOne({ userId: String(req.client._id) }).lean()
      : await Cart.findOne({ guestId }).lean();
    return res.status(200).json({ data: cart || { guestId, products: [], bundles: [] } });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

module.exports.addBundleToCart = async (req, res) => {
  try {
    const guestId = ensureGuestIdCookie(req, res);
    const { bracelet, items } = req.body || {};

    const result = await validateAndPrice({ bracelet, items });
    if (!result.valid) {
      return res.status(200).json(result);
    }

    const bundleId = crypto.randomUUID();
    const bundle = {
      bundleId,
      bracelet: result.braceletSnapshot,
      items: result.itemsSnapshot,
      rulesSnapshot: {
        slotCount: result.slotCount,
        recommendedCharms: result.recommendedCharms,
        clipZonePercents: result.clipZonePercents,
      },
      priceSnapshot: result.pricing,
      quantity: 1,
    };

    const cartKey = req.client?._id ? { userId: String(req.client._id) } : { guestId };
    const cart = await Cart.findOneAndUpdate(
      cartKey,
      {
        $setOnInsert: { ...(req.client?._id ? { userId: String(req.client._id) } : { guestId }), products: [] },
        $push: { bundles: bundle },
      },
      { upsert: true, new: true }
    ).lean();

    return res.status(200).json({
      valid: true,
      errors: [],
      slotCount: result.slotCount,
      recommendedCharms: result.recommendedCharms,
      clipZones: result.clipZones,
      pricing: result.pricing,
      clipZonePercents: result.clipZonePercents,
      bundleId,
      cart,
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

module.exports.patchBundle = async (req, res) => {
  try {
    const guestId = ensureGuestIdCookie(req, res);
    const { bundleId } = req.params;
    if (!bundleId) return res.status(400).json({ message: "Missing bundleId" });

    const cart = req.client?._id
      ? await Cart.findOne({ userId: String(req.client._id) })
      : await Cart.findOne({ guestId });
    if (!cart) return res.status(404).json({ message: "Cart not found" });
    const idx = (cart.bundles || []).findIndex((b) => String(b.bundleId) === String(bundleId));
    if (idx === -1) return res.status(404).json({ message: "Bundle not found" });

    const existing = cart.bundles[idx];
    const nextQuantity = req.body?.quantity !== undefined ? Number.parseInt(req.body.quantity, 10) : undefined;
    const nextItems = req.body?.items !== undefined ? req.body.items : undefined;
    const nextBracelet = req.body?.bracelet !== undefined ? req.body.bracelet : undefined;

    if (nextQuantity !== undefined) {
      const q = Number.isFinite(nextQuantity) ? Math.max(nextQuantity, 1) : 1;
      existing.quantity = q;
    }

    if (nextItems !== undefined || nextBracelet !== undefined) {
      const bracelet = nextBracelet || existing.bracelet;
      const items = nextItems || existing.items;

      const result = await validateAndPrice({
        bracelet: {
          productId: bracelet.productId,
          variantCode: bracelet.variantCode,
          sizeCm: bracelet.sizeCm,
        },
        items,
      });

      if (!result.valid) {
        return res.status(200).json(result);
      }

      existing.bracelet = result.braceletSnapshot;
      existing.items = result.itemsSnapshot;
      existing.rulesSnapshot = {
        slotCount: result.slotCount,
        recommendedCharms: result.recommendedCharms,
        clipZonePercents: result.clipZonePercents,
      };
      existing.priceSnapshot = result.pricing;
    }

    cart.markModified("bundles");
    await cart.save();

    return res.status(200).json({ data: cart.toObject ? cart.toObject() : cart });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

module.exports.deleteBundle = async (req, res) => {
  try {
    const guestId = ensureGuestIdCookie(req, res);
    const { bundleId } = req.params;
    if (!bundleId) return res.status(400).json({ message: "Missing bundleId" });

    const cartKey = req.client?._id ? { userId: String(req.client._id) } : { guestId };
    const cart = await Cart.findOneAndUpdate(
      cartKey,
      { $pull: { bundles: { bundleId: String(bundleId) } } },
      { new: true }
    ).lean();

    return res.status(200).json({ data: cart || { guestId, products: [], bundles: [] } });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};
