const mongoose = require("mongoose");
const Product = require("../../models/product.model");
const Category = require("../../models/category.model");
const Collection = require("../../models/collection.model");
const { isGlobalChatScope, mergeCatalogProducts } = require("./context.service");
const { parseProductRequest } = require("./intent.service");
const {
  INTENT,
  TOOL,
  MAX_RECOMMENDATIONS,
  MAX_SEARCH_RESULTS,
  asArray,
  asText,
  escapeRegex,
  formatPrice,
  slugifyLite,
  uniqueBy,
} = require("./shared");

const inferStyleHint = (product) => {
  const hay = slugifyLite(`${product?.name || ""} ${product?.description || ""}`);
  if (/crown|royal|vương miện/.test(hay)) return "vẻ sang và cổ điển hơn";
  if (/tron mo|chu c|me|mat xich/.test(hay)) return "phong cách hiện đại và cá tính hơn";
  if (/charm|moments/.test(hay)) return "khả năng phối charm linh hoạt";
  return "kiểu dáng dễ đeo hằng ngày";
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

const isBraceletLike = (product, context) => {
  const hay = slugifyLite(
    `${product?.name || ""} ${product?.categoryName || ""} ${context?.listing?.categoryName || ""} ${context?.product?.categoryName || ""}`
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

const firstVariantOf = (product) => asArray(product?.variants)[0] || null;

const variantMatchesMaterialHint = (variant, hint) => {
  const normalizedHint = slugifyLite(hint);
  const materialText = slugifyLite(variant?.material || "");
  if (!normalizedHint) return true;
  if (!materialText) return false;
  if (normalizedHint === "ma vang") return /ma vang|gold plated/.test(materialText);
  if (normalizedHint === "bac") return /bac|silver|sterling/.test(materialText);
  if (normalizedHint === "vang")
    return /vang|gold/.test(materialText) && !/ma vang|gold plated/.test(materialText);
  return materialText.includes(normalizedHint);
};

const getVariantPrice = (variant) => {
  const price = Number(variant?.price);
  return Number.isFinite(price) && price > 0 ? price : 0;
};

const variantMatchesRequest = (variant, request) => {
  const hints = asArray(request?.materialHints).filter(Boolean);
  const price = getVariantPrice(variant);

  if (hints.length && !hints.every((hint) => variantMatchesMaterialHint(variant, hint))) {
    return false;
  }
  if (request?.priceMin > 0 && (!price || price < request.priceMin)) {
    return false;
  }
  if (request?.priceMax > 0 && (!price || price > request.priceMax)) {
    return false;
  }
  return true;
};

const getMatchedVariants = (product, request) => {
  const variants = asArray(product?.variants);
  if (!variants.length) return [];
  const hasVariantConstraints =
    asArray(request?.materialHints).length || request?.priceMin > 0 || request?.priceMax > 0;
  if (!hasVariantConstraints) return variants;
  return variants.filter((variant) => variantMatchesRequest(variant, request));
};

const toProductCard = (product, options = {}) => {
  const matchedVariants = asArray(options?.matchedVariants).length
    ? asArray(options.matchedVariants)
    : asArray(product?.__matchedVariants);
  const variantPool = matchedVariants.length ? matchedVariants : asArray(product?.variants);
  const variant = variantPool[0] || firstVariantOf(product);
  const totalSold = asArray(product?.variants).reduce(
    (sum, item) => sum + (Number(item?.sold) || 0),
    0
  );
  const variantPrices = variantPool.map((item) => getVariantPrice(item)).filter(Boolean);
  const materialText = uniqueBy(
    variantPool.map((item) => asText(item?.material, 80)).filter(Boolean),
    (item) => item
  ).join(", ");
  return {
    id: String(product?._id || ""),
    slug: asText(product?.slug, 120),
    name: asText(product?.name, 180),
    image: variant?.images?.[0] || "",
    priceText: variantPrices.length
      ? formatPrice(Math.min(...variantPrices), Math.max(...variantPrices))
      : formatPrice(product?.priceMin || variant?.price, product?.priceMax || variant?.price),
    materialText: materialText || asArray(product?.options?.materials).slice(0, 3).join(", "),
    categoryName: asText(product?.category?.name || "", 120),
    collections: asArray(product?.collections)
      .map((item) => asText(item?.name || item, 80))
      .filter(Boolean),
    description: asText(product?.description, 220),
    canEngrave: Boolean(product?.engraving?.enabled),
    totalSold,
    variantSummaries: asArray(product?.variants).map((item) => ({
      code: asText(item?.code, 60),
      material: asText(item?.material, 80),
      color: asText(item?.color, 40),
      size: asText(item?.size, 20),
      quantity: Math.max(0, Number(item?.quantity) || 0),
      sold: Math.max(0, Number(item?.sold) || 0),
      price: getVariantPrice(item),
      image: item?.images?.[0] || "",
    })),
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
    180
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
const MIN_COMPARE_MATCH_SCORE = 52;
const EXPLICIT_COMPARE_MIN_SCORE = 74;
const CONTRAST_TOKEN_GROUPS = [
  ["hong", "xanh", "do", "tim", "trang", "den", "vang", "cam", "xam", "nau", "be"],
  ["bac", "silver", "vang", "gold"],
];

const getCompareTokens = (name) => {
  const cleaned = cleanCompareName(stripCompareIntro(name));
  return uniqueBy(
    slugifyLite(cleaned)
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token.length >= 2 && !COMPARE_TOKEN_STOPWORDS.has(token)),
    (token) => token
  );
};

const getDistinctiveCompareTokens = (name) =>
  getCompareTokens(name)
    .filter((token) => !GENERIC_COMPARE_TOKENS.has(token))
    .sort((left, right) => right.length - left.length);

const getComparePhrases = (name) => {
  const tokens = getCompareTokens(name);
  const phrases = [];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    phrases.push(`${tokens[index]} ${tokens[index + 1]}`);
    if (index < tokens.length - 2)
      phrases.push(`${tokens[index]} ${tokens[index + 1]} ${tokens[index + 2]}`);
  }
  return uniqueBy(
    phrases
      .map((phrase) => phrase.trim())
      .filter((phrase) =>
        phrase.split(" ").some((part) => !GENERIC_COMPARE_TOKENS.has(part) && part.length >= 3)
      ),
    (phrase) => phrase
  ).sort((left, right) => right.length - left.length);
};

const getTailComparePhrases = (name) => {
  const tokens = getCompareTokens(name).filter(
    (token) => !COMPARE_TOKEN_STOPWORDS.has(token) && !GENERIC_COMPARE_TOKENS.has(token)
  );
  if (tokens.length < 2) return [];

  const phrases = [];
  if (tokens.length >= 3) phrases.push(tokens.slice(-3).join(" "));
  else phrases.push(tokens.slice(-2).join(" "));

  return uniqueBy(
    phrases.map((phrase) => phrase.trim()).filter((phrase) => phrase.length >= 7),
    (phrase) => phrase
  );
};

const countContrastMismatches = (queryName, productName) => {
  const queryTokens = new Set(getCompareTokens(queryName));
  const productTokens = new Set(getCompareTokens(productName));
  let mismatches = 0;

  for (const group of CONTRAST_TOKEN_GROUPS) {
    const queryGroupTokens = group.filter((token) => queryTokens.has(token));
    if (!queryGroupTokens.length) continue;

    const productGroupTokens = group.filter((token) => productTokens.has(token));
    if (!productGroupTokens.length) continue;

    const sameToken = productGroupTokens.some((token) => queryTokens.has(token));
    if (!sameToken) mismatches += 1;
  }

  return mismatches;
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

  const tailPhrases = getTailComparePhrases(queryName);
  const tailPhraseHits = tailPhrases.filter((phrase) => product.includes(phrase)).length;
  if (tailPhraseHits > 0) {
    score += tailPhraseHits * 16;
  } else if (tailPhrases.length) {
    score = Math.max(0, score - 18);
    score = Math.min(score, EXPLICIT_COMPARE_MIN_SCORE - 2);
  }

  const productTokens = getCompareTokens(productName).filter(
    (token) => !GENERIC_COMPARE_TOKENS.has(token) && token.length >= 4
  );
  const queryTokenSet = new Set(tokens);
  let alienPenalty = 0;
  for (const token of productTokens) {
    if (!queryTokenSet.has(token)) alienPenalty += token.length >= 5 ? 8 : 5;
  }
  score = Math.max(0, score - alienPenalty);
  const contrastMismatches = countContrastMismatches(queryName, productName);
  score = Math.max(0, score - contrastMismatches * 24);
  if (contrastMismatches > 0) {
    score = Math.min(score, MIN_COMPARE_MATCH_SCORE - 1);
  }
  if (phraseHits === 0 && getDistinctiveCompareTokens(queryName).length >= 2)
    score = Math.max(0, score - 20);
  return Math.min(100, score);
};

const hasStrongComparePhraseMatch = (queryName, productName) => {
  const phrases = getComparePhrases(queryName);
  const product = slugifyLite(productName);
  return phrases.slice(0, 3).some((phrase) => phrase.length >= 7 && product.includes(phrase));
};

const rankProductCandidates = (needle, products, minScore = MIN_COMPARE_MATCH_SCORE) =>
  uniqueBy(products || [], (item) => String(item?._id || item?.id || ""))
    .map((product) => ({ product, score: scoreProductNameMatch(needle, product?.name || "") }))
    .filter((entry) => entry.score >= minScore)
    .sort((left, right) => right.score - left.score);

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
    .select(
      "name slug description options variants priceMin priceMax category collections engraving"
    )
    .limit(260)
    .lean();
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
      $and: distinctive
        .slice(0, Math.min(3, distinctive.length))
        .map((token) => ({ name: { $regex: escapeRegex(token), $options: "i" } })),
    })
      .populate("category", "name slug")
      .populate("collections", "name slug")
      .select(
        "name slug description options variants priceMin priceMax category collections engraving"
      )
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
      .select(
        "name slug description options variants priceMin priceMax category collections engraving"
      )
      .limit(24)
      .lean();
    const primaryRanked = rankProductCandidates(cleaned, primaryDocs, EXPLICIT_COMPARE_MIN_SCORE);
    if (primaryRanked.length) return primaryRanked.map((entry) => entry.product);
  }

  const fetchTokens = uniqueBy(
    [...distinctive, ...tokens.filter((token) => token.length >= 4)].slice(0, 6),
    (token) => token
  );
  const docs = await Product.find({
    deleted: false,
    $or: fetchTokens.map((token) => ({ name: { $regex: escapeRegex(token), $options: "i" } })),
  })
    .populate("category", "name slug")
    .populate("collections", "name slug")
    .select(
      "name slug description options variants priceMin priceMax category collections engraving"
    )
    .limit(48)
    .lean();

  const ranked = rankProductCandidates(cleaned, docs, EXPLICIT_COMPARE_MIN_SCORE);
  return ranked.length ? ranked.map((entry) => entry.product) : [];
};

