const mongoose = require("mongoose");
const Product = require("../../models/product.model");
const Category = require("../../models/category.model");
const Collection = require("../../models/collection.model");

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
  if (context?.product) {
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

const normalizeContext = (context) => {
  const safe = context && typeof context === "object" ? context : {};
  return {
    pageType: asText(safe.pageType, 40),
    route: {
      pathname: asText(safe.route?.pathname, 120),
      search: asText(safe.route?.search, 300),
    },
    product: summarizeProduct(safe.product),
    cart: summarizeCart(safe.cart),
    order: summarizeOrder(safe.order),
    design: summarizeDesign(safe.design),
    listing: summarizeListing(safe.listing),
    wishlist: {
      count: Math.max(0, Number(safe.wishlist?.count) || 0),
      items: asArray(safe.wishlist?.items)
        .slice(0, 6)
        .map((item) => ({
          id: String(item?.id || item?._id || "").trim(),
          slug: asText(item?.slug, 120),
          name: asText(item?.name, 120),
          priceText: asText(item?.priceText, 80),
        }))
        .filter((item) => item.name),
    },
    user: {
      firstName: asText(safe.user?.firstName, 40),
      isLoggedIn: Boolean(safe.user?.isLoggedIn),
    },
  };
};

const detectIntent = ({ message, context }) => {
  const text = slugifyLite(message);
  const hasBestSellerKeyword = /ban chay|bestseller|best seller|pho bien|noi bat nhat|hot nhat/.test(text);
  const hasPriceKeyword = /duoi \d|tren \d|tu \d|tam gia|ngan sach|gia bao nhieu|bao nhieu tien|re hon/.test(text);
  const hasDesignKeyword = /mix charm|phoi charm|phoi voi charm|mix voi charm|slot|clip zone|thiet ke/.test(text);
  const hasSearchKeyword = /mua|tim|goi y|tu van|co mau nao|xem them|vong tay|nhan|day chuyen|bong tai|mau charm|charm nao/.test(text);

  if (hasBestSellerKeyword) {
    return INTENT.BESTSELLER;
  }
  if (/so sanh|khac nhau|chon mau nao|mau nao hop/.test(text) && /\sva\s|\svoi\s/.test(text)) {
    return INTENT.COMPARE;
  }
  if (/don hang|order|ma don|trang thai don|huy don/.test(text) || context.order?.orderCode) {
    return INTENT.ORDER;
  }
  if (/zalopay|thanh toan|chuyen khoan|cod|tra gop/.test(text)) {
    return INTENT.PAYMENT;
  }
  if (/size|kich co|do tay|do ngon|chu vi/.test(text)) {
    return INTENT.SIZE;
  }
  if (hasDesignKeyword || (context.design && !hasPriceKeyword && !hasSearchKeyword)) {
    return INTENT.DESIGN;
  }
  if (/bao hanh|chinh sach|doi tra|van chuyen|giao hang|khac chu|khac ten/.test(text)) {
    return INTENT.POLICY;
  }
  if (hasSearchKeyword || hasPriceKeyword || /charm/.test(text)) {
    return INTENT.SEARCH;
  }
  if (context.product) return INTENT.ADVICE;
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

const parseCompareNames = (message) => {
  const raw = String(message || "").trim();
  const normalized = raw.replace(/so sánh giúp t|so sánh giúp tôi|so sánh|compare/gi, "").trim();
  const separators = [" và ", " voi ", " với ", " vs ", " so với "];
  for (const sep of separators) {
    const idx = normalized.toLowerCase().indexOf(sep.trim().toLowerCase());
    if (idx > 0) {
      const left = normalized.slice(0, idx).replace(/[:,-]+$/g, "").trim();
      const right = normalized.slice(idx + sep.length).replace(/^[:,-]+/g, "").trim();
      if (left && right) return [left, right];
    }
  }
  return [];
};

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
  
  // Xác định điều kiện sort của MongoDB trước khi truy vấn
  let sortCondition = { createdAt: -1 };
  if (request.bestSeller) {
    // Vì 'sold' nằm trong từng variantSchema, bạn có thể tính tổng hoặc 
    // tốt nhất là nên có 1 trường 'totalSold' tầng root ở Product schema được tính qua pre-save.
    // Nếu chưa có trường root, tạm thời sort theo variant đầu tiên hoặc dùng aggregation.
    sortCondition = { "variants.sold": -1 }; 
  }

  const rows = await Product.find(query)
    .populate("category", "name slug")
    .populate("collections", "name slug")
    .select("name slug description options variants priceMin priceMax category collections engraving createdAt")
    .sort(sortCondition) 
    .limit(24)
    .lean();

  const ranked = rankProducts(rows, request, context).slice(0, MAX_SEARCH_RESULTS);
  return {
    request,
    products: ranked,
  };
};

const findProductByName = async (name, context) => {
  const visible = buildVisibleProductMap(context);
  const visibleBest = visible
    .map((item) => ({ ...item, score: scoreNameSimilarity(name, item.name) }))
    .sort((a, b) => b.score - a.score)[0];

  const or = [
    { name: { $regex: escapeRegex(name), $options: "i" } },
    { slug: { $regex: escapeRegex(slugifyLite(name).replace(/\s+/g, "-")), $options: "i" } },
  ];

  const docs = await Product.find({ deleted: false, $or: or })
    .populate("category", "name slug")
    .populate("collections", "name slug")
    .select("name slug description options variants priceMin priceMax category collections engraving")
    .limit(8)
    .lean();

  const best = docs
    .map((product) => ({ product, score: scoreNameSimilarity(name, product?.name || "") }))
    .sort((a, b) => b.score - a.score)[0];

  if (best?.score >= 20) return toProductCard(best.product);
  if (visibleBest?.score >= 20 && visibleBest?.slug) {
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
  if (context.product?.name) {
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
    const fromVisible = await findBestVisibleProduct(candidate, context);
    if (fromVisible) return fromVisible;
    const fromSearch = await searchReferencedProduct(candidate);
    if (fromSearch) return fromSearch;
  }
  return null;
};

const buildComparison = async ({ message, context }) => {
  const names = parseCompareNames(message);
  if (names.length < 2) return { names: [], products: [] };
  const products = [];
  for (const name of names.slice(0, 2)) {
    const product = await findProductByName(name, context);
    if (product) products.push(product);
  }
  return { names, products: uniqueBy(products, (item) => item.id) };
};

const searchCharmProducts = async ({ message, context }) => {
  const charmCategories = await Category.find({
    deleted: false,
    $or: [{ slug: /charm/i }, { name: /charm/i }],
  })
    .select("_id")
    .lean();

  const charmCategoryIds = charmCategories.map((item) => item._id).filter(Boolean);
  const braceletName = context.__resolvedProduct?.name || context.product?.name || "";
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

  return `Câu hỏi khách hàng: ${message}
Intent nội bộ: ${intent}

Ngữ cảnh website:
${serializeContextForPrompt(context)}

Kết quả search catalog nội bộ:
${catalogLines}

Kết quả so sánh nội bộ:
${compareLines}

Gợi ý chính sách nội bộ:
${policyHints.join("\n") || "Không có ghi chú chính sách đặc biệt."}

Yêu cầu trả lời:
- Nếu intent là product_search hoặc product_advice: gợi ý thẳng các mẫu phù hợp nhất từ catalog, đừng nói chung chung.
- Nếu intent là product_compare: so sánh 2 mẫu bằng bullet hoặc các câu ngắn, sau đó kết luận nên chọn mẫu nào cho nhu cầu nào.
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
    const braceletName = context.__resolvedProduct?.name || context.product?.name || context.design?.braceletName || "mẫu vòng này";
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
    const answer = [
      `Mình so sánh nhanh cho bạn nhé:`,
      `1. ${a.name}`,
      `${a.priceText ? `- Giá: ${a.priceText}` : "- Giá: liên hệ"}`,
      `${a.materialText ? `- Chất liệu: ${a.materialText}` : ""}`,
      `- Hợp nếu bạn thích ${inferStyleHint(a)}.`,
      ``,
      `2. ${b.name}`,
      `${b.priceText ? `- Giá: ${b.priceText}` : "- Giá: liên hệ"}`,
      `${b.materialText ? `- Chất liệu: ${b.materialText}` : ""}`,
      `- Hợp nếu bạn muốn ${inferStyleHint(b)}.`,
      ``,
      `Nếu bạn muốn, mình có thể gợi ý tiếp mẫu nào hợp hơn theo ngân sách hoặc kiểu charm bạn định phối.`,
    ]
      .filter(Boolean)
      .join("\n");
    return {
      answer,
      suggestions: [a.name, b.name].slice(0, 2),
      quickReplies: ["Mẫu nào dễ phối charm hơn?", "Mẫu nào hợp làm quà tặng?", "Lọc thêm mẫu tương tự"],
    };
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

  if (intent === INTENT.ORDER && context.order?.orderCode) {
    return {
      answer: `Đơn ${context.order.orderCode} hiện đang ở trạng thái ${context.order.status || "đang xử lý"}${context.order.paymentStatus ? `, thanh toán: ${context.order.paymentStatus}` : ""}. ${context.order.canCancel ? "Đơn này vẫn có thể hủy nếu bạn cần." : "Nếu bạn muốn mình có thể giải thích tiếp bước tiếp theo của đơn này."}`,
      suggestions: [context.order.status, context.order.paymentStatus].filter(Boolean),
      quickReplies: ["Đơn này có hủy được không?", "Giải thích trạng thái đơn", "Hướng dẫn thanh toán lại"],
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
  if (intent === INTENT.COMPARE && comparison.products.length) return comparison.products.slice(0, MAX_RECOMMENDATIONS);
  if (catalog.products.length) return catalog.products.slice(0, MAX_RECOMMENDATIONS);
  if (intent === INTENT.SEARCH || intent === INTENT.BESTSELLER) return [];
  if (context.product?.categoryId) {
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
    const intent = detectIntent({ message, context });
    const [catalog, comparison] = await Promise.all([
      [INTENT.BESTSELLER, INTENT.SEARCH, INTENT.ADVICE, INTENT.SIZE, INTENT.GENERAL].includes(intent)
        ? searchCatalogProducts({ message, context })
        : intent === INTENT.DESIGN
          ? searchCharmProducts({ message, context })
        : Promise.resolve({ request: parseProductRequest(message, context), products: [] }),
      intent === INTENT.COMPARE ? buildComparison({ message, context }) : Promise.resolve({ names: [], products: [] }),
    ]);
    const policyHints = buildPolicyHints(message);
    const recommendedProducts = await findRecommendations({ intent, message, context, catalog, comparison });

    let result;
    try {
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
    } catch {
      result = buildDeterministicAnswer({ intent, catalog, comparison, context, policyHints });
    }

    if (!result.quickReplies.length) {
      result.quickReplies =
        intent === INTENT.COMPARE
          ? ["Mẫu nào dễ phối charm hơn?", "Mẫu nào hợp làm quà tặng?", "Xem thêm mẫu tương tự"]
          : intent === INTENT.SEARCH
            ? ["Lọc dưới 2 triệu", "Gợi ý mẫu thanh lịch", "Gợi ý vòng charm"]
            : ["Tìm vòng tay bạc", "So sánh 2 mẫu", "Hướng dẫn chọn size"];
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
