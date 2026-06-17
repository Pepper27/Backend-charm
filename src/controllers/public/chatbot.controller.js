const mongoose = require("mongoose");
const Product = require("../../models/product.model");
const Category = require("../../models/category.model");
const Collection = require("../../models/collection.model");
const Order = require("../../models/order.model");

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-2.0-flash";
const DEFAULT_FALLBACK_MODELS = ["gemini-2.0-flash", "gemini-1.5-flash"];

const MAX_MESSAGE_LENGTH = 2000;
const MAX_HISTORY_ITEMS = 12;
const MAX_RECOMMENDATIONS = 6;
const MAX_SEARCH_RESULTS = 8;

const INTENT = {
  BESTSELLER: "bestseller_search",
  COMPARE: "product_compare",
  SEARCH: "product_search",
  ADVICE: "product_advice",
  SIZE: "size_consult",
  DESIGN: "charm_design_help",
  ORDER: "order_support",
  PAYMENT: "payment_support",
  POLICY: "policy_faq",
  GENERAL: "general_support",
};

const CATEGORY_SYNONYMS = [
  { key: "bracelet", keywords: ["vòng tay", "lac tay", "lắc tay", "bracelet"] },
  { key: "ring", keywords: ["nhẫn", "nhan", "ring"] },
  { key: "necklace", keywords: ["dây chuyền", "day chuyen", "necklace"] },
  { key: "earring", keywords: ["bông tai", "bong tai", "khuyên tai", "earring"] },
  { key: "charm", keywords: ["charm", "hạt charm", "hat charm"] },
];

const MATERIAL_SYNONYMS = [
  { key: "bạc", keywords: ["bạc", "bac", "silver", "sterling"] },
  { key: "mạ vàng", keywords: ["mạ vàng", "ma vang", "gold plated"] },
  { key: "vàng", keywords: ["vàng", "vang", "gold"] },
  { key: "da", keywords: ["dây da", "day da", "leather", "da"] },
];

const PRICE_PATTERNS = [
  { regex: /dưới\s*(\d+[\d.,]*)\s*(triệu|tr|k|nghìn|ngan)?/i, type: "max" },
  { regex: /từ\s*(\d+[\d.,]*)\s*(triệu|tr|k|nghìn|ngan)?\s*(?:đến|-|toi)?\s*(\d+[\d.,]*)?\s*(triệu|tr|k|nghìn|ngan)?/i, type: "range" },
];

const ORDER_CODE_PATTERN = /\b(ORD[A-Z0-9]{8,})\b/i;

const isGlobalChatScope = (context) =>
  Boolean(
    context?.ignorePageRestriction === true ||
      context?.catalogScope === "global" ||
      context?.scope === "global",
  );

const orderStatusLabelVI = (status) => {
  const value = String(status || "");
  if (value === "pending") return "Chờ xác nhận";
  if (value === "confirmed") return "Chờ lấy hàng";
  if (value === "shipping") return "Đang giao";
  if (value === "delivered") return "Đã giao";
  if (value === "cancelled") return "Đã huỷ";
  return value || "đang xử lý";
};

const paymentMethodLabelVI = (method) => {
  const value = String(method || "").toLowerCase();
  if (value === "zalopay") return "ZaloPay";
  if (value === "cash") return "COD (thanh toán khi nhận hàng)";
  return value || "chưa rõ";
};

const extractOrderCode = (message) => {
  const match = String(message || "").match(ORDER_CODE_PATTERN);
  return match ? String(match[1]).trim().toUpperCase() : "";
};

