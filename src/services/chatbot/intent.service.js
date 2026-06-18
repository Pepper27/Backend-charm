const { INTENT, asArray, asText, extractOrderCode, extractPriceNumber, slugifyLite, uniqueBy } =
  (() => {
    const shared = require("./shared");
    return {
      INTENT: shared.INTENT,
      asArray: shared.asArray,
      asText: shared.asText,
      extractOrderCode: shared.extractOrderCode,
      extractPriceNumber: shared.extractPriceNumber,
      slugifyLite: shared.slugifyLite,
      uniqueBy: shared.uniqueBy,
    };
  })();

const containsNormalizedTerm = (text, term) => {
  const hay = ` ${slugifyLite(text)} `;
  const needle = ` ${slugifyLite(term)} `;
  return hay.includes(needle);
};

const CATEGORY_SYNONYMS = [
  {
    key: "vong-kieng",
    keywords: ["vòng kiềng", "vong kieng", "kiềng", "kieng", "bangle"],
    rootSlugs: ["vong-tay"],
  },
  {
    key: "vong-da",
    keywords: ["vòng da", "vong da", "leather bracelet"],
    rootSlugs: ["vong-tay"],
  },
  {
    key: "vong-tay-mem",
    keywords: ["vòng tay mềm", "vong tay mem", "vòng mềm", "vong mem"],
    rootSlugs: ["vong-tay"],
  },
  {
    key: "vong-tay",
    keywords: ["vòng tay", "vong tay", "lắc tay", "lac tay", "bracelet"],
    rootSlugs: ["vong-tay"],
  },
  { key: "nhan", keywords: ["nhẫn", "nhan", "ring"], rootSlugs: ["nhan"] },
  {
    key: "mat-day-chuyen",
    keywords: ["mặt dây chuyền", "mat day chuyen", "mặt dây", "mat day", "pendant"],
    rootSlugs: ["day-chuyen"],
  },
  {
    key: "day-chuyen",
    keywords: ["dây chuyền", "day chuyen", "vòng cổ", "vong co", "necklace"],
    rootSlugs: ["day-chuyen"],
  },
  {
    key: "hoa-tai",
    keywords: ["hoa tai", "bông tai", "bong tai", "khuyên tai", "earring"],
    rootSlugs: ["hoa-tai"],
  },
  {
    key: "charm-treo",
    keywords: ["charm treo", "pendant charm", "treo charm"],
    rootSlugs: ["charm"],
  },
  {
    key: "charm-xo",
    keywords: ["charm xỏ", "charm xo", "hat charm", "hạt charm", "bead charm"],
    rootSlugs: ["charm"],
  },
  {
    key: "charm-chan",
    keywords: ["charm chặn", "charm chan", "clip charm", "stopper charm"],
    rootSlugs: ["charm"],
  },
  {
    key: "charm-dinh-da",
    keywords: ["charm đính đá", "charm dinh da", "stone charm"],
    rootSlugs: ["charm"],
  },
  {
    key: "charm-thuy-tinh",
    keywords: ["charm thủy tinh", "charm thuy tinh", "murano", "glass charm"],
    rootSlugs: ["charm"],
  },
  { key: "charm", keywords: ["charm"], rootSlugs: ["charm"] },
];

const MATERIAL_SYNONYMS = [
  { key: "bạc", keywords: ["bạc", "bac", "silver", "sterling"] },
  {
    key: "mạ vàng",
    keywords: ["mạ vàng", "ma vang", "gold plated", "vàng hồng", "vang hong", "rose gold"],
  },
  { key: "vàng", keywords: ["vàng", "vang", "gold"] },
  { key: "da", keywords: ["dây da", "day da", "leather"] },
];

const normalizeMaterialHints = (materialHints) => {
  const hints = uniqueBy(asArray(materialHints).filter(Boolean), (item) => item);
  if (hints.includes("mạ vàng")) {
    return hints.filter((item) => item !== "vàng");
  }
  return hints;
};

const PRICE_PATTERNS = [
  { regex: /dưới\s*(\d+[\d.,]*)\s*(triệu|tr|k|nghìn|ngan)?/i, type: "max" },
  {
    regex:
      /từ\s*(\d+[\d.,]*)\s*(triệu|tr|k|nghìn|ngan)?\s*(?:đến|-|toi)?\s*(\d+[\d.,]*)?\s*(triệu|tr|k|nghìn|ngan)?/i,
    type: "range",
  },
  {
    regex:
      /(?:vậy|vay|tầm|tam|khoảng|khoang|tới|toi|lên|len)?\s*(\d+[\d.,]*)\s*(triệu|tr|k|nghìn|ngan|m)\b/i,
    type: "max",
  },
];

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
    (item) => item
  );