const buildVisibleProductMap = (context) =>
  asArray(context.listing?.visibleProducts).map((item) => ({
    id: item.id,
    slug: item.slug,
    name: item.name,
    scoreKey: slugifyLite(item.name),
  }));

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

const materialMatchesHint = (product, hint) => {
  const normalizedHint = slugifyLite(hint);
  if (!normalizedHint) return true;

  const materialTexts = [
    ...asArray(product?.options?.materials),
    ...asArray(product?.variants).map((variant) => variant?.material || ""),
  ]
    .map((item) => slugifyLite(item))
    .filter(Boolean);

  if (!materialTexts.length) return false;
  if (normalizedHint === "ma vang") {
    return materialTexts.some((item) => /ma vang|gold plated/.test(item));
  }
  if (normalizedHint === "bac") {
    return materialTexts.some((item) => /bac|silver|sterling/.test(item));
  }
  if (normalizedHint === "vang") {
    return materialTexts.some(
      (item) => /vang|gold/.test(item) && !/ma vang|gold plated/.test(item)
    );
  }
  return materialTexts.some((item) => item.includes(normalizedHint));
};

const productMatchesMaterialHints = (product, materialHints) => {
  const hints = asArray(materialHints).filter(Boolean);
  if (!hints.length) return true;
  return hints.every((hint) => materialMatchesHint(product, hint));
};