const extractEmail = (message) => {
  const match = String(message || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? String(match[0]).trim().toLowerCase() : "";
};

const extractPhone = (message) => {
  const match = String(message || "").match(/\b(0\d{9,10})\b/);
  return match ? String(match[1]).trim() : "";
};

const asText = (value, max = 300) => {
  const text = String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
};

const asArray = (value) => (Array.isArray(value) ? value : []);

const slugifyLite = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const escapeRegex = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const SEARCH_STOPWORDS = new Set([
  "t",
  "toi",
  "mình",
  "minh",
  "can",
  "cần",
  "cho",
  "xin",
  "goi",
  "gợi",
  "y",
  "ý",
  "tim",
  "tìm",
  "mau",
  "mẫu",
  "san",
  "pham",
  "sản",
  "phẩm",
  "duoi",
  "dưới",
  "tren",
  "trên",
  "tu",
  "từ",
  "den",
  "đến",
  "trieu",
  "triệu",
  "ngan",
  "ngàn",
  "nghin",
  "nghìn",
  "gia",
  "giá",
  "bao",
  "nhieu",
  "nhiêu",
  "tien",
  "tiền",
  "tam",
  "tầm",
  "ngan",
  "sach",
  "sách",
]);

const extractSearchTokens = (value) =>
  uniqueBy(
    slugifyLite(value)
      .split(" ")
      .map((item) => item.trim())
      .filter((item) => item.length >= 2 && !SEARCH_STOPWORDS.has(item) && !/^\d+$/.test(item)),
    (item) => item,
  );

const buildSearchTerms = (raw) => {
  const directTerms = String(raw || "")
    .split(/,|;|\.|\?|!|\n|\band\b|\bvà\b/i)
    .map((item) => asText(item, 120))
    .filter(Boolean);

  const tokenTerms = extractSearchTokens(raw);
  return uniqueBy([...directTerms, ...tokenTerms], (item) => slugifyLite(item));
};

const clampHistory = (history) =>
  asArray(history)
    .slice(-MAX_HISTORY_ITEMS)
    .map((item) => ({
      role: item?.role === "assistant" ? "assistant" : "user",
      content: asText(item?.content, 1200),
    }))
    .filter((item) => item.content);

const uniqueBy = (items, keyFn) => {
  const map = new Map();
  for (const item of items || []) {
    const key = keyFn(item);
    if (!key || map.has(key)) continue;
    map.set(key, item);
  }
  return Array.from(map.values());
};

const normalizeModelName = (value) => {
  let model = String(value || "").trim();
  if (!model) return DEFAULT_MODEL;
  model = model.replace(/^['"]|['"]$/g, "");
  model = model.replace(/^https?:\/\/[^/]+\/v1beta\/models\//i, "");
  model = model.replace(/^models\//i, "");
  model = model.replace(/^\/+/, "");
  model = model.replace(/:generateContent$/i, "");
  return model || DEFAULT_MODEL;
};

const extractPriceNumber = (raw, unit) => {
  const base = Number(String(raw || "").replace(/[^\d.]/g, ""));
  if (!Number.isFinite(base)) return 0;
  const safeUnit = slugifyLite(unit);
  if (["trieu", "tr"].includes(safeUnit)) return Math.round(base * 1000000);
  if (["k", "nghin", "ngan"].includes(safeUnit)) return Math.round(base * 1000);
  return Math.round(base);
};

const extractMeasurementCm = (value) => {
  const match = String(value || "").match(/(\d+(?:[.,]\d+)?)\s*cm/i);
  if (!match) return 0;
  const parsed = Number(String(match[1] || "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatPrice = (min, max) => {
  const safeMin = Number(min) || 0;
  const safeMax = Number(max) || 0;
  if (safeMin <= 0 && safeMax <= 0) return "";
  if (safeMin > 0 && safeMax > 0 && safeMin !== safeMax) {
    return `${safeMin.toLocaleString("vi-VN")}đ - ${safeMax.toLocaleString("vi-VN")}đ`;
  }
  return `${Math.max(safeMin, safeMax).toLocaleString("vi-VN")}đ`;
};

const inferCompareStyleHint = (product) => {
  const hay = slugifyLite(`${product?.name || ""} ${product?.description || ""}`);
  if (/trai tim|heart/.test(hay)) return "phong cách lãng mạn, hợp làm quà tặng";
  if (/nut thac|vo cuc|infinity/.test(hay)) return "ý nghĩa vĩnh cửu, tối giản và thanh lịch";
  if (/rong|dragon/.test(hay)) return "điểm nhấn mạnh mẽ, cá tính";
  if (/murano/.test(hay) && /hong|pink/.test(hay)) return "điểm nhấn màu sắc Murano nhẹ nhàng";
  if (/murano/.test(hay)) return "vẻ Murano tinh tế, dễ phối charm";
  return inferStyleHint(product);
};

const inferStyleHint = (product) => {
  const hay = slugifyLite(`${product?.name || ""} ${product?.description || ""}`);
  if (/crown|royal|vương miện/.test(hay)) return "vẻ sang và cổ điển hơn";
  if (/tron mo|chu c|me|mat xich/.test(hay)) return "phong cách hiện đại và cá tính hơn";
  if (/charm|moments/.test(hay)) return "khả năng phối charm linh hoạt";
  return "kiểu dáng dễ đeo hằng ngày";
};

const isBraceletLike = (product, context) => {
  const hay = slugifyLite(
    `${product?.name || ""} ${product?.categoryName || ""} ${context?.listing?.categoryName || ""} ${context?.product?.categoryName || ""}`,
  );
  return /vong tay|lac tay|bracelet|moments/.test(hay);
};

const chooseBestSizeProduct = ({ catalog, context }) => {
  if (catalog?.products?.length) return catalog.products[0];
  if (!isGlobalChatScope(context) && context?.product) {
    return {
      id: context.product.id,
      slug: context.product.slug,
      name: context.product.name,
      priceText: context.product.priceText,
      materialText: context.product.selectedMaterial || "",
      categoryName: context.product.categoryName || "",
      description: context.product.description || "",
    };
  }
  return null;
};

const buildBraceletSizeAdvice = ({ product, wristCm }) => {
  if (!wristCm || wristCm <= 0) return null;
  const suggested = Math.round((wristCm + 2) * 10) / 10;
  const snug = Math.round((wristCm + 1) * 10) / 10;
  const roomy = Math.round((wristCm + 3) * 10) / 10;
  const display = Number.isInteger(suggested) ? `${suggested}cm` : `${String(suggested).replace(".", ",")}cm`;
  const snugDisplay = Number.isInteger(snug) ? `${snug}cm` : `${String(snug).replace(".", ",")}cm`;
  const roomyDisplay = Number.isInteger(roomy) ? `${roomy}cm` : `${String(roomy).replace(".", ",")}cm`;

  return {
    answer: [
      product?.name ? `Với ${product.name}, nếu cổ tay bạn ${wristCm}cm thì nên chọn khoảng ${display}.` : `Nếu cổ tay bạn ${wristCm}cm thì nên chọn vòng khoảng ${display}.`,
      `Rule mình đang áp dụng là cộng thêm 2cm so với cổ tay để đeo thoải mái hơn.`,
      `Nếu bạn thích đeo ôm tay hơn có thể cân nhắc khoảng ${snugDisplay}. Nếu bạn định phối nhiều charm thì có thể lên khoảng ${roomyDisplay}.`,
    ].join("\n"),
    suggestions: [display, snugDisplay, roomyDisplay],
    quickReplies: ["Mình đeo ít charm thôi", "Mình muốn đeo ôm tay", "Mình muốn phối nhiều charm"],
  };
};

const firstVariantOf = (product) => asArray(product?.variants)[0] || null;

const toProductCard = (product) => {
  const variant = firstVariantOf(product);
  const totalSold = asArray(product?.variants).reduce((sum, item) => sum + (Number(item?.sold) || 0), 0);
  return {
    id: String(product?._id || ""),
    slug: asText(product?.slug, 120),
    name: asText(product?.name, 180),
    image: variant?.images?.[0] || "",
    priceText: formatPrice(product?.priceMin || variant?.price, product?.priceMax || variant?.price),
    materialText: asArray(product?.options?.materials).slice(0, 3).join(", "),
    categoryName: asText(product?.category?.name || "", 120),
    collections: asArray(product?.collections).map((item) => asText(item?.name || item, 80)).filter(Boolean),
    description: asText(product?.description, 220),
    canEngrave: Boolean(product?.engraving?.enabled),
    totalSold,
  };
};

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
    collections: asArray(product.collections).map((item) => asText(item, 60)).filter(Boolean),
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
    matchedProducts: asArray(catalogContext.matchedProducts)
      .slice(0, 8)
      .map((item) => ({
        id: String(item?.id || item?._id || "").trim(),
        slug: asText(item?.slug, 120),
        name: asText(item?.name, 160),
        categoryName: asText(item?.categoryName, 120),
        priceText: asText(item?.priceText, 80),
        materials: asArray(item?.materials).map((material) => asText(material, 60)).filter(Boolean),
      }))
      .filter((item) => item.name),
  };
};

const catalogCardFromContextItem = (item) => ({
  id: String(item?.id || "").trim(),
  slug: asText(item?.slug, 120),
  name: asText(item?.name, 180),
  image: "",
  priceText: asText(item?.priceText, 80),
  materialText: asArray(item?.materials).join(", "),
  categoryName: asText(item?.categoryName, 120),
  collections: [],
  description: "",
  totalSold: 0,
});

const mergeCatalogProducts = (catalog, context) => {
  const frontendProducts = asArray(context?.catalogContext?.matchedProducts).map(catalogCardFromContextItem);
  const backendProducts = asArray(catalog?.products);
  const products = uniqueBy([...frontendProducts, ...backendProducts], (item) => item.id || item.slug || item.name).slice(
    0,
    MAX_SEARCH_RESULTS,
  );
  return {
    ...(catalog || {}),
    products,
  };
};

const summarizeOrderFromDb = (order) => {
  if (!order) return null;
  const items = [];
  for (const line of asArray(order.cart).slice(0, 8)) {
    items.push({
      name: asText(line?.name, 120),
      quantity: Math.max(1, Number(line?.quantity) || 1),
      priceText: formatPrice(line?.price, line?.price),
    });
  }
  for (const bundle of asArray(order.bundles).slice(0, 4)) {
    items.push({
      name: asText(bundle?.name || "Thiết kế mix charm", 120),
      quantity: Math.max(1, Number(bundle?.quantity) || 1),
      priceText: formatPrice(bundle?.priceSnapshot?.total, bundle?.priceSnapshot?.total),
    });
  }
  return {
    orderCode: asText(order.orderCode, 40),
    status: orderStatusLabelVI(order.status),
    paymentStatus: order.payStatus === "paid" ? "Đã thanh toán" : "Chưa thanh toán",
    method: paymentMethodLabelVI(order.method),
    totalText: formatPrice(order.totalPrice, order.totalPrice),
    canCancel: ["pending", "confirmed"].includes(String(order.status || "")),
    items,
    notFound: false,
  };
};

const lookupOrderForChat = async ({ message, context }) => {
  if (!isGlobalChatScope(context) && context?.order?.orderCode) {
    return context.order;
  }

  const orderCode = extractOrderCode(message);
  if (orderCode) {
    const order = await Order.findOne({ orderCode, deleted: false })
      .select("orderCode status method payStatus totalPrice cart bundles createdAt")
      .lean();
    if (!order) return { orderCode, notFound: true };
    return summarizeOrderFromDb(order);
  }

  const email = extractEmail(message);
  const phone = extractPhone(message);
  if (!email && !phone) return null;

  const find = { deleted: false };
  if (email && phone) find.$or = [{ email }, { phone }];
  else if (email) find.email = email;
  else find.phone = phone;

  const orders = await Order.find(find)
    .sort({ createdAt: -1 })
    .select("orderCode status method payStatus totalPrice cart bundles createdAt")
    .limit(3)
    .lean();

  if (!orders.length) {
    return { lookupKey: email || phone, notFound: true };
  }
  if (orders.length === 1) return summarizeOrderFromDb(orders[0]);

  return {
    multiple: true,
    lookupKey: email || phone,
    orders: orders.map((order) => summarizeOrderFromDb(order)),
  };
};

const normalizeContext = (context) => {
  const safe = context && typeof context === "object" ? context : {};
  const activePage =
    safe.activePageContext && typeof safe.activePageContext === "object" ? safe.activePageContext : safe;
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

const detectIntent = ({ message, context }) => {
  const text = slugifyLite(message);
  const globalScope = isGlobalChatScope(context);
  const hasBestSellerKeyword = /ban chay|bestseller|best seller|pho bien|noi bat nhat|hot nhat/.test(text);
  const hasPriceKeyword = /duoi \d|tren \d|tu \d|tam gia|ngan sach|gia bao nhieu|bao nhieu tien|re hon/.test(text);
  const hasDesignKeyword = /mix charm|phoi charm|phoi voi charm|mix voi charm|slot|clip zone|thiet ke|goi y charm/.test(text);
  const hasSearchKeyword = /mua|tim|goi y|tu van|co mau nao|xem them|vong tay|nhan|day chuyen|bong tai|mau charm|charm nao/.test(text);
  const hasOrderKeyword = /don hang|order|ma don|trang thai don|huy don|tra cuu don/.test(text) || Boolean(extractOrderCode(message));

  if (hasBestSellerKeyword) {
    return INTENT.BESTSELLER;
  }
  if (/so sanh|khac nhau|chon mau nao|mau nao hop/.test(text)) {
    return INTENT.COMPARE;
  }
  if (hasOrderKeyword || (!globalScope && context.order?.orderCode)) {
    return INTENT.ORDER;
  }
  if (/zalopay|thanh toan|chuyen khoan|cod|tra gop|huong dan thanh toan/.test(text)) {
    return INTENT.PAYMENT;
  }
  if (/size|kich co|do tay|do ngon|chu vi/.test(text)) {
    return INTENT.SIZE;
  }
  if (hasDesignKeyword || (!globalScope && context.design && !hasPriceKeyword && !hasSearchKeyword && !hasOrderKeyword)) {
    return INTENT.DESIGN;
  }
  if (/bao hanh|chinh sach|doi tra|van chuyen|giao hang|khac chu|khac ten/.test(text)) {
    return INTENT.POLICY;
  }
  if (hasSearchKeyword || hasPriceKeyword || /charm/.test(text)) {
    return INTENT.SEARCH;
  }
  if (!globalScope && context.product) return INTENT.ADVICE;
  return INTENT.GENERAL;
};

const parseProductRequest = (message, context) => {
  const raw = String(message || "");
  const text = slugifyLite(raw);
  const categoryHints = CATEGORY_SYNONYMS.filter((item) => item.keywords.some((word) => text.includes(slugifyLite(word)))).map((item) => item.key);
  const materialHints = MATERIAL_SYNONYMS.filter((item) => item.keywords.some((word) => text.includes(slugifyLite(word)))).map((item) => item.key);

  let priceMin = 0;
  let priceMax = 0;
  for (const pattern of PRICE_PATTERNS) {
    const match = raw.match(pattern.regex);
    if (!match) continue;
    if (pattern.type === "max") {
      priceMax = extractPriceNumber(match[1], match[2]);
      break;
    }
    if (pattern.type === "range") {
      priceMin = extractPriceNumber(match[1], match[2]);
      if (match[3]) priceMax = extractPriceNumber(match[3], match[4] || match[2]);
      break;
    }
  }

  const searchTerms = buildSearchTerms(raw);

  return {
    categoryHints,
    materialHints,
    bestSeller: /ban chay|bestseller|best seller|pho bien|noi bat nhat|hot nhat/i.test(raw),
    priceMin,
    priceMax,
    searchTerms,
    listingCategoryName: context.listing?.categoryName || "",
    listingCategorySlug: context.listing?.categorySlug || "",
  };
};

const cleanCompareName = (name) =>
  asText(
    String(name || "")
      .replace(/\s*[,.]?\s*(so sánh|compare)(\s+giúp(\s+tôi|\s+t)?|\s+2\s+sản\s*phẩm.*)?.*$/gi, "")
      .replace(/\s*\d+\s*sản\s*phẩm\s*này.*$/gi, "")
      .replace(/\s*(giúp(\s+tôi|\s+t)?|nha|nhé|nhe|ạ|a)\s*$/gi, "")
      .replace(/\s*[,.]\s*$/g, "")
      .trim(),
    180,
  );

const stripCompareIntro = (raw) => {
  const text = String(raw || "").trim();
  const colonIdx = text.search(/[:：]/);
  if (colonIdx >= 0) {
    const before = slugifyLite(text.slice(0, colonIdx));
    if (/so sanh|compare|san pham|giup toi|giup t/.test(before)) {
      return text.slice(colonIdx + 1).trim();
    }
  }

  return text
    .replace(/^\s*so sánh(?:\s+\d+\s*sản phẩm này)?(?:\s+giúp(?:\s+tôi|\s+t))?[:：]?\s*/i, "")
    .replace(/^\s*compare(?:\s+\d+\s*products?)?[:：]?\s*/i, "")
    .trim();
};

const COMPARE_TOKEN_STOPWORDS = new Set([
  "san",
  "pham",
  "nay",
  "giup",
  "toi",
  "cho",
  "va",
  "voi",
  "the",
  "and",
  "so",
  "sanh",
  "compare",
  "nao",
  "nhe",
  "nha",
]);

const getCompareTokens = (name) => {
  const cleaned = cleanCompareName(stripCompareIntro(name));
  return uniqueBy(
    slugifyLite(cleaned)
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token.length >= 2 && !COMPARE_TOKEN_STOPWORDS.has(token)),
    (token) => token,
  );
};

const GENERIC_COMPARE_TOKENS = new Set([
  "charm",
  "pandora",
  "moments",
  "vang",
  "hong",
  "bac",
  "silver",
  "ma",
  "14k",
  "k",
  "dinh",
  "da",
  "o",
  "giua",
  "ua",
]);

const getDistinctiveCompareTokens = (name) =>
  getCompareTokens(name)
    .filter((token) => !GENERIC_COMPARE_TOKENS.has(token))
    .sort((left, right) => right.length - left.length);

const getComparePhrases = (name) => {
  const tokens = getCompareTokens(name);
  const phrases = [];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    phrases.push(`${tokens[index]} ${tokens[index + 1]}`);
    if (index < tokens.length - 2) {
      phrases.push(`${tokens[index]} ${tokens[index + 1]} ${tokens[index + 2]}`);
    }
  }
  return uniqueBy(
    phrases
      .map((phrase) => phrase.trim())
      .filter((phrase) => {
        const parts = phrase.split(" ");
        return parts.some((part) => !GENERIC_COMPARE_TOKENS.has(part) && part.length >= 3);
      }),
    (phrase) => phrase,
  ).sort((left, right) => right.length - left.length);
};

const scoreProductNameMatch = (queryName, productName) => {
  const query = slugifyLite(cleanCompareName(stripCompareIntro(queryName)));
  const product = slugifyLite(productName);
  if (!query || !product) return 0;
  if (query === product) return 100;
  if (product.includes(query)) return 98;
  if (query.includes(product)) return 92;

  const tokens = getCompareTokens(queryName);
  if (!tokens.length) return 0;

  let matchedWeight = 0;
  let missedWeight = 0;
  let totalWeight = 0;
  for (const token of tokens) {
    const weight = GENERIC_COMPARE_TOKENS.has(token)
      ? 1
      : token.length >= 6
        ? 5
        : token.length >= 5
          ? 4
          : token.length === 4
            ? 3
            : 2;
    totalWeight += weight;
    if (product.includes(token)) matchedWeight += weight;
    else if (!GENERIC_COMPARE_TOKENS.has(token) && token.length >= 3) missedWeight += weight;
  }

  let score = totalWeight > 0 ? Math.round((matchedWeight / totalWeight) * 100) : 0;
  score = Math.max(0, score - Math.round(missedWeight * 1.35));

  const phrases = getComparePhrases(queryName);
  let phraseHits = 0;
  for (const phrase of phrases.slice(0, 4)) {
    if (product.includes(phrase)) {
      phraseHits += 1;
      score += phrase.length >= 12 ? 14 : 10;
    }
  }

  const productTokens = getCompareTokens(productName).filter((token) => !GENERIC_COMPARE_TOKENS.has(token) && token.length >= 4);
  const queryTokenSet = new Set(tokens);
  let alienPenalty = 0;
  for (const token of productTokens) {
    if (!queryTokenSet.has(token)) alienPenalty += token.length >= 5 ? 8 : 5;
  }
  score = Math.max(0, score - alienPenalty);

  if (phraseHits === 0 && getDistinctiveCompareTokens(queryName).length >= 2) {
    score = Math.max(0, score - 20);
  }

  return Math.min(100, score);
};

const MIN_COMPARE_MATCH_SCORE = 52;
const EXPLICIT_COMPARE_MIN_SCORE = 74;

const hasStrongComparePhraseMatch = (queryName, productName) => {
  const phrases = getComparePhrases(queryName);
  const product = slugifyLite(productName);
  return phrases.slice(0, 3).some((phrase) => phrase.length >= 7 && product.includes(phrase));
};

const fetchCompareCandidates = async (name) => {
  const cleaned = cleanCompareName(stripCompareIntro(name));
  const distinctive = getDistinctiveCompareTokens(cleaned);
  const tokens = getCompareTokens(cleaned).sort((left, right) => right.length - left.length);
  if (!tokens.length) return [];

  const charmDocs = await loadCharmProductsForCompare();
  const charmRanked = rankProductCandidates(cleaned, charmDocs, EXPLICIT_COMPARE_MIN_SCORE);
  if (charmRanked.length) return charmRanked.map((entry) => entry.product);

  if (distinctive.length >= 2) {
    const andDocs = await Product.find({
      deleted: false,
      $and: distinctive.slice(0, Math.min(3, distinctive.length)).map((token) => ({
        name: { $regex: escapeRegex(token), $options: "i" },
      })),
    })
      .populate("category", "name slug")
      .populate("collections", "name slug")
      .select("name slug description options variants priceMin priceMax category collections engraving")
      .limit(16)
      .lean();
    const andRanked = rankProductCandidates(cleaned, andDocs, EXPLICIT_COMPARE_MIN_SCORE);
    if (andRanked.length) return andRanked.map((entry) => entry.product);
  }

  if (distinctive[0]) {
    const primaryDocs = await Product.find({
      deleted: false,
      name: { $regex: escapeRegex(distinctive[0]), $options: "i" },
    })
      .populate("category", "name slug")
      .populate("collections", "name slug")
      .select("name slug description options variants priceMin priceMax category collections engraving")
      .limit(24)
      .lean();
    const primaryRanked = rankProductCandidates(cleaned, primaryDocs, EXPLICIT_COMPARE_MIN_SCORE);
    if (primaryRanked.length) return primaryRanked.map((entry) => entry.product);
  }

  const fetchTokens = uniqueBy(
    [...distinctive, ...tokens.filter((token) => token.length >= 4)].slice(0, 6),
    (token) => token,
  );

  const or = fetchTokens.map((token) => ({
    name: { $regex: escapeRegex(token), $options: "i" },
  }));

  const docs = await Product.find({ deleted: false, $or: or })
    .populate("category", "name slug")
    .populate("collections", "name slug")
    .select("name slug description options variants priceMin priceMax category collections engraving")
    .limit(48)
    .lean();

  const ranked = rankProductCandidates(cleaned, docs, EXPLICIT_COMPARE_MIN_SCORE);
  if (ranked.length) return ranked.map((entry) => entry.product);

  return [];
};

const findProductForCompareName = async (name, excludeIds = []) => {
  const cleaned = cleanCompareName(stripCompareIntro(name));
  if (!cleaned) return null;

  const exact = await findProductByName(cleaned, {});
  if (exact && !excludeIds.map(String).includes(String(exact.id))) {
    const exactScore = scoreProductNameMatch(cleaned, exact.name);
    if (
      exactScore >= EXPLICIT_COMPARE_MIN_SCORE &&
      (hasStrongComparePhraseMatch(cleaned, exact.name) || exactScore >= 88)
    ) {
      return exact;
    }
  }

  const candidates = await fetchCompareCandidates(cleaned);
  const exclude = new Set(excludeIds.map((id) => String(id)));
  const ranked = candidates
    .filter((product) => !exclude.has(String(product?._id || product?.id || "")))
    .map((product) => ({
      product,
      score: scoreProductNameMatch(cleaned, product?.name || ""),
    }))
    .filter(
      (entry) =>
        entry.score >= EXPLICIT_COMPARE_MIN_SCORE &&
        (hasStrongComparePhraseMatch(cleaned, entry.product?.name || "") || entry.score >= 88),
    )
    .sort((left, right) => right.score - left.score);

  return ranked[0] ? toProductCard(ranked[0].product) : null;
};

const loadCharmProductsForCompare = async () => {
  const charmCategories = await Category.find({
    deleted: false,
    $or: [{ slug: /charm/i }, { name: /charm/i }],
  })
    .select("_id")
    .lean();
  const charmCategoryIds = charmCategories.map((item) => item._id).filter(Boolean);
  if (!charmCategoryIds.length) return [];

  return Product.find({ deleted: false, category: { $in: charmCategoryIds } })
    .populate("category", "name slug")
    .populate("collections", "name slug")
    .select("name slug description options variants priceMin priceMax category collections engraving")
    .limit(260)
    .lean();
};

const findProductByNameFuzzy = async (name, context) => {
  const cleaned = cleanCompareName(stripCompareIntro(name));
  if (!cleaned) return null;

  const exact = await findProductByName(cleaned, context);
  if (exact) return exact;

  const candidates = await fetchCompareCandidates(cleaned);
  if (candidates[0]) return toProductCard(candidates[0]);

  return null;
};

const parseCompareNames = (message) => {
  const payload = stripCompareIntro(String(message || "").trim());
  const separators = [" và ", " voi ", " với ", " vs ", " so với "];

  for (const sep of separators) {
    const idx = payload.toLowerCase().indexOf(sep.trim().toLowerCase());
    if (idx > 0) {
      const left = cleanCompareName(payload.slice(0, idx));
      const right = cleanCompareName(payload.slice(idx + sep.length));
      if (left.length >= 3 && right.length >= 3) return [left, right];
    }
  }

  const withoutCompareClause = payload
    .replace(/\s*[,.]?\s*so sánh.*$/i, "")
    .replace(/\s*compare.*$/i, "")
    .trim();

  for (const sep of separators) {
    const idx = withoutCompareClause.toLowerCase().indexOf(sep.trim().toLowerCase());
    if (idx > 0) {
      const left = cleanCompareName(withoutCompareClause.slice(0, idx));
      const right = cleanCompareName(withoutCompareClause.slice(idx + sep.length));
      if (left.length >= 3 && right.length >= 3) return [left, right];
    }
  }

  return [];
};

const extractProductSearchTokens = (name) => getCompareTokens(name);

const rankProductCandidates = (needle, products, minScore = MIN_COMPARE_MATCH_SCORE) =>
  uniqueBy(products || [], (item) => String(item?._id || item?.id || ""))
    .map((product) => ({
      product,
      score: scoreProductNameMatch(needle, product?.name || ""),
    }))
    .filter((entry) => entry.score >= minScore)
    .sort((left, right) => right.score - left.score);

const buildVisibleProductMap = (context) => {
  const visible = asArray(context.listing?.visibleProducts);
  return visible.map((item) => ({
    id: item.id,
    slug: item.slug,
    name: item.name,
    scoreKey: slugifyLite(item.name),
  }));
};

const scoreNameSimilarity = (needle, hay) => {
  const a = slugifyLite(needle);
  const b = slugifyLite(hay);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (b.includes(a) || a.includes(b)) return 70;
  let score = 0;
  for (const token of a.split(" ").filter(Boolean)) {
    if (b.includes(token)) score += 10;
  }
  return score;
};

const findCategoryIds = async (request) => {
  const conditions = [];
  if (request.listingCategorySlug) conditions.push({ slug: request.listingCategorySlug, deleted: false });
  if (request.listingCategoryName) conditions.push({ name: new RegExp(escapeRegex(request.listingCategoryName), "i"), deleted: false });
  for (const hint of request.categoryHints) {
    conditions.push({ slug: new RegExp(escapeRegex(hint), "i"), deleted: false });
    conditions.push({ name: new RegExp(escapeRegex(hint), "i"), deleted: false });
  }
  if (!conditions.length) return [];
  const categories = await Category.find({ $or: conditions }).select("_id").lean();
  return uniqueBy(categories.map((item) => String(item._id)), (item) => item);
};

const buildProductQuery = async (request, context) => {
  const and = [{ deleted: false }];
  const categoryIds = await findCategoryIds(request);
  if (categoryIds.length) {
    const categoryOr = categoryIds.map((id) => {
      if (mongoose.Types.ObjectId.isValid(id)) return new mongoose.Types.ObjectId(id);
      return id;
    });
    and.push({ category: { $in: categoryOr } });
  }

  const orTerms = [];
  const rawTerms = request.searchTerms.length ? request.searchTerms : [context.listing?.query, context.product?.name].filter(Boolean);
  for (const term of rawTerms) {
    const safe = asText(term, 120);
    if (!safe) continue;
    const isLongPhrase = safe.split(" ").length >= 4;
    if (safe.length >= 2 && !isLongPhrase) {
      orTerms.push({ name: { $regex: escapeRegex(safe), $options: "i" } });
      orTerms.push({ description: { $regex: escapeRegex(safe), $options: "i" } });
    }
  }

  for (const material of request.materialHints) {
    orTerms.push({ "options.materials": { $elemMatch: { $regex: escapeRegex(material), $options: "i" } } });
    orTerms.push({ "variants.material": { $regex: escapeRegex(material), $options: "i" } });
  }

  if (orTerms.length) and.push({ $or: orTerms });
  if (request.priceMin > 0) and.push({ priceMax: { $gte: request.priceMin } });
  if (request.priceMax > 0) and.push({ priceMin: { $lte: request.priceMax } });

  return and.length === 1 ? and[0] : { $and: and };
};

const rankProducts = (products, request, context) => {
  const visibleNames = buildVisibleProductMap(context);
  const terms = request.searchTerms.length ? request.searchTerms : [context.product?.name, context.listing?.query].filter(Boolean);
  return uniqueBy(
    (products || [])
      .map((product) => {
        let score = 0;
        const name = product?.name || "";
        const categoryName = product?.category?.name || "";
        for (const term of terms) score += scoreNameSimilarity(term, name);
        for (const hint of request.materialHints) {
          const hay = `${asArray(product?.options?.materials).join(" ")} ${asArray(product?.variants).map((v) => v?.material || "").join(" ")}`;
          if (slugifyLite(hay).includes(slugifyLite(hint))) score += 20;
        }
        for (const hint of request.categoryHints) {
          if (slugifyLite(categoryName).includes(slugifyLite(hint)) || slugifyLite(name).includes(slugifyLite(hint))) score += 20;
        }
        if (visibleNames.some((item) => item.id && String(item.id) === String(product?._id))) score += 10;
        score += Math.min(Number(product?.createdAt ? new Date(product.createdAt).getTime() / 1000000000 : 0), 10);
        return { product, score };
      })
      .sort((a, b) => b.score - a.score)
      .map((item) => item.product),
    (item) => String(item?._id || ""),
  );
};

const searchCatalogProducts = async ({ message, context }) => {
  const request = parseProductRequest(message, context);
  const query = await buildProductQuery(request, context);
  const rows = await Product.find(query)
    .populate("category", "name slug")
    .populate("collections", "name slug")
    .select("name slug description options variants priceMin priceMax category collections engraving createdAt")
    .sort({ createdAt: -1 })
    .limit(24)
    .lean();

  const ranked = rankProducts(rows, request, context).slice(0, MAX_SEARCH_RESULTS);
  const finalProducts = request.bestSeller
    ? [...ranked].sort((a, b) => {
        const soldA = asArray(a?.variants).reduce((sum, item) => sum + (Number(item?.sold) || 0), 0);
        const soldB = asArray(b?.variants).reduce((sum, item) => sum + (Number(item?.sold) || 0), 0);
        return soldB - soldA;
      })
    : ranked;
  return {
    request,
    products: finalProducts.map(toProductCard),
  };
};

const findProductByName = async (name, context) => {
  const cleaned = cleanCompareName(stripCompareIntro(name));
  if (!cleaned) return null;

  const visible = buildVisibleProductMap(context);
  const visibleBest = visible
    .map((item) => ({ ...item, score: scoreProductNameMatch(cleaned, item.name) }))
    .sort((a, b) => b.score - a.score)[0];

  const or = [
    { name: { $regex: escapeRegex(cleaned), $options: "i" } },
    { slug: { $regex: escapeRegex(slugifyLite(cleaned).replace(/\s+/g, "-")), $options: "i" } },
  ];

  const docs = await Product.find({ deleted: false, $or: or })
    .populate("category", "name slug")
    .populate("collections", "name slug")
    .select("name slug description options variants priceMin priceMax category collections engraving")
    .limit(8)
    .lean();

  const best = rankProductCandidates(cleaned, docs)[0];

  if (best?.score >= MIN_COMPARE_MATCH_SCORE) return toProductCard(best.product);
  if (visibleBest?.score >= MIN_COMPARE_MATCH_SCORE && visibleBest?.slug) {
    const fallback = await Product.findOne({ deleted: false, slug: visibleBest.slug })
      .populate("category", "name slug")
      .populate("collections", "name slug")
      .select("name slug description options variants priceMin priceMax category collections engraving")
      .lean();
    return fallback ? toProductCard(fallback) : null;
  }
  return null;
};

const fetchProductBySlug = async (slug) => {
  if (!slug) return null;
  const row = await Product.findOne({ deleted: false, slug })
    .populate("category", "name slug")
    .populate("collections", "name slug")
    .select("name slug description options variants priceMin priceMax category collections engraving")
    .lean();
  return row ? toProductCard(row) : null;
};

const findBestVisibleProduct = async (message, context) => {
  const visible = buildVisibleProductMap(context)
    .map((item) => ({ ...item, score: scoreNameSimilarity(message, item.name) }))
    .sort((a, b) => b.score - a.score)[0];
  if (!visible?.slug || visible.score < 20) return null;
  return fetchProductBySlug(visible.slug);
};

const searchReferencedProduct = async (message) => {
  const tokens = uniqueBy(
    slugifyLite(message)
      .split(" ")
      .filter((token) => token.length >= 4 && !["charm", "mix", "voi", "nao", "ban", "chay", "size", "cm", "nen", "giup"].includes(token)),
    (item) => item,
  ).slice(0, 8);

  if (!tokens.length) return null;

  const regex = new RegExp(tokens.map(escapeRegex).join("|"), "i");
  const rows = await Product.find({ deleted: false, $or: [{ name: regex }, { description: regex }] })
    .populate("category", "name slug")
    .populate("collections", "name slug")
    .select("name slug description options variants priceMin priceMax category collections engraving")
    .limit(12)
    .lean();

  const best = rows
    .map((product) => ({ product, score: scoreNameSimilarity(message, product?.name || "") }))
    .sort((a, b) => b.score - a.score)[0];
  return best?.score >= 20 ? toProductCard(best.product) : null;
};

const resolveConversationProduct = async ({ message, history, context }) => {
  if (!isGlobalChatScope(context) && context?.product?.name) {
    return {
      id: context.product.id,
      slug: context.product.slug,
      name: context.product.name,
      priceText: context.product.priceText,
      materialText: context.product.selectedMaterial || "",
      categoryName: context.product.categoryName || "",
      description: context.product.description || "",
    };
  }

  const candidates = [message, ...history.map((item) => item.content)].filter(Boolean);
  for (const candidate of candidates) {
    if (!isGlobalChatScope(context)) {
      const fromVisible = await findBestVisibleProduct(candidate, context);
      if (fromVisible) return fromVisible;
    }
    const fromSearch = await searchReferencedProduct(candidate);
    if (fromSearch) return fromSearch;
  }
  return null;
};

const buildComparison = async ({ message, context, catalog }) => {
  const names = parseCompareNames(message);
  if (names.length >= 2) {
    const products = [];
    const usedIds = [];
    for (const name of names.slice(0, 2)) {
      const product = await findProductForCompareName(name, usedIds);
      if (!product?.id) continue;
      const matchScore = scoreProductNameMatch(name, product.name);
      if (matchScore < EXPLICIT_COMPARE_MIN_SCORE) continue;
      usedIds.push(product.id);
      products.push(product);
    }
    return { names, products: uniqueBy(products, (item) => item.id) };
  }

  const pool = uniqueBy(
    [...asArray(catalog?.products), ...asArray(context?.catalogContext?.matchedProducts).map(catalogCardFromContextItem)],
    (item) => item.id || item.slug || item.name,
  );

  if (pool.length >= 2) {
    return { names: [], products: pool.slice(0, 2) };
  }

  const fallback = await searchCatalogProducts({ message, context });
  return { names: [], products: fallback.products.slice(0, 2) };
};

const searchCharmProducts = async ({ message, context }) => {
  const charmCategories = await Category.find({
    deleted: false,
    $or: [{ slug: /charm/i }, { name: /charm/i }],
  })
    .select("_id")
    .lean();

  const charmCategoryIds = charmCategories.map((item) => item._id).filter(Boolean);
  const braceletName =
    context.__resolvedProduct?.name ||
    (!isGlobalChatScope(context) ? context.product?.name : "") ||
    (!isGlobalChatScope(context) ? context.design?.braceletName : "") ||
    "";
  const materialHints = parseProductRequest(message, context).materialHints;
  const and = [{ deleted: false }];

  if (charmCategoryIds.length) {
    and.push({ category: { $in: charmCategoryIds } });
  }

  const or = [];
  if (braceletName) {
    const braceletTokens = slugifyLite(braceletName)
      .split(" ")
      .filter((token) => token.length >= 4)
      .slice(0, 3);
    for (const token of braceletTokens) {
      or.push({ name: { $regex: escapeRegex(token), $options: "i" } });
      or.push({ description: { $regex: escapeRegex(token), $options: "i" } });
    }
  }

  for (const material of materialHints) {
    or.push({ "options.materials": { $elemMatch: { $regex: escapeRegex(material), $options: "i" } } });
    or.push({ "variants.material": { $regex: escapeRegex(material), $options: "i" } });
  }

  const query = or.length ? { $and: [...and, { $or: or }] } : (and.length === 1 ? and[0] : { $and: and });
  const rows = await Product.find(query)
    .populate("category", "name slug")
    .populate("collections", "name slug")
    .select("name slug description options variants priceMin priceMax category collections engraving createdAt")
    .sort({ createdAt: -1 })
    .limit(18)
    .lean();

  const mapped = rows.map(toProductCard);
  if (mapped.length) {
    return { request: { categoryHints: ["charm"], materialHints }, products: mapped.slice(0, MAX_SEARCH_RESULTS) };
  }

  const fallbackRows = await Product.find(
    charmCategoryIds.length ? { deleted: false, category: { $in: charmCategoryIds } } : { deleted: false, name: /charm/i },
  )
    .populate("category", "name slug")
    .populate("collections", "name slug")
    .select("name slug description options variants priceMin priceMax category collections engraving createdAt")
    .sort({ createdAt: -1 })
    .limit(MAX_SEARCH_RESULTS)
    .lean();

  return {
    request: { categoryHints: ["charm"], materialHints },
    products: fallbackRows.map(toProductCard),
  };
};

const buildPolicyHints = (message) => {
  const text = slugifyLite(message);
  const answers = [];
  if (/bao hanh/.test(text)) answers.push("Kim Bảo có chính sách bảo hành riêng theo từng dòng sản phẩm. Nếu bạn đang xem sản phẩm cụ thể, mình có thể giải thích kỹ hơn theo mẫu đó.");
  if (/doi tra/.test(text)) answers.push("Với đổi trả, bạn nên kiểm tra tình trạng sản phẩm, hóa đơn và thời gian áp dụng theo chính sách của shop trước khi xác nhận.");
  if (/giao hang|van chuyen/.test(text)) answers.push("Shop có hỗ trợ giao hàng; khi chốt đơn bạn nên kiểm tra kỹ địa chỉ, số điện thoại và phương thức thanh toán phù hợp.");
  if (/khac chu|khac ten/.test(text)) answers.push("Các mẫu có hỗ trợ khắc sẽ cần xác nhận nội dung, kiểu chữ và preview trước khi thêm vào giỏ.");
  return answers;
};

const serializeContextForPrompt = (context) => JSON.stringify(context, null, 2);

const buildSystemInstruction = () => `Bạn là trợ lý bán hàng AI của Kim Bảo Jewelry.

Mục tiêu:
- Tư vấn như một nhân viên bán hàng giỏi, tự nhiên, ngắn gọn, có định hướng chốt đơn.
- Khi đã có dữ liệu catalog từ hệ thống, phải ưu tiên gợi ý 2-5 sản phẩm cụ thể thay vì nói chung chung.
- Nếu khách hỏi so sánh, phải nêu rõ điểm khác nhau, phong cách phù hợp và gợi ý nên chọn mẫu nào cho từng nhu cầu.
- Không bịa ra dữ liệu giá, tồn kho, chính sách, trạng thái đơn hoặc thông tin sản phẩm không có trong dữ liệu.
- Nếu thiếu dữ liệu, nói rõ phần nào đang thiếu rồi đưa bước tiếp theo thực tế.

Định dạng trả về ưu tiên là JSON hợp lệ:
{
  "answer": "câu trả lời chính",
  "suggestions": ["gợi ý ngắn 1", "gợi ý ngắn 2"],
  "quickReplies": ["nút 1", "nút 2", "nút 3"]
}

Nếu không thể trả JSON hợp lệ thì vẫn phải trả lời ngắn gọn, rõ ràng bằng tiếng Việt.`;

const buildUserPrompt = ({ message, context, intent, catalog, comparison, policyHints }) => {
  const catalogLines = asArray(catalog?.products)
    .slice(0, MAX_RECOMMENDATIONS)
    .map((item, index) => `${index + 1}. ${item.name} | ${item.priceText || "liên hệ"} | chất liệu: ${item.materialText || "-"}`)
    .join("\n") || "Không có sản phẩm phù hợp được backend tìm thấy.";

  const compareLines = asArray(comparison?.products)
    .map((item, index) => `${index + 1}. ${item.name} | ${item.priceText || "liên hệ"} | điểm nổi bật: ${inferStyleHint(item)}`)
    .join("\n") || "Không có dữ liệu so sánh đặc biệt.";

  const orderContext = context.__resolvedOrder
    ? JSON.stringify(context.__resolvedOrder, null, 2)
    : "Chưa tra cứu được đơn hàng cụ thể từ tin nhắn.";

  return `Câu hỏi khách hàng: ${message}
Intent nội bộ: ${intent}

Ngữ cảnh website:
${serializeContextForPrompt(context)}

Dữ liệu đơn hàng đã tra cứu:
${orderContext}

Kết quả search catalog nội bộ:
${catalogLines}

Kết quả so sánh nội bộ:
${compareLines}

Gợi ý chính sách nội bộ:
${policyHints.join("\n") || "Không có ghi chú chính sách đặc biệt."}

Yêu cầu trả lời:
- Khách có thể hỏi từ bất kỳ trang nào; đừng bắt họ phải đang ở trang sản phẩm, giỏ hàng hay chi tiết đơn.
- Nếu intent là product_search hoặc product_advice: gợi ý thẳng các mẫu phù hợp nhất từ catalog, đừng nói chung chung.
- Nếu intent là product_compare: so sánh 2 mẫu bằng bullet hoặc các câu ngắn, sau đó kết luận nên chọn mẫu nào cho nhu cầu nào.
- Nếu intent là order_support: ưu tiên dữ liệu đơn đã tra cứu trong ngữ cảnh, không đòi khách phải mở đúng trang đơn hàng.
- Nếu intent là payment_support: hướng dẫn rõ COD và ZaloPay, kèm các bước checkout.
- Nếu khách nói mua vòng tay bạc hoặc tìm sản phẩm, ưu tiên lọc theo chất liệu và category khách nói.
- Nếu catalog có sản phẩm phù hợp, đừng nói là thiếu ngữ cảnh.
- Trả lời tự nhiên, bán hàng khéo, không dài dòng.`;
};

const toGeminiHistory = (history) =>
  history.map((item) => ({
    role: item.role === "assistant" ? "model" : "user",
    parts: [{ text: item.content }],
  }));

const extractText = (data) => {
  const candidates = asArray(data?.candidates);
  for (const candidate of candidates) {
    const parts = asArray(candidate?.content?.parts);
    for (const part of parts) {
      const text = String(part?.text || "").trim();
      if (text) return text;
    }
  }
  return "";
};

const parseStructuredAnswer = (text) => {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  try {
    const parsed = JSON.parse(candidate);
    if (parsed && typeof parsed === "object") return parsed;
    return null;
  } catch {
    return { answer: raw, suggestions: [], quickReplies: [] };
  }
};

const buildDeterministicAnswer = ({ intent, catalog, comparison, context, policyHints }) => {
  if (intent === INTENT.BESTSELLER && catalog.products.length) {
    const top = [...catalog.products]
      .sort((a, b) => (Number(b.totalSold) || 0) - (Number(a.totalSold) || 0))
      .slice(0, 4);
    const request = parseProductRequest(context.__messageRaw || "", context);
    const label = request.categoryHints.includes("charm") ? "mẫu charm" : "mẫu sản phẩm";
    return {
      answer: `Mình gợi ý bạn vài ${label} đang được quan tâm nhiều: ${top.map((item, index) => `${index + 1}. ${item.name}${item.priceText ? ` - ${item.priceText}` : ""}`).join("; ")}. Nếu muốn, mình có thể lọc tiếp theo phong cách thanh lịch, quà tặng hoặc để phối với vòng bạc.`,
      suggestions: top.map((item) => item.name).slice(0, 3),
      quickReplies: ["Lọc charm thanh lịch", "Charm hợp làm quà tặng", "Charm phối với vòng bạc"],
    };
  }

  if (intent === INTENT.SIZE) {
    const wristCm = extractMeasurementCm(context?.route?.search) || 0;
    const messageWristCm = extractMeasurementCm(context?.__messageRaw);
    const finalWristCm = messageWristCm || wristCm;
    const product = chooseBestSizeProduct({ catalog, context });
    if (finalWristCm > 0 && isBraceletLike(product, context)) {
      const advice = buildBraceletSizeAdvice({ product, wristCm: finalWristCm });
      if (advice) return advice;
    }
    if (finalWristCm > 0) {
      return {
        answer: `Nếu số đo cổ tay của bạn là ${finalWristCm}cm thì với vòng tay thường có thể bắt đầu tham khảo size khoảng ${Math.round((finalWristCm + 2) * 10) / 10}cm. Nếu bạn cho mình đúng tên mẫu vòng, mình sẽ chốt size sát hơn cho bạn.`,
        suggestions: [],
        quickReplies: ["Mình đeo ít charm thôi", "Mình muốn đeo ôm tay", "Mình muốn phối nhiều charm"],
      };
    }
  }

  if (intent === INTENT.DESIGN && catalog.products.length) {
    const top = catalog.products.slice(0, 4);
    const braceletName =
      context.__resolvedProduct?.name ||
      (!isGlobalChatScope(context) ? context.product?.name : "") ||
      (!isGlobalChatScope(context) ? context.design?.braceletName : "") ||
      "mẫu vòng bạn đang quan tâm";
    return {
      answer: [
        `${braceletName} sẽ hợp khi mix theo hướng nhẹ nhàng và đồng bộ chất liệu.`,
        `Mình gợi ý bạn ưu tiên các charm bạc hoặc charm có điểm nhấn sáng để vòng nhìn cân đối hơn.`,
        `Một vài charm bạn có thể tham khảo ngay là: ${top.map((item) => item.name).join(", ")}.`,
        `Nếu muốn, mình có thể gợi ý tiếp theo 3 kiểu: thanh lịch, dễ đeo hằng ngày hoặc nổi bật để làm quà tặng.`,
      ].join("\n"),
      suggestions: top.map((item) => item.name).slice(0, 3),
      quickReplies: ["Mix kiểu thanh lịch", "Mix kiểu nổi bật", "Mix ít charm thôi"],
    };
  }

  if (intent === INTENT.COMPARE && comparison.products.length >= 2) {
    const [a, b] = comparison.products;
    const priceA = Number(String(a.priceText || "").replace(/[^\d]/g, ""));
    const priceB = Number(String(b.priceText || "").replace(/[^\d]/g, ""));
    const priceGap = priceA > 0 && priceB > 0 ? Math.abs(priceA - priceB) : 0;
    const cheaper =
      priceA > 0 && priceB > 0 && priceA !== priceB ? (priceA < priceB ? a : b) : null;
    const answer = [
      "Mình so sánh 2 mẫu bạn chọn nhé:",
      "",
      `1. ${a.name}`,
      `${a.priceText ? `- Giá: ${a.priceText}` : "- Giá: liên hệ"}`,
      `${a.materialText ? `- Chất liệu: ${a.materialText}` : ""}`,
      `- Phong cách: ${inferCompareStyleHint(a)}`,
      "",
      `2. ${b.name}`,
      `${b.priceText ? `- Giá: ${b.priceText}` : "- Giá: liên hệ"}`,
      `${b.materialText ? `- Chất liệu: ${b.materialText}` : ""}`,
      `- Phong cách: ${inferCompareStyleHint(b)}`,
      "",
      "Kết luận:",
      priceGap > 0
        ? `- Về giá: chênh lệch khoảng ${priceGap.toLocaleString("vi-VN")}đ${cheaper ? `, ${cheaper.name} đang nhẹ hơn.` : "."}`
        : "- Về giá: hai mẫu đang ở hai mức giá khác nhau, bạn cân nhắc theo ngân sách.",
      `- ${a.name} hợp hơn nếu bạn thích ${inferCompareStyleHint(a)}.`,
      `- ${b.name} hợp hơn nếu bạn muốn ${inferCompareStyleHint(b)}.`,
    ]
      .filter(Boolean)
      .join("\n");
    return {
      answer,
      suggestions: [a.name, b.name].slice(0, 2),
      quickReplies: ["Mẫu nào dễ phối charm hơn?", "Mẫu nào hợp làm quà tặng?", "Lọc thêm mẫu tương tự"],
    };
  }

  if (intent === INTENT.COMPARE) {
    const requestedNames = asArray(comparison?.names).filter(Boolean);
    const foundNames = asArray(comparison?.products).map((item) => item.name);
    if (foundNames.length === 1 && requestedNames.length >= 2) {
      const missing = requestedNames.find((name) => scoreProductNameMatch(name, foundNames[0]) < 50) || requestedNames[1];
      return {
        answer: `Mình tìm được "${foundNames[0]}" nhưng chưa khớp chính xác mẫu "${missing}". Bạn kiểm tra lại tên mẫu thứ hai hoặc gửi link sản phẩm để mình so sánh sát hơn.`,
        suggestions: foundNames,
        quickReplies: ["Thử lại tên mẫu thứ hai", "Gợi ý charm tương tự", "So sánh mẫu khác"],
      };
    }
    if (requestedNames.length >= 2) {
      return {
        answer: `Mình chưa khớp đủ 2 mẫu bạn nêu (${requestedNames.join(" và ")}). Bạn có thể gửi lại tên chính xác như trên website hoặc dán link 2 sản phẩm để mình so sánh chi tiết hơn.`,
        suggestions: requestedNames.slice(0, 2),
        quickReplies: ["Gửi lại tên 2 mẫu", "Gợi ý charm Murano", "Gợi ý charm Pandora"],
      };
    }
  }

  if ((intent === INTENT.SEARCH || intent === INTENT.ADVICE) && catalog.products.length) {
    const top = catalog.products.slice(0, 3);
    const lines = top.map((item, index) => `${index + 1}. ${item.name}${item.priceText ? ` - ${item.priceText}` : ""}`);
    return {
      answer: `Mình thấy vài mẫu khá hợp với nhu cầu của bạn: ${lines.join("; ")}. Nếu bạn muốn, mình có thể lọc tiếp theo ngân sách, kiểu dáng thanh lịch hay kiểu charm để phối hạt.`,
      suggestions: top.map((item) => item.name).slice(0, 3),
      quickReplies: ["Lọc dưới 2 triệu", "Gợi ý mẫu thanh lịch", "Gợi ý mẫu phối charm"],
    };
  }

  if ((intent === INTENT.SEARCH || intent === INTENT.BESTSELLER) && !catalog.products.length) {
    const request = parseProductRequest(context.__messageRaw || "", context);
    const budgetText = request.priceMax > 0 ? ` dưới ${request.priceMax.toLocaleString("vi-VN")}đ` : "";
    const categoryText = request.categoryHints.includes("charm") ? "mẫu charm" : "sản phẩm";
    return {
      answer: `Hiện tại mình chưa tìm thấy ${categoryText}${budgetText} đúng với yêu cầu của bạn. Bạn có thể thử nới ngân sách thêm một chút hoặc để mình gợi ý các mẫu gần mức giá đó nhất.`,
      suggestions: [],
      quickReplies: ["Gợi ý gần 2 triệu nhất", "Nới ngân sách lên 3 triệu", "Lọc charm thanh lịch"],
    };
  }

  if (intent === INTENT.ORDER) {
    const order = context.__resolvedOrder;
    if (order?.multiple && asArray(order.orders).length) {
      const lines = order.orders.map(
        (item, index) =>
          `${index + 1}. ${item.orderCode} - ${item.status}${item.totalText ? ` - ${item.totalText}` : ""}${item.paymentStatus ? ` (${item.paymentStatus})` : ""}`,
      );
      return {
        answer: `Mình tìm thấy ${order.orders.length} đơn gần nhất liên quan đến ${order.lookupKey}:\n${lines.join("\n")}\nBạn có thể gửi mã đơn cụ thể để mình giải thích chi tiết hơn.`,
        suggestions: order.orders.map((item) => item.orderCode).slice(0, 3),
        quickReplies: ["Giải thích trạng thái đơn", "Đơn này có hủy được không?", "Hướng dẫn thanh toán"],
      };
    }
    if (order?.notFound) {
      const key = order.orderCode || order.lookupKey || "thông tin bạn cung cấp";
      return {
        answer: `Mình chưa tìm thấy đơn hàng nào khớp với ${key}. Bạn kiểm tra lại mã đơn (vd: ORD...), email hoặc số điện thoại đã dùng khi đặt hàng nhé.`,
        suggestions: [],
        quickReplies: ["Hướng dẫn tra cứu đơn", "Hướng dẫn thanh toán", "Liên hệ hỗ trợ"],
      };
    }
    if (order?.orderCode) {
      return {
        answer: `Đơn ${order.orderCode} hiện đang ở trạng thái ${order.status || "đang xử lý"}${order.paymentStatus ? `, thanh toán: ${order.paymentStatus}` : ""}${order.method ? `, phương thức: ${order.method}` : ""}${order.totalText ? `, tổng tiền: ${order.totalText}` : ""}. ${order.canCancel ? "Đơn này vẫn có thể hủy nếu bạn cần." : "Nếu bạn muốn, mình có thể giải thích tiếp bước tiếp theo của đơn này."}`,
        suggestions: [order.status, order.paymentStatus].filter(Boolean),
        quickReplies: ["Đơn này có hủy được không?", "Giải thích trạng thái đơn", "Hướng dẫn thanh toán lại"],
      };
    }
    return {
      answer:
        "Bạn có thể tra cứu đơn bằng mã đơn (vd: ORD...), email hoặc số điện thoại đã dùng khi mua. Nếu chưa có mã, vào mục Đơn hàng trên website và nhập email/số điện thoại để xem danh sách đơn.",
      suggestions: [],
      quickReplies: ["Hướng dẫn tra cứu đơn", "Hướng dẫn thanh toán", "Đơn chưa thanh toán xử lý sao?"],
    };
  }

  if (intent === INTENT.PAYMENT) {
    return {
      answer: [
        "Kim Bảo hiện hỗ trợ các cách thanh toán sau:",
        "1. COD (thanh toán khi nhận hàng): chọn phương thức tiền mặt khi checkout, kiểm tra địa chỉ và số điện thoại trước khi đặt.",
        "2. ZaloPay: thanh toán online ngay sau khi đặt đơn, phù hợp nếu bạn muốn xác nhận nhanh.",
        "Các bước chung: thêm sản phẩm vào giỏ → vào Thanh toán → chọn địa chỉ → chọn phương thức → xác nhận đơn.",
      ].join("\n"),
      suggestions: ["COD", "ZaloPay"],
      quickReplies: ["COD khác gì ZaloPay?", "Thanh toán lại đơn cũ", "Đơn chưa thanh toán xử lý sao?"],
    };
  }

  if (intent === INTENT.POLICY && policyHints.length) {
    return {
      answer: policyHints.join(" "),
      suggestions: [],
      quickReplies: ["Chính sách bảo hành", "Khắc chữ như thế nào?", "Hướng dẫn giao hàng"],
    };
  }

  return {
    answer: `Mình có thể hỗ trợ bạn tìm sản phẩm, so sánh mẫu, chọn size, tư vấn mix charm hoặc giải thích đơn hàng. Bạn có thể nói rõ hơn như: "mình cần vòng tay bạc dưới 2 triệu" hoặc "so sánh giúp mình 2 mẫu này".`,
    suggestions: [],
    quickReplies: ["Tìm vòng tay bạc", "So sánh 2 mẫu", "Hướng dẫn chọn size"],
  };
};

const callGeminiOnce = async ({ apiKey, model, message, history, context, intent, catalog, comparison, policyHints }) => {
  const url = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const payload = {
    systemInstruction: { parts: [{ text: buildSystemInstruction() }] },
    contents: [
      ...toGeminiHistory(history),
      { role: "user", parts: [{ text: buildUserPrompt({ message, context, intent, catalog, comparison, policyHints }) }] },
    ],
    generationConfig: {
      temperature: 0.55,
      topP: 0.9,
      maxOutputTokens: 700,
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const messageText = data?.error?.message || data?.message || `Gemini request failed (${response.status})`;
    const err = new Error(messageText);
    err.status = response.status;
    throw err;
  }

  const text = extractText(data);
  const structured = parseStructuredAnswer(text);
  if (!structured || !structured.answer) {
    throw new Error("Gemini returned an invalid response");
  }

  return {
    answer: asText(structured.answer, 4000),
    suggestions: asArray(structured.suggestions).map((item) => asText(item, 120)).filter(Boolean).slice(0, 4),
    quickReplies: asArray(structured.quickReplies).map((item) => asText(item, 80)).filter(Boolean).slice(0, 4),
  };
};

const requestGemini = async ({ apiKey, model, message, history, context, intent, catalog, comparison, policyHints }) => {
  const primaryModel = normalizeModelName(model);
  const fallbackModels = uniqueBy(
    [
      primaryModel,
      ...String(process.env.GEMINI_FALLBACK_MODELS || "")
        .split(",")
        .map((item) => normalizeModelName(item))
        .filter(Boolean),
      ...DEFAULT_FALLBACK_MODELS,
    ],
    (item) => item,
  );

  let lastError = null;
  for (const currentModel of fallbackModels) {
    try {
      return await callGeminiOnce({
        apiKey,
        model: currentModel,
        message,
        history,
        context,
        intent,
        catalog,
        comparison,
        policyHints,
      });
    } catch (error) {
      lastError = error;
      const messageText = String(error?.message || "").toLowerCase();
      const canRetry = /high demand|unavailable|invalid response|deadline|timeout|internal/.test(messageText);
      if (!canRetry || currentModel === fallbackModels[fallbackModels.length - 1]) break;
    }
  }
  throw lastError || new Error("Gemini request failed");
};

const getCollectionSuggestions = async (context) => {
  const slug = context.listing?.collectionSlug;
  if (!slug) return [];
  const collection = await Collection.findOne({ slug, deleted: false }).select("_id").lean();
  if (!collection?._id) return [];
  const rows = await Product.find({ deleted: false, collections: collection._id })
    .populate("category", "name slug")
    .populate("collections", "name slug")
    .select("name slug description options variants priceMin priceMax category collections engraving")
    .limit(MAX_RECOMMENDATIONS)
    .lean();
  return rows.map(toProductCard);
};

const findRecommendations = async ({ intent, message, context, catalog, comparison }) => {
  if (intent === INTENT.COMPARE && comparison.products.length) {
    return comparison.products.slice(0, 2);
  }
  if (catalog.products.length) return catalog.products.slice(0, MAX_RECOMMENDATIONS);
  if (intent === INTENT.SEARCH || intent === INTENT.BESTSELLER) return [];
  if (!isGlobalChatScope(context) && context.product?.categoryId) {
    const rows = await Product.find({ deleted: false, category: context.product.categoryId, _id: { $ne: context.product.id || undefined } })
      .populate("category", "name slug")
      .populate("collections", "name slug")
      .select("name slug description options variants priceMin priceMax category collections engraving")
      .limit(MAX_RECOMMENDATIONS)
      .lean();
    return rows.map(toProductCard);
  }
  const collectionSuggestions = await getCollectionSuggestions(context);
  if (collectionSuggestions.length) return collectionSuggestions;
  if (context.wishlist?.items?.length) {
    return context.wishlist.items.slice(0, MAX_RECOMMENDATIONS).map((item) => ({
      id: item.id,
      slug: item.slug,
      name: item.name,
      image: "",
      priceText: item.priceText,
    }));
  }
  const fallbackSearch = await searchCatalogProducts({ message, context });
  if (fallbackSearch.products.length) return fallbackSearch.products.slice(0, MAX_RECOMMENDATIONS);
  const rows = await Product.find({ deleted: false })
    .populate("category", "name slug")
    .populate("collections", "name slug")
    .select("name slug description options variants priceMin priceMax category collections engraving")
    .sort({ createdAt: -1 })
    .limit(MAX_RECOMMENDATIONS)
    .lean();
  return rows.map(toProductCard);
};

module.exports.sendMessage = async (req, res) => {
  try {
    const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
    if (!apiKey) {
      return res.status(503).json({ message: "Chatbot chưa được cấu hình Gemini API key", code: "chatbot_missing_api_key" });
    }

    const model = normalizeModelName(process.env.GEMINI_MODEL || DEFAULT_MODEL);
    const rawMessage = String(req.body?.message || "").trim();
    if (!rawMessage) {
      return res.status(400).json({ message: "Tin nhắn không được để trống" });
    }

    const message = rawMessage.length > MAX_MESSAGE_LENGTH ? rawMessage.slice(0, MAX_MESSAGE_LENGTH) : rawMessage;
    const history = clampHistory(req.body?.history);
    const context = normalizeContext(req.body?.context);
    context.__messageRaw = message;
    context.__resolvedProduct = await resolveConversationProduct({ message, history, context });
    context.__resolvedOrder = await lookupOrderForChat({ message, context });
    const intent = detectIntent({ message, context });

    const needsCatalogSearch = [
      INTENT.BESTSELLER,
      INTENT.SEARCH,
      INTENT.ADVICE,
      INTENT.SIZE,
      INTENT.GENERAL,
      INTENT.COMPARE,
    ].includes(intent);

    let catalog = needsCatalogSearch
      ? await searchCatalogProducts({ message, context })
      : intent === INTENT.DESIGN
        ? await searchCharmProducts({ message, context })
        : { request: parseProductRequest(message, context), products: [] };
    catalog = mergeCatalogProducts(catalog, context);

    const comparison =
      intent === INTENT.COMPARE ? await buildComparison({ message, context, catalog }) : { names: [], products: [] };
    if (intent === INTENT.COMPARE && comparison.products.length >= 2) {
      const requestedNames = asArray(comparison.names).filter(Boolean);
      const pairsValid =
        requestedNames.length < 2 ||
        requestedNames.every((name) => {
          const best = comparison.products
            .map((product) => ({
              product,
              score: scoreProductNameMatch(name, product.name),
            }))
            .sort((left, right) => right.score - left.score)[0];
          return (
            best &&
            best.score >= EXPLICIT_COMPARE_MIN_SCORE &&
            (hasStrongComparePhraseMatch(name, best.product.name) || best.score >= 88)
          );
        });
      if (pairsValid) {
        context.__comparisonReady = true;
      }
    }
    const policyHints = buildPolicyHints(message);
    const recommendedProducts = await findRecommendations({ intent, message, context, catalog, comparison });

    let result;
    try {
      if (context.__comparisonReady) {
        result = buildDeterministicAnswer({ intent, catalog, comparison, context, policyHints });
      } else {
        result = await requestGemini({
          apiKey,
          model,
          message,
          history,
          context,
          intent,
          catalog,
          comparison,
          policyHints,
        });
      }
    } catch {
      result = buildDeterministicAnswer({ intent, catalog, comparison, context, policyHints });
    }

    if (!result.quickReplies.length) {
      result.quickReplies =
        intent === INTENT.COMPARE
          ? ["Mẫu nào dễ phối charm hơn?", "Mẫu nào hợp làm quà tặng?", "Xem thêm mẫu tương tự"]
          : intent === INTENT.ORDER
            ? ["Hướng dẫn tra cứu đơn", "Giải thích trạng thái đơn", "Hướng dẫn thanh toán"]
            : intent === INTENT.PAYMENT
              ? ["COD khác gì ZaloPay?", "Thanh toán lại đơn cũ", "Đơn chưa thanh toán xử lý sao?"]
              : intent === INTENT.SEARCH
                ? ["Lọc dưới 2 triệu", "Gợi ý mẫu thanh lịch", "Gợi ý vòng charm"]
                : ["Tìm vòng tay bạc", "So sánh sản phẩm", "Hướng dẫn chọn size"];
    }

    return res.status(200).json({
      message: "OK",
      data: {
        answer: result.answer,
        suggestions: result.suggestions,
        quickReplies: result.quickReplies,
        recommendedProducts: recommendedProducts.slice(0, MAX_RECOMMENDATIONS),
        intent,
      },
    });
  } catch (error) {
    return res.status(500).json({
      message: error?.message || "Chatbot xử lý thất bại",
      code: "chatbot_failed",
    });
  }
};
