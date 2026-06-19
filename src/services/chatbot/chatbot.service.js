const { normalizeContext } = require("./context.service");
const { lookupOrderForChat } = require("./order.service");
const Product = require("../../models/product.model");
const Category = require("../../models/category.model");
const Collection = require("../../models/collection.model");
const Wishlist = require("../../models/wishlist.model");
const {
  findProductByName,
  resolveConversationProduct,
  resolveVariantStock,
  searchCatalogProducts,
} = require("./product.service");
const { runFunctionCallingChat } = require("./llm.service");
const {
  clampHistory,
  createHttpError,
  DEFAULT_MODEL,
  MAX_MESSAGE_LENGTH,
  asArray,
  asText,
  normalizeModelName,
  slugifyLite,
} = require("./shared");

const DEFAULT_QUICK_REPLIES = ["Tìm vòng tay bạc", "Tra cứu đơn hàng", "Hướng dẫn thanh toán"];

const NO_DATA_ANSWER =
  "Hiện hệ thống chưa có thông tin phù hợp để trả lời câu hỏi này. Bạn có thể hỏi các vấn đề khác giúp mình nhé.";

const buildProductSummary = (product) => {
  if (!product?.name) return null;
  const firstVariantImage =
    asArray(product.variantSummaries)
      .map((variant) => asText(variant?.image, 500))
      .find(Boolean) || asText(product.image, 500);
  return {
    id: product.id || "",
    slug: product.slug || "",
    name: product.name,
    image: firstVariantImage || "",
    priceText: product.priceText || "",
    materialText: product.materialText || "",
    categoryName: product.categoryName || "",
    description: product.description || "",
    canEngrave: Boolean(product.canEngrave),
    totalSold: Math.max(0, Number(product.totalSold) || 0),
    matchedSold: Math.max(0, Number(product.matchedSold) || 0),
    variantSummaries: asArray(product.variantSummaries)
      .slice(0, 10)
      .map((variant) => ({
        code: asText(variant?.code, 60),
        material: asText(variant?.material, 80),
        color: asText(variant?.color, 40),
        size: asText(variant?.size, 20),
        quantity: Math.max(0, Number(variant?.quantity) || 0),
        sold: Math.max(0, Number(variant?.sold) || 0),
        price: Math.max(0, Number(variant?.price) || 0),
        image: asText(variant?.image, 500),
      })),
  };
};

const formatPriceTextFromVariants = (variants, priceMin, priceMax) => {
  const prices = asArray(variants)
    .map((item) => Math.max(0, Number(item?.price) || 0))
    .filter(Boolean);
  const low = prices.length ? Math.min(...prices) : Math.max(0, Number(priceMin) || 0);
  const high = prices.length ? Math.max(...prices) : Math.max(0, Number(priceMax) || low);
  if (!low && !high) return "";
  if (low && high && low !== high)
    return `${low.toLocaleString("vi-VN")}đ - ${high.toLocaleString("vi-VN")}đ`;
  const value = low || high;
  return value ? `${value.toLocaleString("vi-VN")}đ` : "";
};

const buildProductSummaryFromDoc = (product) => {
  if (!product?._id || !product?.name) return null;
  const variants = asArray(product?.variants);
  const materials = [
    ...new Set(variants.map((item) => asText(item?.material, 80)).filter(Boolean)),
  ];
  const totalSold = variants.reduce((sum, item) => sum + (Number(item?.sold) || 0), 0);
  return {
    id: String(product._id || ""),
    slug: asText(product?.slug, 120),
    name: asText(product?.name, 180),
    image: asText(variants[0]?.images?.[0], 500),
    priceText: formatPriceTextFromVariants(variants, product?.priceMin, product?.priceMax),
    materialText: materials.join(", "),
    categoryName: asText(product?.category?.name || "", 120),
    description: asText(product?.description, 220),
    canEngrave: Boolean(product?.engraving?.enabled),
    totalSold,
    matchedSold: totalSold,
    variantSummaries: variants.slice(0, 10).map((variant) => ({
      code: asText(variant?.code, 60),
      material: asText(variant?.material, 80),
      color: asText(variant?.color, 40),
      size: asText(variant?.size, 20),
      quantity: Math.max(0, Number(variant?.quantity) || 0),
      sold: Math.max(0, Number(variant?.sold) || 0),
      price: Math.max(0, Number(variant?.price) || 0),
      image: asText(variant?.images?.[0], 500),
    })),
  };
};

const HTML_ENTITY_MAP = {
  nbsp: " ",
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  agrave: "à",
  aacute: "á",
  acirc: "â",
  atilde: "ã",
  egrave: "è",
  eacute: "é",
  ecirc: "ê",
  igrave: "ì",
  iacute: "í",
  ograve: "ò",
  oacute: "ó",
  ocirc: "ô",
  otilde: "õ",
  ugrave: "ù",
  uacute: "ú",
  yacute: "ý",
  auml: "ä",
  ouml: "ö",
  uuml: "ü",
  Agrave: "À",
  Aacute: "Á",
  Acirc: "Â",
  Egrave: "È",
  Eacute: "É",
  Ecirc: "Ê",
  Ograve: "Ò",
  Oacute: "Ó",
  Ocirc: "Ô",
  Ugrave: "Ù",
  Uacute: "Ú",
  Yacute: "Ý",
};