const buildSearchTerms = (raw) => {
  const directTerms = String(raw || "")
    .split(/,|;|\.|\?|!|\n|\s+and\s+|\s+và\s+/i)
    .map((item) => asText(item, 120))
    .filter(Boolean);
  const tokenTerms = extractSearchTokens(raw);
  return uniqueBy([...directTerms, ...tokenTerms], (item) => slugifyLite(item));
};

const extractRequestedSize = (message) => {
  const raw = String(message || "");
  const match = raw.match(/(?:size|cỡ|co|số)\s*([a-z0-9.-]{1,12})/i);
  if (!match) return "";
  return String(match[1] || "").trim();
};

const parseVariantInquiry = (message) => {
  const requestedSize = extractRequestedSize(message);
  const materialHints = normalizeMaterialHints(
    MATERIAL_SYNONYMS.filter((item) =>
      item.keywords.some((word) => containsNormalizedTerm(message, word))
    ).map((item) => item.key)
  );
  const text = slugifyLite(message);
  return {
    requestedSize,
    materialHints,
    asksAvailability: /con|còn|het|hết|ton kho|tồn kho|size nao con|co san|sẵn/.test(text),
    asksPrice: /gia|giá|bao nhieu|bao nhiêu/.test(text),
  };
};

const hasSearchState = (request) =>
  Boolean(
    request &&
    (asArray(request.categoryRootSlugs).length ||
      asArray(request.categorySlugs).length ||
      asArray(request.materialHints).length ||
      Number(request.priceMin) > 0 ||
      Number(request.priceMax) > 0 ||
      asArray(request.searchTerms).length)
  );

const isLikelySearchFollowUp = (message, request) => {
  const text = slugifyLite(message);
  if (!text) return false;
  const hasFacetUpdate =
    asArray(request?.categoryRootSlugs).length ||
    asArray(request?.categorySlugs).length ||
    asArray(request?.materialHints).length ||
    Number(request?.priceMin) > 0 ||
    Number(request?.priceMax) > 0;
  if (!hasFacetUpdate) return false;

  return (
    text.length <= 80 &&
    (/^vay\b|^the\b|^con\b|^loai\b|^mau\b|^duoi\b|^tren\b|^tam\b|^khoang\b/.test(text) ||
      /^\d+[\d.,]*\s*(trieu|tr|k|nghin|ngan|m)\b/.test(text) ||
      /^vay\s*\d+[\d.,]*/.test(text))
  );
};

const mergeSearchRequests = (previousRequest, currentRequest, options = {}) => {
  const previous = previousRequest || {};
  const current = currentRequest || {};
  const usePreviousSearchTerms = Boolean(options.usePreviousSearchTerms);

  return {
    ...previous,
    ...current,
    categoryHints: asArray(current.categoryHints).length
      ? current.categoryHints
      : asArray(previous.categoryHints),
    categoryRootSlugs: asArray(current.categoryRootSlugs).length
      ? current.categoryRootSlugs
      : asArray(previous.categoryRootSlugs),
    categorySlugs: asArray(current.categorySlugs).length
      ? current.categorySlugs
      : asArray(previous.categorySlugs),
    materialHints: asArray(current.materialHints).length
      ? current.materialHints
      : asArray(previous.materialHints),
    priceMin: Number(current.priceMin) > 0 ? current.priceMin : Number(previous.priceMin) || 0,
    priceMax: Number(current.priceMax) > 0 ? current.priceMax : Number(previous.priceMax) || 0,
    searchTerms: usePreviousSearchTerms
      ? asArray(previous.searchTerms)
      : uniqueBy([...asArray(current.searchTerms), ...asArray(previous.searchTerms)], (item) =>
          slugifyLite(item)
        ),
    listingCategoryName: current.listingCategoryName || previous.listingCategoryName || "",
    listingCategorySlug: current.listingCategorySlug || previous.listingCategorySlug || "",
  };
};