const buildVariantMaterialRegex = (material) => {
  const normalizedHint = slugifyLite(material);
  if (normalizedHint === "ma vang") return /mạ vàng|ma vang|gold plated/i;
  if (normalizedHint === "bac") return /bạc|bac|silver|sterling/i;
  if (normalizedHint === "vang") return /vàng|vang|gold/i;
  return new RegExp(escapeRegex(material), "i");
};

const loadCategoryTree = async () => {
  const categories = await Category.find({ deleted: false }).select("_id slug name parent").lean();

  const byId = new Map();
  const childrenByParent = new Map();
  for (const category of categories) {
    const id = String(category?._id || "");
    if (!id) continue;
    byId.set(id, category);
    const parentId = String(category?.parent || "").trim();
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId).push(category);
  }

  return { categories, byId, childrenByParent };
};

const collectDescendantCategoryIds = (rootIds, childrenByParent) => {
  const visited = new Set();
  const queue = [...rootIds.map((id) => String(id || "")).filter(Boolean)];

  while (queue.length) {
    const currentId = queue.shift();
    if (!currentId || visited.has(currentId)) continue;
    visited.add(currentId);
    const children = childrenByParent.get(currentId) || [];
    for (const child of children) {
      const childId = String(child?._id || "");
      if (childId && !visited.has(childId)) queue.push(childId);
    }
  }

  return Array.from(visited);
};