const decodeHtmlEntities = (value) =>
  String(value || "")
    .replace(/&(#\d+|#x[\da-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
      if (entity[0] === "#") {
        const codePoint =
          entity[1].toLowerCase() === "x"
            ? Number.parseInt(entity.slice(2), 16)
            : Number.parseInt(entity.slice(1), 10);
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
      }
      return Object.prototype.hasOwnProperty.call(HTML_ENTITY_MAP, entity)
        ? HTML_ENTITY_MAP[entity]
        : match;
    })
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const summarizeDescription = (value) => {
  const cleaned = decodeHtmlEntities(value);
  if (!cleaned) return "Chưa có mô tả";

  const sentences = cleaned
    .split(/[.!?]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (sentences[0] && sentences[0].length <= 110) return sentences[0];

  const phrases = cleaned
    .split(/[,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  const compact = phrases.slice(0, 2).join(", ");
  if (compact && compact.length <= 110) return compact;

  const words = cleaned.split(/\s+/).filter(Boolean);
  const shortWords = [];
  let total = 0;
  for (const word of words) {
    const next = total ? total + word.length + 1 : word.length;
    if (next > 105) break;
    shortWords.push(word);
    total = next;
  }

  return shortWords.join(" ").trim() || cleaned;
};

const parsePriceNumber = (value) => {
  const digits = String(value || "").replace(/[^\d]/g, "");
  if (!digits) return 0;
  return Number(digits);
};

const formatVnd = (value) =>
  Number(value || 0) > 0 ? `${Number(value).toLocaleString("vi-VN")}đ` : "Chưa có dữ liệu";

const summarizeComparison = (leftProduct, rightProduct) => {
  const left = buildProductSummary(leftProduct);
  const right = buildProductSummary(rightProduct);
  if (!left?.name || !right?.name) return null;

  return {
    products: [left, right],
    criteria: {
      gia: {
        [left.name]: left.priceText || "Chưa có dữ liệu",
        [right.name]: right.priceText || "Chưa có dữ liệu",
      },
      chatLieu: {
        [left.name]: left.materialText || "Chưa có dữ liệu",
        [right.name]: right.materialText || "Chưa có dữ liệu",
      },
      danhMuc: {
        [left.name]: left.categoryName || "Chưa có dữ liệu",
        [right.name]: right.categoryName || "Chưa có dữ liệu",
      },
      khacBietChinh: [
        `${left.name}: ${left.description || "Chưa có mô tả"}`,
        `${right.name}: ${right.description || "Chưa có mô tả"}`,
      ],
    },
  };
};

const formatComparisonAnswer = (comparison) => {
  const products = asArray(comparison?.products);
  const left = products[0];
  const right = products[1];
  if (!left?.name || !right?.name) return "";

  const gia = comparison?.criteria?.gia || {};
  const chatLieu = comparison?.criteria?.chatLieu || {};
  const danhMuc = comparison?.criteria?.danhMuc || {};
  const leftDesc = summarizeDescription(left?.description);
  const rightDesc = summarizeDescription(right?.description);
  const leftPrice = parsePriceNumber(gia[left.name]);
  const rightPrice = parsePriceNumber(gia[right.name]);
  const priceDiff = Math.abs(leftPrice - rightPrice);
  const moreExpensiveName = leftPrice > rightPrice ? left.name : right.name;
  const cheaperName = leftPrice > rightPrice ? right.name : left.name;
  const priceConclusion =
    leftPrice > 0 && rightPrice > 0
      ? `${moreExpensiveName} cao hơn ${cheaperName} khoảng ${formatVnd(priceDiff)}.`
      : "Hiện chưa đủ dữ liệu để đánh giá chênh lệch giá.";

  return [
    `Mình đã so sánh nhanh ${left.name} và ${right.name} để bạn dễ chọn:`,
    "",
    "| Tiêu chí | " + left.name + " | " + right.name + " |",
    "| --- | --- | --- |",
    `| Giá | ${gia[left.name] || "Chưa có dữ liệu"} | ${gia[right.name] || "Chưa có dữ liệu"} |`,
    `| Chất liệu | ${chatLieu[left.name] || "Chưa có dữ liệu"} | ${chatLieu[right.name] || "Chưa có dữ liệu"} |`,
    `| Danh mục | ${danhMuc[left.name] || "Chưa có dữ liệu"} | ${danhMuc[right.name] || "Chưa có dữ liệu"} |`,
    `| Điểm nổi bật | ${leftDesc} | ${rightDesc} |`,
    "",
    "Kết luận:",
    `- Về giá: ${priceConclusion}`,
    `- ${left.name} phù hợp nếu bạn thích kiểu dáng tối giản, dễ đeo hằng ngày.`,
    `- ${right.name} phù hợp nếu bạn muốn mẫu nổi bật hơn và có điểm nhấn rõ hơn.`,
  ].join("\n");
};

const sanitizePlainAnswer = (text) =>
  decodeHtmlEntities(text)
    .replace(/```(?:json)?[\s\S]*?```/gi, " ")
    .replace(/\{\s*"answer"[\s\S]*$/i, " ")
    .replace(/[*_`#>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const formatProductListAnswer = (response, requestedNeed) => {
  const products = asArray(response?.products).filter((item) => item?.name);
  if (!products.length) {
    return `Mình chưa tìm thấy sản phẩm phù hợp với yêu cầu "${requestedNeed}" trong hệ thống lúc này.`;
  }

  const lines = [];
  const isBestSeller = response?.bestSeller === true;
  lines.push(
    isBestSeller
      ? products.length >= 3
        ? `Mình gợi ý cho bạn ${products.length} sản phẩm bán chạy phù hợp nhất:`
        : `Hiện mình tìm được ${products.length} sản phẩm bán chạy phù hợp nhất:`
      : products.length >= 3
        ? `Mình gợi ý cho bạn ${products.length} sản phẩm phù hợp:`
        : `Hiện mình tìm được ${products.length} sản phẩm phù hợp nhất:`
  );
  lines.push("");
  for (const product of products) {
    lines.push(`- ${product.name}`);
    lines.push(`  Giá: ${product.priceText || "Chưa có dữ liệu"}`);
    lines.push(`  Chất liệu: ${product.materialText || "Chưa có dữ liệu"}`);
    if (isBestSeller && product.matchedSold > 0) {
      lines.push(`  Lượt bán nổi bật: ${product.matchedSold}`);
    }
    lines.push(`  Điểm nổi bật: ${summarizeDescription(product.description)}`);
    lines.push("");
  }
  lines.push(
    isBestSeller
      ? "Danh sách này được ưu tiên theo lượt bán của các biến thể đang khớp với yêu cầu giá/chất liệu của bạn."
      : "Nếu bạn muốn, mình có thể tư vấn thêm về size hoặc mẫu phù hợp để làm quà."
  );
  return lines.join("\n").trim();
};

const formatSingleProductAnswer = (response) => {
  const product = response?.product;
  if (!product?.name) {
    return response?.requestedName
      ? `Mình chưa tìm thấy sản phẩm "${response.requestedName}" trong hệ thống.`
      : "Mình chưa tìm thấy sản phẩm bạn đang hỏi trong hệ thống.";
  }

  return [
    `Mình đã tìm thấy sản phẩm ${product.name}:`,
    "",
    `- Giá: ${product.priceText || "Chưa có dữ liệu"}`,
    `- Chất liệu: ${product.materialText || "Chưa có dữ liệu"}`,
    `- Danh mục: ${product.categoryName || "Chưa có dữ liệu"}`,
    `- Điểm nổi bật: ${summarizeDescription(product.description)}`,
  ].join("\n");
};

const formatStockAnswer = (response) => {
  if (response?.notFound) {
    return `Mình chưa tìm thấy sản phẩm "${response.requestedName}" để kiểm tra tồn kho.`;
  }

  const product = response?.product;
  const variants = asArray(response?.stock?.variants);
  const requestedBits = [
    response?.requestedSize && `size ${response.requestedSize}`,
    response?.requestedMaterial,
  ]
    .filter(Boolean)
    .join(", ");

  if (!product?.name) return "Mình chưa lấy được dữ liệu tồn kho lúc này.";

  if (!variants.length) {
    return [
      `Mình đã kiểm tra ${product.name}.`,
      requestedBits
        ? `- Hiện chưa thấy biến thể phù hợp với yêu cầu ${requestedBits}.`
        : "- Hiện chưa có biến thể phù hợp.",
      "- Bạn có thể gửi lại size hoặc chất liệu khác để mình kiểm tra thêm.",
    ].join("\n");
  }

  const topVariants = variants.slice(0, 3).map((variant) => {
    const attrs = [variant?.material, variant?.color, variant?.size].filter(Boolean).join(", ");
    return `${attrs || "Biến thể mặc định"}: còn ${Math.max(0, Number(variant?.quantity) || 0)} sản phẩm`;
  });

  return [
    `Mình đã kiểm tra tồn kho cho ${product.name}:`,
    "",
    ...topVariants.map((item) => `- ${item}`),
  ].join("\n");
};

const formatOrderAnswer = (response) => {
  const order = response?.order;
  if (!order) {
    return "Mình chưa đủ thông tin để tra cứu đơn hàng. Bạn gửi giúp mình mã đơn, email hoặc số điện thoại đặt hàng nhé.";
  }

  if (order?.notFound) {
    return `Mình chưa tìm thấy đơn hàng theo thông tin bạn cung cấp. Bạn kiểm tra lại mã đơn, email hoặc số điện thoại giúp mình nhé.`;
  }

  if (order?.multiple) {
    const rows = asArray(order.orders)
      .slice(0, 3)
      .map((item) => `${item.orderCode}: ${item.status}, ${item.totalText || "Chưa có dữ liệu"}`);
    return [
      "Mình tìm thấy một số đơn hàng phù hợp:",
      "",
      ...rows.map((item) => `- ${item}`),
      "",
      "Bạn gửi lại mã đơn cụ thể để mình kiểm tra chi tiết hơn nhé.",
    ].join("\n");
  }

  return [
    `Mình đã tra cứu đơn hàng ${order.orderCode || ""}:`,
    "",
    `- Trạng thái đơn: ${order.status || "Chưa có dữ liệu"}`,
    `- Thanh toán: ${order.paymentStatus || "Chưa có dữ liệu"}`,
    `- Phương thức: ${order.method || "Chưa có dữ liệu"}`,
    `- Tổng tiền: ${order.totalText || "Chưa có dữ liệu"}`,
    ...(asArray(order.items).length
      ? [
          "- Sản phẩm:",
          ...asArray(order.items)
            .slice(0, 4)
            .map((item) => `  • ${item.name} x${item.quantity}`),
        ]
      : []),
  ].join("\n");
};

const formatPaymentAnswer = (response) => {
  const guide = response?.paymentGuide;
  if (!guide) return "Mình chưa lấy được hướng dẫn thanh toán lúc này.";

  return [
    guide?.selectedMethod
      ? `Mình gửi bạn hướng dẫn thanh toán bằng ${guide.selectedMethod.label}:`
      : "Mình gửi bạn hướng dẫn thanh toán trên website:",
    "",
    ...(guide?.selectedMethod ? [`- ${guide.selectedMethod.description}`] : []),
    ...asArray(guide?.checkoutSteps).map((step, index) => `- Bước ${index + 1}: ${step}`),
  ].join("\n");
};

const formatBraceletSizeGuideAnswer = (response) => {
  const guide = response?.sizeGuide;
  if (!guide) return "Mình chưa lấy được hướng dẫn chọn size vòng tay lúc này.";

  return [
    `Mình gửi bạn hướng dẫn chọn size vòng tay cho dòng ${guide.line}:`,
    "",
    "Cách đo cổ tay:",
    ...asArray(guide.measuringSteps).map((step) => `- ${step}`),
    "",
    "Cách chọn size:",
    ...asArray(guide.fitTips).map((tip) => `- ${tip}`),
    "",
    "Bảng size tham khảo Pandora Moments:",
    ...asArray(guide.momentsChart)
      .slice(0, 7)
      .map((item) => `- Cổ tay ${item.wristCm} cm: size ${item.braceletSize}`),
    "",
    `Lưu ý: ${guide.extraNote}`,
  ].join("\n");
};

const formatReturnPolicyAnswer = (response) => {
  const policy = response?.policy;
  if (!policy) return "Mình chưa lấy được chính sách đổi trả lúc này.";

  return [
    `${policy.title}:`,
    "",
    `- Thời gian áp dụng: ${policy.timeLimit}`,
    "- Trường hợp được hỗ trợ đổi hàng:",
    ...asArray(policy.acceptedCases).map((item) => `  • ${item}`),
    "- Hồ sơ cần cung cấp:",
    ...asArray(policy.requiredEvidence).map((item) => `  • ${item}`),
    `- Lưu ý: ${policy.refusalNote}`,
  ].join("\n");
};

const formatShippingPolicyAnswer = (response) => {
  const policy = response?.shippingPolicy;
  if (!policy) return "Mình chưa lấy được chính sách giao hàng lúc này.";

  return [
    `${policy.title}:`,
    "",
    `- Ưu đãi: ${policy.freeShipping}`,
    ...asArray(policy.highlights).map((item) => `- ${item}`),
    `- Cam kết: ${policy.commitment}`,
  ].join("\n");
};

const formatCollectionInfoAnswer = (response) => {
  if (response?.notFound) {
    return `Hiện hệ thống chưa có bộ sưu tập "${response.requestedName}". Bạn có thể hỏi bộ sưu tập hoặc sản phẩm khác giúp mình nhé.`;
  }

  const collections = asArray(response?.collections).filter((item) => item?.name);
  if (!response?.requestedName && collections.length) {
    return [
      "Hiện cửa hàng có các bộ sưu tập sau:",
      "",
      ...collections.map((item) => `- ${item.name}`),
    ].join("\n");
  }

  const collection = response?.collection;
  if (!collection?.name) return NO_DATA_ANSWER;

  return [
    `Mình đã kiểm tra bộ sưu tập ${collection.name}:`,
    "",
    `- Tên bộ sưu tập: ${collection.name}`,
    `- Mô tả: ${summarizeDescription(collection.description)}`,
    `- Số sản phẩm hiện có: ${Math.max(0, Number(response.productCount) || 0)}`,
  ].join("\n");
};

const formatCollectionProductsAnswer = (response) => {
  if (response?.notFound) {
    return `Hiện hệ thống chưa có bộ sưu tập "${response.requestedName}". Bạn có thể hỏi bộ sưu tập khác giúp mình nhé.`;
  }

  const collectionName = response?.collection?.name || response?.requestedName || "bộ sưu tập này";
  const products = asArray(response?.products).filter((item) => item?.name);
  if (!products.length) {
    return `Hiện hệ thống chưa có sản phẩm nào thuộc bộ sưu tập ${collectionName}. Bạn có thể hỏi bộ sưu tập khác giúp mình nhé.`;
  }

  const lines = [
    `Mình tìm thấy ${products.length} sản phẩm thuộc bộ sưu tập ${collectionName}:`,
    "",
  ];
  for (const product of products) {
    lines.push(`- ${product.name}`);
    lines.push(`  Giá: ${product.priceText || "Chưa có dữ liệu"}`);
    lines.push(`  Chất liệu: ${product.materialText || "Chưa có dữ liệu"}`);
    lines.push(`  Điểm nổi bật: ${summarizeDescription(product.description)}`);
    lines.push("");
  }
  return lines.join("\n").trim();
};

const formatCategoryInfoAnswer = (response) => {
  const categories = asArray(response?.categories).filter((item) => item?.name);
  if (response?.requestedName && response?.notFound) {
    return `Hiện hệ thống chưa có danh mục "${response.requestedName}". Bạn có thể hỏi danh mục khác giúp mình nhé.`;
  }

  if (!categories.length) return NO_DATA_ANSWER;

  if (response?.requestedName) {
    const category = categories[0];
    return [
      `Mình đã kiểm tra danh mục ${category.name}:`,
      "",
      `- Tên danh mục: ${category.name}`,
      `- Số sản phẩm hiện có: ${Math.max(0, Number(category.productCount) || 0)}`,
      ...(category.children?.length
        ? ["- Danh mục con:", ...category.children.map((item) => `  • ${item.name}`)]
        : []),
      ...(category.collections?.length
        ? [
            `- Bộ sưu tập liên quan: ${category.collections
              .slice(0, 5)
              .map((item) => item.name)
              .join(", ")}`,
          ]
        : []),
    ].join("\n");
  }

  const lines = ["Hiện cửa hàng có các loại trang sức sau:", ""];
  for (const category of categories) {
    lines.push(`- ${category.name}`);
    for (const child of asArray(category.children)) {
      lines.push(`  • ${child.name}`);
    }
  }
  return lines.join("\n");
};

const formatCategoryProductsAnswer = (response) => {
  if (response?.notFound) {
    return `Hiện hệ thống chưa có danh mục "${response.requestedName}". Bạn có thể hỏi danh mục khác giúp mình nhé.`;
  }

  const categoryName = response?.category?.name || response?.requestedName || "danh mục này";
  const products = asArray(response?.products).filter((item) => item?.name);
  if (!products.length) {
    return `Hiện hệ thống chưa có sản phẩm nào trong danh mục ${categoryName}. Bạn có thể hỏi danh mục khác giúp mình nhé.`;
  }

  const lines = [`Mình tìm thấy ${products.length} sản phẩm thuộc danh mục ${categoryName}:`, ""];
  for (const product of products) {
    lines.push(`- ${product.name}`);
    lines.push(`  Giá: ${product.priceText || "Chưa có dữ liệu"}`);
    lines.push(`  Chất liệu: ${product.materialText || "Chưa có dữ liệu"}`);
    lines.push(`  Điểm nổi bật: ${summarizeDescription(product.description)}`);
    lines.push("");
  }
  return lines.join("\n").trim();
};

const formatWishlistTopAnswer = (response) => {
  const products = asArray(response?.products).filter((item) => item?.name);
  if (!products.length) {
    return "Hiện hệ thống chưa có dữ liệu wishlist để xác định sản phẩm được yêu thích nhất. Bạn có thể hỏi sản phẩm hoặc danh mục khác giúp mình nhé.";
  }

  const lines = [
    products.length > 1
      ? `Mình gợi ý ${products.length} sản phẩm đang được nhiều khách yêu thích nhất:`
      : "Mình tìm thấy 1 sản phẩm đang được nhiều khách yêu thích:",
    "",
  ];
  for (const product of products) {
    lines.push(`- ${product.name}`);
    lines.push(`  Giá: ${product.priceText || "Chưa có dữ liệu"}`);
    lines.push(`  Chất liệu: ${product.materialText || "Chưa có dữ liệu"}`);
    if (product.wishCount > 0) lines.push(`  Lượt yêu thích: ${product.wishCount}`);
    lines.push(`  Điểm nổi bật: ${summarizeDescription(product.description)}`);
    lines.push("");
  }
  lines.push("Danh sách này được xếp theo số lượt wishlist cao nhất trong hệ thống.");
  return lines.join("\n").trim();
};

const getLatestToolResponse = (toolCalls, name) => {
  for (let index = asArray(toolCalls).length - 1; index >= 0; index -= 1) {
    const call = toolCalls[index];
    if (call?.name === name) return call?.response || null;
  }
  return null;
};

const resolveFormattedAnswer = ({ payload, toolCalls }) => {
  const comparison = extractSuccessfulComparison(toolCalls);
  if (comparison) {
    const comparisonProducts = asArray(comparison?.products);
    const comparisonLeftName = asText(comparisonProducts[0]?.name, 120);
    const comparisonRightName = asText(comparisonProducts[1]?.name, 120);
    return {
      answer: formatComparisonAnswer(comparison),
      suggestions: [
        comparisonLeftName ? `Xem chi tiết ${comparisonLeftName}` : "Xem chi tiết sản phẩm 1",
        comparisonRightName ? `Xem chi tiết ${comparisonRightName}` : "Xem chi tiết sản phẩm 2",
        "Hướng dẫn chọn size vòng tay",
      ],
      quickReplies: [
        comparisonLeftName ? `Xem ${comparisonLeftName}` : "Xem sản phẩm 1",
        comparisonRightName ? `Xem ${comparisonRightName}` : "Xem sản phẩm 2",
        "Hỗ trợ thanh toán",
      ],
    };
  }

  const productList = getLatestToolResponse(toolCalls, "timSanPhamTheoNhuCau");
  if (productList?.ok) {
    return {
      answer: formatProductListAnswer(productList, productList?.requestedNeed),
      suggestions: asArray(productList.products)
        .slice(0, 3)
        .map((item) => `Xem chi tiết ${item.name}`),
      quickReplies: ["Tư vấn thêm", "Hướng dẫn chọn size", "Hỗ trợ thanh toán"],
    };
  }

  const productDetail = getLatestToolResponse(toolCalls, "layThongTinSanPham");
  if (productDetail) {
    return {
      answer: formatSingleProductAnswer(productDetail),
      suggestions: productDetail?.product?.name
        ? [`Xem chi tiết ${productDetail.product.name}`, "Kiểm tra tồn kho", "Hỗ trợ thanh toán"]
        : payload.suggestions,
      quickReplies: ["Kiểm tra tồn kho", "Tư vấn thêm", "Hỗ trợ thanh toán"],
    };
  }

  const stock = getLatestToolResponse(toolCalls, "kiemTraTonKhoSanPham");
  if (stock) {
    return {
      answer: formatStockAnswer(stock),
      suggestions: ["Kiểm tra size khác", "Tìm mẫu tương tự", "Hỗ trợ thanh toán"],
      quickReplies: ["Kiểm tra size khác", "Tìm mẫu tương tự", "Hỗ trợ thanh toán"],
    };
  }

  const order = getLatestToolResponse(toolCalls, "traCuuDonHang");
  if (order) {
    return {
      answer: formatOrderAnswer(order),
      suggestions: ["Tra cứu đơn khác", "Hướng dẫn thanh toán", "Liên hệ nhân viên"],
      quickReplies: ["Tra cứu đơn khác", "Liên hệ nhân viên", "Hỗ trợ thanh toán"],
    };
  }

  const payment = getLatestToolResponse(toolCalls, "layHuongDanThanhToan");
  if (payment) {
    return {
      answer: formatPaymentAnswer(payment),
      suggestions: ["Thanh toán COD", "Thanh toán ZaloPay", "Liên hệ hỗ trợ"],
      quickReplies: ["Thanh toán COD", "Thanh toán ZaloPay", "Liên hệ hỗ trợ"],
    };
  }

  const sizeGuide = getLatestToolResponse(toolCalls, "layHuongDanChonSizeVongTay");
  if (sizeGuide) {
    return {
      answer: formatBraceletSizeGuideAnswer(sizeGuide),
      suggestions: ["Tư vấn chọn size", "Xem vòng tay Pandora Moments", "Hỗ trợ thanh toán"],
      quickReplies: ["Tư vấn chọn size", "Xem vòng tay", "Hỗ trợ thanh toán"],
    };
  }

  const returnPolicy = getLatestToolResponse(toolCalls, "layChinhSachDoiTraHoanHang");
  if (returnPolicy) {
    return {
      answer: formatReturnPolicyAnswer(returnPolicy),
      suggestions: ["Tra cứu đơn hàng", "Liên hệ hỗ trợ", "Hướng dẫn thanh toán"],
      quickReplies: ["Tra cứu đơn hàng", "Liên hệ hỗ trợ", "Hỗ trợ thanh toán"],
    };
  }

  const shippingPolicy = getLatestToolResponse(toolCalls, "layChinhSachGiaoHang");
  if (shippingPolicy) {
    return {
      answer: formatShippingPolicyAnswer(shippingPolicy),
      suggestions: ["Tra cứu đơn hàng", "Hướng dẫn thanh toán", "Liên hệ hỗ trợ"],
      quickReplies: ["Tra cứu đơn hàng", "Hỗ trợ thanh toán", "Liên hệ hỗ trợ"],
    };
  }

  const collectionInfo = getLatestToolResponse(toolCalls, "layThongTinBoSuuTap");
  if (collectionInfo) {
    return {
      answer: formatCollectionInfoAnswer(collectionInfo),
      suggestions: ["Xem sản phẩm theo bộ sưu tập", "Tìm sản phẩm", "Liên hệ hỗ trợ"],
      quickReplies: ["Xem bộ sưu tập", "Tìm sản phẩm", "Liên hệ hỗ trợ"],
    };
  }

  const collectionProducts = getLatestToolResponse(toolCalls, "timSanPhamTheoBoSuuTap");
  if (collectionProducts) {
    return {
      answer: formatCollectionProductsAnswer(collectionProducts),
      suggestions: asArray(collectionProducts.products)
        .slice(0, 3)
        .map((item) => `Xem chi tiết ${item.name}`),
      quickReplies: ["Xem bộ sưu tập khác", "Tìm sản phẩm", "Liên hệ hỗ trợ"],
    };
  }

  const categoryInfo = getLatestToolResponse(toolCalls, "layDanhMucSanPham");
  if (categoryInfo) {
    return {
      answer: formatCategoryInfoAnswer(categoryInfo),
      suggestions: ["Tìm sản phẩm theo danh mục", "Xem bộ sưu tập", "Liên hệ hỗ trợ"],
      quickReplies: ["Xem danh mục", "Tìm sản phẩm", "Liên hệ hỗ trợ"],
    };
  }

  const categoryProducts = getLatestToolResponse(toolCalls, "timSanPhamTheoDanhMuc");
  if (categoryProducts) {
    return {
      answer: formatCategoryProductsAnswer(categoryProducts),
      suggestions: asArray(categoryProducts.products)
        .slice(0, 3)
        .map((item) => `Xem chi tiết ${item.name}`),
      quickReplies: ["Xem danh mục khác", "Tìm sản phẩm", "Liên hệ hỗ trợ"],
    };
  }

  const wishlistTop = getLatestToolResponse(toolCalls, "laySanPhamYeuThichNhat");
  if (wishlistTop) {
    return {
      answer: formatWishlistTopAnswer(wishlistTop),
      suggestions: asArray(wishlistTop.products)
        .slice(0, 3)
        .map((item) => `Xem chi tiết ${item.name}`),
      quickReplies: ["Sản phẩm bán chạy", "Tìm sản phẩm", "Liên hệ hỗ trợ"],
    };
  }

  if (!asArray(toolCalls).length) {
    return {
      answer: NO_DATA_ANSWER,
      suggestions: ["Tìm sản phẩm", "Tra cứu đơn hàng", "Hướng dẫn thanh toán"],
      quickReplies: ["Tìm sản phẩm", "Tra cứu đơn hàng", "Hỗ trợ thanh toán"],
    };
  }

  const safeFallback = sanitizePlainAnswer(payload.answer);
  return {
    answer: safeFallback || NO_DATA_ANSWER,
    suggestions: payload.suggestions.length
      ? payload.suggestions
      : ["Tìm sản phẩm", "Tra cứu đơn hàng", "Hướng dẫn thanh toán"],
    quickReplies: payload.quickReplies.length
      ? payload.quickReplies
      : ["Tìm sản phẩm", "Tra cứu đơn hàng", "Hỗ trợ thanh toán"],
  };
};

const extractSuccessfulComparison = (toolCalls) =>
  asArray(toolCalls)
    .map((item) => item?.response?.comparison)
    .find((comparison) => asArray(comparison?.products).length >= 2) || null;

const normalizeMaterialHint = (value) => {
  const text = slugifyLite(value);
  if (!text) return "";
  if (/ma vang|gold plated|rose gold|vang hong/.test(text)) return "mạ vàng";
  if (/bac|silver|sterling/.test(text)) return "bạc";
  if (/vang|gold/.test(text)) return "vàng";
  return String(value || "").trim();
};

const normalizeLookupName = (value) => slugifyLite(asText(value, 180));

const resolveCollectionByName = async (name) => {
  const normalized = normalizeLookupName(name);
  if (!normalized) return null;

  const all = await Collection.find({ deleted: false })
    .select("name slug description createdAt")
    .sort({ createdAt: -1 })
    .lean();

  return (
    all.find(
      (item) =>
        normalizeLookupName(item?.name) === normalized ||
        normalizeLookupName(String(item?.slug || "").replace(/-/g, " ")) === normalized
    ) || null
  );
};

const fetchAllCollectionsSummary = async () => {
  const collections = await Collection.find({ deleted: false })
    .select("name slug description createdAt")
    .sort({ createdAt: -1 })
    .lean();

  return collections.map((item) => ({
    id: String(item?._id || ""),
    name: asText(item?.name, 120),
    slug: asText(item?.slug, 120),
    description: asText(item?.description, 220),
  }));
};

const resolveCategoryByName = async (name) => {
  const normalized = normalizeLookupName(name);
  if (!normalized) return null;

  const all = await Category.find({ deleted: false })
    .select("name slug parent createdAt")
    .sort({ createdAt: -1 })
    .lean();

  return (
    all.find(
      (item) =>
        normalizeLookupName(item?.name) === normalized ||
        normalizeLookupName(String(item?.slug || "").replace(/-/g, " ")) === normalized
    ) || null
  );
};

const fetchAllCategories = async () =>
  Category.find({ deleted: false })
    .select("name slug parent position createdAt")
    .sort({ position: 1, createdAt: -1 })
    .lean();

const collectDescendantCategoryIds = (rootId, categories) => {
  const all = asArray(categories);
  const childrenByParent = new Map();
  for (const category of all) {
    const parent = String(category?.parent || "").trim();
    if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
    childrenByParent.get(parent).push(category);
  }

  const visited = new Set();
  const queue = [String(rootId || "")].filter(Boolean);
  while (queue.length) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    for (const child of childrenByParent.get(current) || []) {
      const childId = String(child?._id || "");
      if (childId && !visited.has(childId)) queue.push(childId);
    }
  }
  return Array.from(visited);
};

const isRootCategory = (category) => {
  const parent = String(category?.parent || "").trim();
  return !parent;
};

const buildCategoryNode = (category, children) => ({
  id: String(category?._id || ""),
  name: asText(category?.name, 120),
  slug: asText(category?.slug, 120),
  children: children.map((item) => ({
    id: String(item?._id || ""),
    name: asText(item?.name, 120),
    slug: asText(item?.slug, 120),
  })),
});

const buildCategoryOverview = async () => {
  const categories = await fetchAllCategories();
  const byParent = new Map();
  for (const category of categories) {
    const parent = String(category?.parent || "").trim();
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push(category);
  }

  return categories
    .filter((item) => isRootCategory(item))
    .map((root) => buildCategoryNode(root, byParent.get(String(root?._id || "")) || []));
};

const buildCategoryDetail = async (category) => {
  const categories = await fetchAllCategories();
  const children = categories.filter(
    (item) => String(item?.parent || "") === String(category?._id || "")
  );
  return buildCategoryNode(category, children);
};

const fetchProductsByCollection = async (collectionId, limit) => {
  const rows = await Product.find({ deleted: false, collections: collectionId })
    .populate("category", "name slug")
    .populate("collections", "name slug")
    .select(
      "name slug description options variants priceMin priceMax category collections engraving"
    )
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return rows.map(buildProductSummaryFromDoc).filter(Boolean);
};

const fetchProductsByCategory = async (categoryId, limit) => {
  const categories = await fetchAllCategories();
  const categoryIds = collectDescendantCategoryIds(categoryId, categories);
  const rows = await Product.find({ deleted: false, category: { $in: categoryIds } })
    .populate("category", "name slug")
    .populate("collections", "name slug")
    .select(
      "name slug description options variants priceMin priceMax category collections engraving"
    )
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return rows.map(buildProductSummaryFromDoc).filter(Boolean);
};

const countProductsByCategoryTree = async (categoryId) => {
  const categories = await fetchAllCategories();
  const categoryIds = collectDescendantCategoryIds(categoryId, categories);
  return Product.countDocuments({ deleted: false, category: { $in: categoryIds } });
};

const fetchCategoryCollections = async (categoryId) => {
  const rows = await Product.find({ deleted: false, category: categoryId })
    .select("collections")
    .lean();
  const collectionIds = [
    ...new Set(rows.flatMap((item) => asArray(item?.collections).map(String))),
  ];
  if (!collectionIds.length) return [];
  const collections = await Collection.find({ _id: { $in: collectionIds }, deleted: false })
    .select("name slug")
    .sort({ createdAt: -1 })
    .lean();
  return collections.map((item) => ({
    name: asText(item?.name, 120),
    slug: asText(item?.slug, 120),
  }));
};

const fetchTopWishlistProducts = async (limit) => {
  const rows = await Wishlist.aggregate([
    {
      $group: {
        _id: "$productId",
        wishCount: { $sum: 1 },
        lastWishAt: { $max: "$createdAt" },
      },
    },
    { $sort: { wishCount: -1, lastWishAt: -1 } },
    { $limit: limit },
    {
      $lookup: {
        from: "product",
        localField: "_id",
        foreignField: "_id",
        as: "product",
      },
    },
    { $unwind: { path: "$product", preserveNullAndEmptyArrays: false } },
    { $match: { "product.deleted": false } },
  ]);

  return rows
    .map((row) => {
      const product = buildProductSummaryFromDoc(row.product);
      if (!product) return null;
      return { ...product, wishCount: Math.max(0, Number(row.wishCount) || 0) };
    })
    .filter(Boolean);
};

const buildPaymentGuide = (method) => {
  const normalized = slugifyLite(method);
  const methods = {
    cod: {
      code: "cash",
      label: "COD",
      description:
        "Thanh toán khi nhận hàng, phù hợp khi bạn muốn kiểm tra hàng trước khi trả tiền.",
    },
    zalopay: {
      code: "zalopay",
      label: "ZaloPay",
      description:
        "Thanh toán online để xác nhận đơn nhanh hơn, phù hợp khi bạn muốn xử lý ngay trên website.",
    },
  };

  const selected = /zalo/.test(normalized)
    ? methods.zalopay
    : /cod|cash|tien mat/.test(normalized)
      ? methods.cod
      : null;

  return {
    selectedMethod: selected,
    availableMethods: [methods.cod, methods.zalopay],
    checkoutSteps: [
      "Thêm sản phẩm vào giỏ hàng",
      "Mở trang Thanh toán và điền thông tin nhận hàng",
      "Chọn COD hoặc ZaloPay ở bước phương thức thanh toán",
      "Xác nhận đơn để hoàn tất checkout",
    ],
    notes: [
      "COD phù hợp nếu bạn muốn thanh toán khi nhận hàng.",
      "ZaloPay phù hợp nếu bạn muốn xác nhận thanh toán online ngay.",
    ],
  };
};

const buildBraceletSizeGuide = (line) => {
  const normalized = slugifyLite(line);
  const productLine = /reflexions/.test(normalized)
    ? "Pandora Reflexions"
    : /pandora me|\bme\b/.test(normalized)
      ? "Pandora ME"
      : /moments/.test(normalized)
        ? "Pandora Moments"
        : "Pandora Moments";

  return {
    line: productLine,
    measuringSteps: [
      "Dùng thước dây mềm quấn quanh cổ tay ngay phía trên xương cổ tay rồi ghi lại số đo.",
      "Nếu không có thước dây, dùng một sợi dây hoặc mảnh giấy, đánh dấu điểm chạm rồi đo lại bằng thước thường.",
    ],
    fitTips: [
      "Muốn đeo vừa tay: chọn size bằng số đo cổ tay.",
      "Muốn đeo thoải mái hơn: chọn size lớn hơn một chút.",
      "Nếu phân vân giữa 2 size, nên chọn size lớn hơn.",
    ],
    momentsChart: [
      { wristCm: 13, braceletSize: 15 },
      { wristCm: 14, braceletSize: 16 },
      { wristCm: 15, braceletSize: 17 },
      { wristCm: 16, braceletSize: 18 },
      { wristCm: 17, braceletSize: 19 },
      { wristCm: 18, braceletSize: 20 },
      { wristCm: 19, braceletSize: 21 },
    ],
    extraNote:
      "Nếu bạn dự định đeo hơn 5 charm trên vòng Pandora Moments, nên tăng lên 1 size để đeo thoải mái hơn.",
  };
};

const buildReturnPolicyGuide = () => ({
  title: "Chính sách đổi trả và hoàn hàng",
  timeLimit:
    'Đổi trả trong vòng 07 ngày kể từ khi hệ thống cập nhật trạng thái "Giao hàng thành công".',
  acceptedCases: [
    "Sản phẩm bị hư hỏng, lỗi do nhà sản xuất hoặc từ phía shop.",
    "Sản phẩm bị bể vỡ, móp méo hoặc hư hỏng trong quá trình vận chuyển.",
    "Shop giao sai mẫu mã, sai kích thước hoặc thiếu số lượng so với đơn đặt hàng.",
  ],
  requiredEvidence: [
    "Video unbox quay rõ toàn bộ quá trình khui kiện hàng, thấy rõ mã vận đơn và tình trạng hộp trước khi mở.",
    "Hình ảnh cận cảnh phần lỗi, hư hỏng hoặc sản phẩm bị giao sai.",
  ],
  refusalNote:
    "Shop xin phép từ chối giải quyết nếu thiếu video unbox hoặc sản phẩm đã qua sử dụng.",
});

const buildShippingPolicyGuide = () => ({
  title: "Chính sách miễn phí vận chuyển",
  freeShipping: "Miễn phí vận chuyển cho tất cả đơn hàng.",
  highlights: [
    "Áp dụng cho tất cả sản phẩm trên Website và Fanpage.",
    "Áp dụng cho tất cả đơn hàng trên toàn quốc.",
  ],
  commitment:
    "Tất cả đơn hàng sẽ được xử lý và vận chuyển nhanh chóng, chuyên nghiệp để bạn yên tâm mua sắm mà không cần lo về phí ship.",
});

const isExactProductNameMatch = (requestedName, productName) =>
  slugifyLite(requestedName) && slugifyLite(requestedName) === slugifyLite(productName);

const createToolExecutor =
  ({ context }) =>
  async (name, args = {}) => {
    try {
      if (name === "layThongTinSanPham") {
        const tenSanPham = asText(args?.tenSanPham, 180);
        if (!tenSanPham) return { ok: false, error: "missing_product_name" };

        const product =
          (await findProductByName(tenSanPham, context)) ||
          (await resolveConversationProduct({
            message: tenSanPham,
            history: [],
            context,
          }));

        if (!product?.name) {
          return {
            ok: false,
            notFound: true,
            requestedName: tenSanPham,
          };
        }

        return {
          ok: true,
          requestedName: tenSanPham,
          matchedBy: isExactProductNameMatch(tenSanPham, product?.name)
            ? "exact_name"
            : "name_lookup",
          product: buildProductSummary(product),
        };
      }

      if (name === "timSanPhamTheoNhuCau") {
        const yeuCau = asText(args?.yeuCau, 500);
        const soLuong = Math.min(6, Math.max(1, Number(args?.soLuong) || 4));
        if (!yeuCau) return { ok: false, error: "missing_search_request" };

        const catalog = await searchCatalogProducts({ message: yeuCau, context });
        return {
          ok: true,
          requestedNeed: yeuCau,
          bestSeller: catalog?.request?.bestSeller === true,
          total: asArray(catalog?.products).length,
          products: asArray(catalog?.products).slice(0, soLuong).map(buildProductSummary),
        };
      }

      if (name === "kiemTraTonKhoSanPham") {
        const tenSanPham = asText(args?.tenSanPham, 180);
        const size = asText(args?.size, 40);
        const material = normalizeMaterialHint(args?.chatLieu);
        if (!tenSanPham) return { ok: false, error: "missing_product_name" };

        const product =
          (await findProductByName(tenSanPham, context)) ||
          (await resolveConversationProduct({
            message: tenSanPham,
            history: [],
            context,
          }));
        if (!product?.name) {
          return {
            ok: false,
            notFound: true,
            requestedName: tenSanPham,
          };
        }

        const stock = resolveVariantStock({
          product,
          inquiry: {
            requestedSize: size,
            materialHints: material ? [material] : [],
          },
        });

        return {
          ok: true,
          requestedName: tenSanPham,
          requestedSize: size,
          requestedMaterial: material,
          product: buildProductSummary(product),
          stock,
        };
      }

      if (name === "soSanhSanPham") {
        const tenSanPhamA = asText(args?.tenSanPhamA, 180);
        const tenSanPhamB = asText(args?.tenSanPhamB, 180);
        if (!tenSanPhamA || !tenSanPhamB) return { ok: false, error: "missing_compare_names" };

        const [productA, productB] = await Promise.all([
          findProductByName(tenSanPhamA, context).then(
            async (product) =>
              product ||
              resolveConversationProduct({
                message: tenSanPhamA,
                history: [],
                context,
              })
          ),
          findProductByName(tenSanPhamB, context).then(
            async (product) =>
              product ||
              resolveConversationProduct({
                message: tenSanPhamB,
                history: [],
                context,
              })
          ),
        ]);

        if (!productA?.name || !productB?.name) {
          return {
            ok: false,
            error: "compare_products_not_found",
            requested: { tenSanPhamA, tenSanPhamB },
            found: {
              tenSanPhamA: productA?.name || null,
              tenSanPhamB: productB?.name || null,
            },
          };
        }

        return {
          ok: true,
          requested: { tenSanPhamA, tenSanPhamB },
          comparison: summarizeComparison(productA, productB),
          products: [buildProductSummary(productA), buildProductSummary(productB)],
        };
      }

      if (name === "layHuongDanChonSizeVongTay") {
        const dongSanPham = asText(args?.dongSanPham, 60);
        return {
          ok: true,
          sizeGuide: buildBraceletSizeGuide(dongSanPham),
        };
      }

      if (name === "layChinhSachDoiTraHoanHang") {
        return {
          ok: true,
          policy: buildReturnPolicyGuide(),
        };
      }

      if (name === "layChinhSachGiaoHang") {
        return {
          ok: true,
          shippingPolicy: buildShippingPolicyGuide(),
        };
      }

      if (name === "layThongTinBoSuuTap") {
        const tenBoSuuTap = asText(args?.tenBoSuuTap, 180);
        if (!tenBoSuuTap) {
          return {
            ok: true,
            collections: await fetchAllCollectionsSummary(),
          };
        }

        const collection = await resolveCollectionByName(tenBoSuuTap);
        if (!collection?._id) {
          return { ok: false, notFound: true, requestedName: tenBoSuuTap };
        }

        const productCount = await Product.countDocuments({
          deleted: false,
          collections: collection._id,
        });

        return {
          ok: true,
          requestedName: tenBoSuuTap,
          productCount,
          collection: {
            id: String(collection._id),
            name: asText(collection.name, 120),
            slug: asText(collection.slug, 120),
            description: asText(collection.description, 220),
          },
        };
      }

      if (name === "timSanPhamTheoBoSuuTap") {
        const tenBoSuuTap = asText(args?.tenBoSuuTap, 180);
        const soLuong = Math.min(6, Math.max(1, Number(args?.soLuong) || 4));
        if (!tenBoSuuTap) return { ok: false, error: "missing_collection_name" };

        const collection = await resolveCollectionByName(tenBoSuuTap);
        if (!collection?._id) {
          return { ok: false, notFound: true, requestedName: tenBoSuuTap };
        }

        return {
          ok: true,
          requestedName: tenBoSuuTap,
          collection: {
            id: String(collection._id),
            name: asText(collection.name, 120),
            slug: asText(collection.slug, 120),
          },
          products: await fetchProductsByCollection(collection._id, soLuong),
        };
      }

      if (name === "layDanhMucSanPham") {
        const tenDanhMuc = asText(args?.tenDanhMuc, 180);
        if (!tenDanhMuc) {
          return {
            ok: true,
            categories: await buildCategoryOverview(),
          };
        }

        const category = await resolveCategoryByName(tenDanhMuc);
        if (!category?._id) {
          return { ok: false, notFound: true, requestedName: tenDanhMuc };
        }

        const productCount = await countProductsByCategoryTree(category._id);
        const collections = await fetchCategoryCollections(category._id);
        return {
          ok: true,
          requestedName: tenDanhMuc,
          categories: [
            {
              ...(await buildCategoryDetail(category)),
              productCount,
              collections,
            },
          ],
        };
      }

      if (name === "timSanPhamTheoDanhMuc") {
        const tenDanhMuc = asText(args?.tenDanhMuc, 180);
        const soLuong = Math.min(6, Math.max(1, Number(args?.soLuong) || 4));
        if (!tenDanhMuc) return { ok: false, error: "missing_category_name" };

        const category = await resolveCategoryByName(tenDanhMuc);
        if (!category?._id) {
          return { ok: false, notFound: true, requestedName: tenDanhMuc };
        }

        return {
          ok: true,
          requestedName: tenDanhMuc,
          category: {
            id: String(category._id),
            name: asText(category.name, 120),
            slug: asText(category.slug, 120),
          },
          products: await fetchProductsByCategory(category._id, soLuong),
        };
      }

      if (name === "laySanPhamYeuThichNhat") {
        const soLuong = Math.min(5, Math.max(1, Number(args?.soLuong) || 3));
        return {
          ok: true,
          products: await fetchTopWishlistProducts(soLuong),
        };
      }

      if (name === "traCuuDonHang") {
        const maDonHang = asText(args?.maDonHang, 80);
        const email = asText(args?.email, 120);
        const soDienThoai = asText(args?.soDienThoai, 30);
        const lookupMessage = [maDonHang, email, soDienThoai].filter(Boolean).join(" ");

        if (!lookupMessage) return { ok: false, error: "missing_lookup_key" };

        const order = await lookupOrderForChat({
          message: lookupMessage,
          context,
        });

        return {
          ok: true,
          requested: { maDonHang, email, soDienThoai },
          order,
        };
      }

      if (name === "layHuongDanThanhToan") {
        const phuongThuc = asText(args?.phuongThuc, 40);
        return {
          ok: true,
          paymentGuide: buildPaymentGuide(phuongThuc),
        };
      }

      return {
        ok: false,
        error: "unknown_function",
        name,
      };
    } catch (error) {
      return {
        ok: false,
        error: error?.message || "tool_execution_failed",
        name,
      };
    }
  };

const collectRecommendedProducts = (toolCalls) => {
  const items = [];
  for (const call of asArray(toolCalls)) {
    const response = call?.response;
    if (response?.product?.name) items.push(response.product);
    for (const product of asArray(response?.products)) {
      if (product?.name) items.push(product);
    }
  }

  const seen = new Set();
  return items.filter((item) => {
    const key = item.id || item.slug || item.name;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const processChatbotMessage = async (body) => {
  const apiKey = String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
  if (!apiKey) {
    throw createHttpError(
      "Chatbot chưa được cấu hình Gemini API key",
      503,
      "chatbot_missing_api_key"
    );
  }

  const model = normalizeModelName(process.env.GEMINI_MODEL || DEFAULT_MODEL);
  const rawMessage = String(body?.message || "").trim();
  if (!rawMessage) {
    throw createHttpError("Tin nhắn không được để trống", 400, "chatbot_invalid_message");
  }

  const message =
    rawMessage.length > MAX_MESSAGE_LENGTH ? rawMessage.slice(0, MAX_MESSAGE_LENGTH) : rawMessage;
  const history = clampHistory(body?.history);
  const context = normalizeContext(body?.context);
  const executeTool = createToolExecutor({ context });

  const { payload, toolCalls } = await runFunctionCallingChat({
    apiKey,
    model,
    history,
    message,
    executeTool,
  });

  const formatted = resolveFormattedAnswer({ payload, toolCalls });

  return {
    answer: formatted.answer,
    suggestions: formatted.suggestions,
    quickReplies: formatted.quickReplies.length ? formatted.quickReplies : DEFAULT_QUICK_REPLIES,
    recommendedProducts: collectRecommendedProducts(toolCalls).slice(0, 6),
    intent: "function_calling",
    sourceMeta: {
      answerTool: "gemini_function_calling",
      usedLlm: true,
      usedFunctionCalling: true,
      model,
      toolCalls: toolCalls.map((item) => ({
        name: item.name,
        args: item.args,
        ok: item?.response?.ok !== false,
      })),
    },
  };
};

module.exports = {
  processChatbotMessage,
};
