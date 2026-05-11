const crypto = require("crypto");
const Cart = require("../../models/cart.model");
const { ensureGuestIdCookie } = require("../../helper/guest.helper");
const { validateAndPrice } = require("../../helper/mix-validate.helper");

module.exports.getCart = async (req, res) => {
  try {
    const guestId = ensureGuestIdCookie(req, res);
    const cartKey = req.client?._id ? { userId: String(req.client._id) } : { guestId };
    const cart = await Cart.findOne(cartKey).lean();

    // Best-effort cleanup: remove abandoned buyNow lines older than 30 minutes.
    if (cart && Array.isArray(cart.products) && cart.products.length) {
      try {
        const cutoff = new Date(Date.now() - 30 * 60 * 1000);
        await Cart.updateOne(cartKey, {
          $pull: { products: { isBuyNow: true, createdAt: { $lt: cutoff } } },
        });
      } catch {
        // ignore cleanup errors
      }
    }

    const refreshed = req.client?._id
      ? await Cart.findOne({ userId: String(req.client._id) }).lean()
      : await Cart.findOne({ guestId }).lean();

    return res.status(200).json({ data: refreshed || { guestId, products: [], bundles: [] } });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

module.exports.addBundleToCart = async (req, res) => {
  try {
    const guestId = ensureGuestIdCookie(req, res);
    const { bracelet, items, name } = req.body || {};

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

    const cartKey = req.client?._id ? { userId: String(req.client._id) } : { guestId };
    const cart = await Cart.findOneAndUpdate(
      cartKey,
      {
        $setOnInsert: {
          ...(req.client?._id ? { userId: String(req.client._id) } : { guestId }),
          products: [],
        },
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

// Add a legacy product line to cart.products
module.exports.addProductToCart = async (req, res) => {
  try {
    const guestId = ensureGuestIdCookie(req, res);
    const { productId, variantId, quantity, buyNow } = req.body || {};

    if (!productId) return res.status(400).json({ message: "Missing productId" });
    const qty = Number.isFinite(Number(quantity)) ? Math.max(1, Number(quantity)) : 1;

    // Lazy-load Product model to avoid circular deps at top-level
    const Product = require("../../models/product.model");
    const product = await Product.findOne({ _id: productId, deleted: false }).lean();
    if (!product) return res.status(400).json({ message: "Product not found" });

    // Find variant either by _id or by code
    let variant = null;
    if (variantId) {
      variant = (product.variants || []).find((v) => String(v._id) === String(variantId) || String(v.code) === String(variantId));
    } else {
      // default to first variant
      variant = (product.variants || [])[0] || null;
    }
    if (!variant) return res.status(400).json({ message: "Variant not found" });

    const price = Number(variant.price) || 0;

    const cartKey = req.client?._id ? { userId: String(req.client._id) } : { guestId };

    // Try to find existing cart and product line
    let cart = await Cart.findOne(cartKey);
    if (!cart) {
      // create new cart doc
      const initial = {
        ...(req.client?._id ? { userId: String(req.client._id) } : { guestId }),
        products: [],
        bundles: [],
      };
      cart = new Cart(initial);
    }

    // If buyNow requested, create a separate temporary line (quantity forced to 1).
    // Do not merge into the existing cart line.
    let createdLineId = null;
    if (buyNow === true) {
      const newLine = {
        productId: product._id,
        variantId: variant._id,
        quantity: 1,
        price,
        isBuyNow: true,
        createdAt: new Date(),
      };
      cart.products.push(newLine);
      // Use the actual mongoose subdocument id assigned on push
      const pushed = cart.products[cart.products.length - 1];
      createdLineId = pushed && pushed._id ? String(pushed._id) : null;
    } else {
      // Find existing line
      const idx = (cart.products || []).findIndex((p) => String(p.productId) === String(product._id) && String(p.variantId) === String(variant._id));
      if (idx !== -1) {
        cart.products[idx].quantity = (Number(cart.products[idx].quantity) || 0) + qty;
        cart.products[idx].price = Number(price);
      } else {
        const newLine = { productId: product._id, variantId: variant._id, quantity: qty, price, isBuyNow: false, createdAt: new Date() };
        cart.products.push(newLine);
      }
    }

    await cart.save();

    // find the line id we last touched
    const savedCart = cart.toObject ? cart.toObject() : cart;
    let lineId = createdLineId;
    if (!lineId) {
      // match by productId+variantId; prefer non-buyNow lines when not explicitly requested
      const found = (savedCart.products || []).find((p) => String(p.productId) === String(product._id) && String(p.variantId) === String(variant._id));
      lineId = found ? String(found._id) : null;
    }

    return res.status(200).json({ data: savedCart, lineId });
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
    const nextQuantity =
      req.body?.quantity !== undefined ? Number.parseInt(req.body.quantity, 10) : undefined;
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

// Update a legacy product line in cart.products
module.exports.patchProduct = async (req, res) => {
  try {
    const guestId = ensureGuestIdCookie(req, res);
    const { lineId } = req.params;
    if (!lineId) return res.status(400).json({ message: "Missing lineId" });

    const cartKey = req.client?._id ? { userId: String(req.client._id) } : { guestId };
    const cart = await Cart.findOne(cartKey);
    if (!cart) return res.status(404).json({ message: "Cart not found" });

    const idx = (cart.products || []).findIndex((p) => String(p._id) === String(lineId));
    if (idx === -1) return res.status(404).json({ message: "Product line not found" });

    const existing = cart.products[idx];
    if (req.body?.quantity !== undefined) {
      const q = Number.isFinite(Number(req.body.quantity)) ? Math.max(Number(req.body.quantity), 1) : 1;
      existing.quantity = q;
    }

    // Optionally allow variant change (and price update) if provided
    if (req.body?.variantId !== undefined && req.body.variantId !== String(existing.variantId)) {
      const Product = require("../../models/product.model");
      const product = await Product.findOne({ _id: existing.productId, deleted: false }).lean();
      if (!product) return res.status(400).json({ message: "Product not found" });
      const variant = (product.variants || []).find((v) => String(v._id) === String(req.body.variantId) || String(v.code) === String(req.body.variantId));
      if (!variant) return res.status(400).json({ message: "Variant not found" });
      existing.variantId = variant._id;
      existing.price = Number(variant.price) || 0;
    }

    cart.markModified("products");
    await cart.save();

    return res.status(200).json({ data: cart.toObject ? cart.toObject() : cart });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Delete a legacy product line from cart.products
module.exports.deleteProduct = async (req, res) => {
  try {
    const guestId = ensureGuestIdCookie(req, res);
    const { lineId } = req.params;
    if (!lineId) return res.status(400).json({ message: "Missing lineId" });

    const cartKey = req.client?._id ? { userId: String(req.client._id) } : { guestId };
    const cart = await Cart.findOneAndUpdate(
      cartKey,
      { $pull: { products: { _id: String(lineId) } } },
      { new: true },
    ).lean();

    return res.status(200).json({ data: cart || { guestId, products: [], bundles: [] } });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};