const findCategoryIds = async (request) => {
  const { categories, childrenByParent } = await loadCategoryTree();
  const requestedRootSlugs = uniqueBy(
    [
      ...asArray(request.categoryRootSlugs),
      ...(request.categoryRootSlugs?.length
        ? []
        : request.listingCategorySlug
          ? [request.listingCategorySlug]
          : []),
    ].filter(Boolean),
    (item) => item
  );

  const rootIds = new Set();
  for (const category of categories) {
    const categoryId = String(category?._id || "");
    const categorySlug = String(category?.slug || "")
      .trim()
      .toLowerCase();
    const categoryName = slugifyLite(category?.name || "");

    if (
      requestedRootSlugs.some((slug) => {
        const safeSlug = String(slug || "")
          .trim()
          .toLowerCase();
        return safeSlug && (categorySlug === safeSlug || categorySlug.startsWith(`${safeSlug}-`));
      })
    ) {
      rootIds.add(categoryId);
      continue;
    }

    if (
      !request.categoryRootSlugs?.length &&
      request.listingCategoryName &&
      categoryName &&
      categoryName === slugifyLite(request.listingCategoryName)
    ) {
      rootIds.add(categoryId);
    }
  }

  if (!rootIds.size) return [];
  return collectDescendantCategoryIds(Array.from(rootIds), childrenByParent);
};

const buildProductQuery = async (request, context) => {
  const and = [{ deleted: false }];
  const categoryIds = await findCategoryIds(request);
  if (categoryIds.length) {
    const categoryOr = categoryIds.map((id) =>
      mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id
    );
    and.push({ category: { $in: categoryOr } });
  }

  const orTerms = [];
  const rawTerms = request.searchTerms.length
    ? request.searchTerms
    : [context.listing?.query, context.product?.name].filter(Boolean);
  for (const term of rawTerms) {
    const safe = asText(term, 120);
    if (!safe) continue;
    const isLongPhrase = safe.split(" ").length >= 4;
    if (safe.length >= 2 && !isLongPhrase) {
      orTerms.push({ name: { $regex: escapeRegex(safe), $options: "i" } });
      orTerms.push({ description: { $regex: escapeRegex(safe), $options: "i" } });
    }
  }

  if (orTerms.length) and.push({ $or: orTerms });

  const variantRange = {};
  if (request.priceMin > 0) variantRange.$gte = request.priceMin;
  if (request.priceMax > 0) variantRange.$lte = request.priceMax;

  if (request.materialHints.length) {
    const variantOr = request.materialHints.map((material) => {
      const elemMatch = {
        material: { $regex: buildVariantMaterialRegex(material) },
      };
      if (Object.keys(variantRange).length) {
        elemMatch.price = variantRange;
      }
      return { variants: { $elemMatch: elemMatch } };
    });
    and.push({ $or: variantOr });
  } else if (Object.keys(variantRange).length) {
    and.push({ variants: { $elemMatch: { price: variantRange } } });
  }

  return and.length === 1 ? and[0] : { $and: and };
};