const detectIntent = ({ message, context, isGlobalChatScope }) => {
  const text = slugifyLite(message);
  const globalScope = isGlobalChatScope(context);
  const variantInquiry = parseVariantInquiry(message);
  const hasBestSellerKeyword =
    /ban chay|bestseller|best seller|pho bien|noi bat nhat|hot nhat/.test(text);
  const hasPriceKeyword =
    /duoi \d|tren \d|tu \d|tam gia|ngan sach|gia bao nhieu|bao nhieu tien|re hon|\d+\s*(trieu|tr|k|nghin|ngan|m)\b/.test(
      text
    );
  const hasDesignKeyword =
    /mix charm|phoi charm|phoi voi charm|mix voi charm|slot|clip zone|thiet ke|goi y charm/.test(
      text
    );
  const hasSearchKeyword =
    /mua|tim|goi y|tu van|co mau nao|xem them|vong|vong tay|lac tay|nhan|day chuyen|hoa tai|bong tai|mau charm|charm nao/.test(
      text
    );
  const hasOrderKeyword =
    /don hang|order|ma don|trang thai don|huy don|tra cuu don/.test(text) ||
    Boolean(extractOrderCode(message));
  const hasResolvedProduct = Boolean(context.__resolvedProduct?.name || context.product?.name);

  if (hasBestSellerKeyword) return INTENT.BESTSELLER;
  if (/so sanh|khac nhau|chon mau nao|mau nao hop/.test(text)) return INTENT.COMPARE;
  if (hasOrderKeyword || (!globalScope && context.order?.orderCode)) return INTENT.ORDER;
  if (/zalopay|thanh toan|chuyen khoan|cod|tra gop|huong dan thanh toan/.test(text))
    return INTENT.PAYMENT;
  if (hasResolvedProduct && (variantInquiry.requestedSize || variantInquiry.asksAvailability)) {
    return INTENT.STOCK;
  }
  if (/size|kich co|do tay|do ngon|chu vi/.test(text)) return INTENT.SIZE;
  if (
    hasDesignKeyword ||
    (!globalScope && context.design && !hasPriceKeyword && !hasSearchKeyword && !hasOrderKeyword)
  ) {
    return INTENT.DESIGN;
  }
  if (/bao hanh|chinh sach|doi tra|van chuyen|giao hang|khac chu|khac ten/.test(text))
    return INTENT.POLICY;
  if (
    hasResolvedProduct &&
    /gia|giá|chat lieu|chất liệu|chi tiet|chi tiết|mo ta|mô tả|co gi dac biet/.test(text)
  ) {
    return INTENT.DETAIL;
  }
  if (hasSearchKeyword || hasPriceKeyword || /charm/.test(text)) return INTENT.SEARCH;
  if (!globalScope && context.product) return INTENT.ADVICE;
  return INTENT.GENERAL;
};

const parseProductRequest = (message, context) => {
  const raw = String(message || "");
  const text = slugifyLite(raw);
  const matchedCategories = CATEGORY_SYNONYMS.filter((item) =>
    item.keywords.some((word) => containsNormalizedTerm(text, word))
  );
  const categoryHints = uniqueBy(
    matchedCategories.map((item) => item.key),
    (item) => item
  );
  const categorySlugs = uniqueBy(
    matchedCategories.map((item) => item.key),
    (item) => item
  );
  const materialHints = normalizeMaterialHints(
    MATERIAL_SYNONYMS.filter((item) =>
      item.keywords.some((word) => containsNormalizedTerm(text, word))
    ).map((item) => item.key)
  );

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

  return {
    categoryHints,
    categorySlugs,
    categoryRootSlugs: uniqueBy(
      matchedCategories.flatMap((item) => item.rootSlugs || []),
      (item) => item
    ),
    materialHints,
    bestSeller: /ban chay|bestseller|best seller|pho bien|noi bat nhat|hot nhat/i.test(raw),
    priceMin,
    priceMax,
    searchTerms: buildSearchTerms(raw),
    listingCategoryName: context.listing?.categoryName || "",
    listingCategorySlug: context.listing?.categorySlug || "",
  };
};

const buildPolicyHints = (message) => {
  const text = slugifyLite(message);
  const answers = [];
  if (/bao hanh/.test(text))
    answers.push(
      "Kim Bảo có chính sách bảo hành riêng theo từng dòng sản phẩm. Nếu bạn đang xem sản phẩm cụ thể, mình có thể giải thích kỹ hơn theo mẫu đó."
    );
  if (/doi tra/.test(text))
    answers.push(
      "Với đổi trả, bạn nên kiểm tra tình trạng sản phẩm, hóa đơn và thời gian áp dụng theo chính sách của shop trước khi xác nhận."
    );
  if (/giao hang|van chuyen/.test(text))
    answers.push(
      "Shop có hỗ trợ giao hàng; khi chốt đơn bạn nên kiểm tra kỹ địa chỉ, số điện thoại và phương thức thanh toán phù hợp."
    );
  if (/khac chu|khac ten/.test(text))
    answers.push(
      "Các mẫu có hỗ trợ khắc sẽ cần xác nhận nội dung, kiểu chữ và preview trước khi thêm vào giỏ."
    );
  return answers;
};

module.exports = {
  detectIntent,
  parseProductRequest,
  parseVariantInquiry,
  hasSearchState,
  isLikelySearchFollowUp,
  mergeSearchRequests,
  buildPolicyHints,
};
