const { MAX_SEARCH_RESULTS, asArray, asText, formatPrice, uniqueBy } = require("./shared");

const isGlobalChatScope = (context) =>
  Boolean(
    context?.ignorePageRestriction === true ||
    context?.catalogScope === "global" ||
    context?.scope === "global"
  );

const summarizeProduct = (product) => {
  if (!product || typeof product !== "object") return null;
  return {
    id: String(product.id || product._id || "").trim(),
    slug: asText(product.slug, 120),
    name: asText(product.name, 160),
    categoryId: String(product.categoryId || product.category?._id || "").trim(),
    categoryName: asText(product.categoryName || product.category?.name, 120),
    priceText: asText(product.priceText, 80),
    priceMin: Number(product.priceMin) || 0,
    priceMax: Number(product.priceMax) || 0,
    selectedSize: asText(product.selectedSize, 40),
    selectedMaterial: asText(product.selectedMaterial, 80),
    selectedColor: asText(product.selectedColor, 80),
    canEngrave: Boolean(product.canEngrave),
    collections: asArray(product.collections)
      .map((item) => asText(item, 60))
      .filter(Boolean),
    description: asText(product.description, 220),
  };
};

const summarizeCart = (cart) => {
  if (!cart || typeof cart !== "object") return null;
  const items = asArray(cart.items)
    .slice(0, 8)
    .map((item) => ({
      name: asText(item?.name, 120),
      quantity: Math.max(1, Number(item?.quantity) || 1),
      kind: asText(item?.kind, 30),
      priceText: asText(item?.priceText, 80),
    }))
    .filter((item) => item.name);
  return {
    itemCount: Math.max(0, Number(cart.itemCount) || items.length),
    totalText: asText(cart.totalText, 80),
    items,
  };
};

const summarizeOrder = (order) => {
  if (!order || typeof order !== "object") return null;
  const items = asArray(order.items)
    .slice(0, 8)
    .map((item) => ({
      name: asText(item?.name, 120),
      quantity: Math.max(1, Number(item?.quantity) || 1),
      priceText: asText(item?.priceText, 80),
    }))
    .filter((item) => item.name);
  return {
    orderCode: asText(order.orderCode, 40),
    status: asText(order.status, 40),
    paymentStatus: asText(order.paymentStatus, 40),
    method: asText(order.method, 40),
    totalText: asText(order.totalText, 80),
    canCancel: Boolean(order.canCancel),
    items,
  };
};

const summarizeDesign = (design) => {
  if (!design || typeof design !== "object") return null;
  return {
    braceletType: asText(design.braceletType, 60),
    braceletName: asText(design.braceletName, 120),
    sizeCm: Number(design.sizeCm) || 0,
    usedSlots: Math.max(0, Number(design.usedSlots) || 0),
    slotCount: Math.max(0, Number(design.slotCount) || 0),
    totalText: asText(design.totalText, 80),
    selectedCharmName: asText(design.selectedCharmName, 120),
  };
};

const summarizeListing = (listing) => {
  if (!listing || typeof listing !== "object") return null;
  return {
    query: asText(listing.query, 120),
    categorySlug: asText(listing.categorySlug, 80),
    categoryName: asText(listing.categoryName, 120),
    collectionSlug: asText(listing.collectionSlug, 80),
    collectionName: asText(listing.collectionName, 120),
    totalResults: Math.max(0, Number(listing.totalResults) || 0),
    visibleProducts: asArray(listing.visibleProducts)
      .slice(0, 8)
      .map((item) => ({
        id: String(item?.id || item?._id || "").trim(),
        slug: asText(item?.slug, 120),
        name: asText(item?.name, 120),
        priceText: asText(item?.priceText, 80),
      }))
      .filter((item) => item.name),
  };
};

const summarizeCatalogContext = (catalogContext) => {
  if (!catalogContext || typeof catalogContext !== "object") return null;
  return {
    scope: asText(catalogContext.scope, 40),
    totalProducts: Math.max(0, Number(catalogContext.totalProducts) || 0),
    categories: asArray(catalogContext.categories)
      .slice(0, 20)
      .map((item) => ({
        id: String(item?.id || item?._id || "").trim(),
        slug: asText(item?.slug, 80),
        name: asText(item?.name, 120),
      }))
      .filter((item) => item.name),
  };
};

const normalizeContext = (context) => {
  const safe = context && typeof context === "object" ? context : {};
  const activePage =
    safe.activePageContext && typeof safe.activePageContext === "object"
      ? safe.activePageContext
      : safe;
  const globalScope = isGlobalChatScope(safe);
  const base = {
    scope: globalScope ? "global" : asText(safe.scope || safe.catalogScope, 40),
    ignorePageRestriction: globalScope || Boolean(safe.ignorePageRestriction),
    catalogScope: asText(safe.catalogScope, 40),
    catalogContext: summarizeCatalogContext(safe.catalogContext),
    pageType: asText(safe.pageType || activePage.pageType, 40),
    route: {
      pathname: asText(safe.route?.pathname, 120),
      search: asText(safe.route?.search, 300),
    },
    user: {
      firstName: asText(safe.user?.firstName || activePage.user?.firstName, 40),
      isLoggedIn: Boolean(safe.user?.isLoggedIn || activePage.user?.isLoggedIn),
    },
  };

  if (globalScope) {
    return {
      ...base,
      product: null,
      cart: null,
      order: null,
      design: null,
      listing: null,
      wishlist: { count: 0, items: [] },
    };
  }

  return {
    ...base,
    product: summarizeProduct(activePage.product || safe.product),
    cart: summarizeCart(activePage.cart || safe.cart),
    order: summarizeOrder(activePage.order || safe.order),
    design: summarizeDesign(activePage.design || safe.design),
    listing: summarizeListing(activePage.listing || safe.listing),
    wishlist: {
      count: Math.max(0, Number(activePage.wishlist?.count || safe.wishlist?.count) || 0),
      items: asArray(activePage.wishlist?.items || safe.wishlist?.items)
        .slice(0, 6)
        .map((item) => ({
          id: String(item?.id || item?._id || "").trim(),
          slug: asText(item?.slug, 120),
          name: asText(item?.name, 120),
          priceText: asText(item?.priceText, 80),
        }))
        .filter((item) => item.name),
    },
  };
};

const mergeCatalogProducts = (catalog) => {
  const backendProducts = asArray(catalog?.products);
  const products = uniqueBy(backendProducts, (item) => item.id || item.slug || item.name).slice(
    0,
    MAX_SEARCH_RESULTS
  );
  return {
    ...(catalog || {}),
    products,
  };
};

module.exports = {
  isGlobalChatScope,
  normalizeContext,
  mergeCatalogProducts,
  summarizeOrder,
  summarizeProduct,
  summarizeCart,
  summarizeDesign,
  summarizeListing,
  summarizeCatalogContext,
};