const rankProducts = (products, request, context) => {
  const visibleNames = buildVisibleProductMap(context);
  const terms = request.searchTerms.length
    ? request.searchTerms
    : [context.product?.name, context.listing?.query].filter(Boolean);
  return uniqueBy(
    (products || [])
      .map((product) => {
        const matchedVariants = getMatchedVariants(product, request);
        const hasVariantConstraints =
          asArray(request.materialHints).length || request.priceMin > 0 || request.priceMax > 0;
        if (hasVariantConstraints && !matchedVariants.length) {
          return { product, score: -9999 };
        }
        if (
          !matchedVariants.length &&
          !productMatchesMaterialHints(product, request.materialHints)
        ) {
          return { product, score: -9999 };
        }
        let score = 0;
        const name = product?.name || "";
        const categoryName = product?.category?.name || "";
        for (const term of terms) score += scoreNameSimilarity(term, name);
        for (const hint of request.materialHints) {
          const hay = `${asArray(product?.options?.materials).join(" ")} ${asArray(
            product?.variants
          )
            .map((v) => v?.material || "")
            .join(" ")}`;
          if (slugifyLite(hay).includes(slugifyLite(hint))) score += 20;
        }
        for (const hint of request.categoryHints) {
          if (
            slugifyLite(categoryName).includes(slugifyLite(hint)) ||
            slugifyLite(name).includes(slugifyLite(hint))
          )
            score += 20;
        }
        if (visibleNames.some((item) => item.id && String(item.id) === String(product?._id)))
          score += 10;
        if (matchedVariants.length) score += Math.min(matchedVariants.length * 3, 9);
        score += Math.min(
          Number(product?.createdAt ? new Date(product.createdAt).getTime() / 1000000000 : 0),
          10
        );
        return { product: { ...product, __matchedVariants: matchedVariants }, score };
      })
      .filter((entry) => entry.score > -9999)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.product),
    (item) => String(item?._id || "")
  );
};

const searchCatalogProducts = async ({ message, context }) => {
  const request = context.__searchRequest || parseProductRequest(message, context);
  const query = await buildProductQuery(request, context);
  const rows = await Product.find(query)
    .populate("category", "name slug")
    .populate("collections", "name slug")
    .select(
      "name slug description options variants priceMin priceMax category collections engraving createdAt"
    )
    .sort({ createdAt: -1 })
    .limit(24)
    .lean();

  const ranked = rankProducts(rows, request, context).slice(0, MAX_SEARCH_RESULTS);
  const finalProducts = request.bestSeller
    ? [...ranked].sort(
        (a, b) =>
          asArray(b?.__matchedVariants || b?.variants).reduce(
            (sum, item) => sum + (Number(item?.sold) || 0),
            0
          ) -
          asArray(a?.__matchedVariants || a?.variants).reduce(
            (sum, item) => sum + (Number(item?.sold) || 0),
            0
          )
      )
    : ranked;
  return {
    request,
    products: finalProducts.map((product) =>
      toProductCard(product, { matchedVariants: product?.__matchedVariants })
    ),
  };
};

const findProductByName = async (name, context = {}) => {
  const cleaned = cleanCompareName(stripCompareIntro(name));
  if (!cleaned) return null;

  const visible = buildVisibleProductMap(context);
  const visibleBest = visible
    .map((item) => ({ ...item, score: scoreProductNameMatch(cleaned, item.name) }))
    .sort((a, b) => b.score - a.score)[0];

  const docs = await Product.find({
    deleted: false,
    $or: [
      { name: { $regex: escapeRegex(cleaned), $options: "i" } },
      { slug: { $regex: escapeRegex(slugifyLite(cleaned).replace(/\s+/g, "-")), $options: "i" } },
    ],
  })
    .populate("category", "name slug")
    .populate("collections", "name slug")
    .select(
      "name slug description options variants priceMin priceMax category collections engraving"
    )
    .limit(8)
    .lean();

  const best = rankProductCandidates(cleaned, docs)[0];
  if (best?.score >= MIN_COMPARE_MATCH_SCORE) return toProductCard(best.product);
  if (visibleBest?.score >= MIN_COMPARE_MATCH_SCORE && visibleBest?.slug) {
    const fallback = await Product.findOne({ deleted: false, slug: visibleBest.slug })
      .populate("category", "name slug")
      .populate("collections", "name slug")
      .select(
        "name slug description options variants priceMin priceMax category collections engraving"
      )
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
    .select(
      "name slug description options variants priceMin priceMax category collections engraving"
    )
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
      .filter(
        (token) =>
          token.length >= 4 &&
          !["charm", "mix", "voi", "nao", "ban", "chay", "size", "cm", "nen", "giup"].includes(
            token
          )
      ),
    (item) => item
  ).slice(0, 8);
  if (!tokens.length) return null;

  const regex = new RegExp(tokens.map(escapeRegex).join("|"), "i");
  const rows = await Product.find({
    deleted: false,
    $or: [{ name: regex }, { description: regex }],
  })
    .populate("category", "name slug")
    .populate("collections", "name slug")
    .select(
      "name slug description options variants priceMin priceMax category collections engraving"
    )
    .limit(12)
    .lean();

  const best = rows
    .map((product) => ({ product, score: scoreNameSimilarity(message, product?.name || "") }))
    .sort((a, b) => b.score - a.score)[0];
  return best?.score >= 20 ? toProductCard(best.product) : null;
};

const resolveConversationProduct = async ({ message, history, context }) => {
  if (!isGlobalChatScope(context) && context?.product?.name) {
    if (context.product.slug) {
      const hydrated = await fetchProductBySlug(context.product.slug);
      if (hydrated) return hydrated;
    }
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

const resolveVariantStock = ({ product, inquiry }) => {
  const variantSummaries = asArray(product?.variantSummaries);
  if (!product?.name || !variantSummaries.length) return null;

  const requestedSize = asText(inquiry?.requestedSize, 20);
  const requestedMaterials = asArray(inquiry?.materialHints).filter(Boolean);
  const matchedVariants = variantSummaries.filter((variant) => {
    if (requestedSize && slugifyLite(variant?.size || "") !== slugifyLite(requestedSize)) {
      return false;
    }
    if (requestedMaterials.length) {
      return requestedMaterials.every((hint) => variantMatchesMaterialHint(variant, hint));
    }
    return true;
  });

  return {
    requestedSize,
    requestedMaterials,
    variants: matchedVariants,
    allVariants: variantSummaries,
  };
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
    )
      return exact;
  }

  const candidates = await fetchCompareCandidates(cleaned);
  const exclude = new Set(excludeIds.map((id) => String(id)));
  const ranked = candidates
    .filter((product) => !exclude.has(String(product?._id || product?.id || "")))
    .map((product) => ({ product, score: scoreProductNameMatch(cleaned, product?.name || "") }))
    .filter(
      (entry) =>
        entry.score >= EXPLICIT_COMPARE_MIN_SCORE &&
        (hasStrongComparePhraseMatch(cleaned, entry.product?.name || "") || entry.score >= 88)
    )
    .sort((left, right) => right.score - left.score);

  return ranked[0] ? toProductCard(ranked[0].product) : null;
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

const buildComparison = async ({ message, context, catalog }) => {
  const names = parseCompareNames(message);
  if (names.length >= 2) {
    const products = [];
    const usedIds = [];
    for (const name of names.slice(0, 2)) {
      const product = await findProductForCompareName(name, usedIds);
      if (!product?.id) continue;
      if (scoreProductNameMatch(name, product.name) < EXPLICIT_COMPARE_MIN_SCORE) continue;
      usedIds.push(product.id);
      products.push(product);
    }
    return { names, products: uniqueBy(products, (item) => item.id) };
  }

  const pool = uniqueBy(asArray(catalog?.products), (item) => item.id || item.slug || item.name);
  if (pool.length >= 2) return { names: [], products: pool.slice(0, 2) };
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
  if (charmCategoryIds.length) and.push({ category: { $in: charmCategoryIds } });

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
    or.push({
      "options.materials": { $elemMatch: { $regex: escapeRegex(material), $options: "i" } },
    });
    or.push({ "variants.material": { $regex: escapeRegex(material), $options: "i" } });
  }

  const query = or.length
    ? { $and: [...and, { $or: or }] }
    : and.length === 1
      ? and[0]
      : { $and: and };
  const rows = await Product.find(query)
    .populate("category", "name slug")
    .populate("collections", "name slug")
    .select(
      "name slug description options variants priceMin priceMax category collections engraving createdAt"
    )
    .sort({ createdAt: -1 })
    .limit(18)
    .lean();

  const mapped = rows.map(toProductCard);
  if (mapped.length) {
    return {
      request: { categoryHints: ["charm"], materialHints },
      products: mapped.slice(0, MAX_SEARCH_RESULTS),
    };
  }

  const fallbackRows = await Product.find(
    charmCategoryIds.length
      ? { deleted: false, category: { $in: charmCategoryIds } }
      : { deleted: false, name: /charm/i }
  )
    .populate("category", "name slug")
    .populate("collections", "name slug")
    .select(
      "name slug description options variants priceMin priceMax category collections engraving createdAt"
    )
    .sort({ createdAt: -1 })
    .limit(MAX_SEARCH_RESULTS)
    .lean();

  return {
    request: { categoryHints: ["charm"], materialHints },
    products: fallbackRows.map(toProductCard),
  };
};

const getCollectionSuggestions = async (context) => {
  const slug = context.listing?.collectionSlug;
  if (!slug) return [];
  const collection = await Collection.findOne({ slug, deleted: false }).select("_id").lean();
  if (!collection?._id) return [];
  const rows = await Product.find({ deleted: false, collections: collection._id })
    .populate("category", "name slug")
    .populate("collections", "name slug")
    .select(
      "name slug description options variants priceMin priceMax category collections engraving"
    )
    .limit(MAX_RECOMMENDATIONS)
    .lean();
  return rows.map(toProductCard);
};

const findRecommendations = async ({ intent, message, context, catalog, comparison }) => {
  if (intent === INTENT.COMPARE && comparison.products.length)
    return comparison.products.slice(0, 2);
  if (catalog.products.length) return catalog.products.slice(0, MAX_RECOMMENDATIONS);
  if (intent === INTENT.SEARCH || intent === INTENT.BESTSELLER) return [];
  if (!isGlobalChatScope(context) && context.product?.categoryId) {
    const rows = await Product.find({
      deleted: false,
      category: context.product.categoryId,
      _id: { $ne: context.product.id || undefined },
    })
      .populate("category", "name slug")
      .populate("collections", "name slug")
      .select(
        "name slug description options variants priceMin priceMax category collections engraving"
      )
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
    .select(
      "name slug description options variants priceMin priceMax category collections engraving"
    )
    .sort({ createdAt: -1 })
    .limit(MAX_RECOMMENDATIONS)
    .lean();
  return rows.map(toProductCard);
};

const resolveCatalogForIntent = async ({ intent, message, context }) => {
  if (
    [
      INTENT.BESTSELLER,
      INTENT.SEARCH,
      INTENT.ADVICE,
      INTENT.SIZE,
      INTENT.GENERAL,
      INTENT.COMPARE,
    ].includes(intent)
  ) {
    const catalog = await searchCatalogProducts({ message, context });
    return { tool: TOOL.CATALOG_SEARCH, catalog: mergeCatalogProducts(catalog) };
  }
  if (intent === INTENT.DESIGN) {
    const catalog = await searchCharmProducts({ message, context });
    return { tool: TOOL.CHARM_SEARCH, catalog: mergeCatalogProducts(catalog) };
  }
  return {
    tool: TOOL.CATALOG_SEARCH,
    catalog: mergeCatalogProducts({ request: parseProductRequest(message, context), products: [] }),
  };
};

const resolveComparisonReadiness = ({ comparison, context }) => {
  if (comparison.products.length < 2) return false;
  const requestedNames = asArray(comparison.names).filter(Boolean);
  const pairsValid =
    requestedNames.length < 2 ||
    requestedNames.every((name) => {
      const best = comparison.products
        .map((product) => ({ product, score: scoreProductNameMatch(name, product.name) }))
        .sort((left, right) => right.score - left.score)[0];
      return (
        best &&
        best.score >= EXPLICIT_COMPARE_MIN_SCORE &&
        (hasStrongComparePhraseMatch(name, best.product.name) || best.score >= 88)
      );
    });
  if (pairsValid) {
    context.__comparisonReady = true;
    return true;
  }
  return false;
};

module.exports = {
  inferStyleHint,
  inferCompareStyleHint,
  isBraceletLike,
  chooseBestSizeProduct,
  toProductCard,
  scoreProductNameMatch,
  parseCompareNames,
  searchCatalogProducts,
  resolveConversationProduct,
  resolveVariantStock,
  buildComparison,
  searchCharmProducts,
  findRecommendations,
  resolveCatalogForIntent,
  resolveComparisonReadiness,
};
