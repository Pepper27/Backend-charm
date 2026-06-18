const { normalizeContext } = require("./context.service");
const { lookupOrderForChat } = require("./order.service");
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

const buildProductSummary = (product) => {
  if (!product?.name) return null;
  return {
    id: product.id || "",
    slug: product.slug || "",
    name: product.name,
    priceText: product.priceText || "",
    materialText: product.materialText || "",
    categoryName: product.categoryName || "",
    description: product.description || "",
    canEngrave: Boolean(product.canEngrave),
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
  lines.push(
    products.length >= 3
      ? `Mình gợi ý cho bạn ${products.length} sản phẩm phù hợp:`
      : `Hiện mình tìm được ${products.length} sản phẩm phù hợp nhất:`
  );
  lines.push("");
  for (const product of products) {
    lines.push(`- ${product.name}`);
    lines.push(`  Giá: ${product.priceText || "Chưa có dữ liệu"}`);
    lines.push(`  Chất liệu: ${product.materialText || "Chưa có dữ liệu"}`);
    lines.push(`  Điểm nổi bật: ${summarizeDescription(product.description)}`);
    lines.push("");
  }
  lines.push("Nếu bạn muốn, mình có thể tư vấn thêm về size hoặc mẫu phù hợp để làm quà.");
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

  return {
    answer: sanitizePlainAnswer(payload.answer),
    suggestions: payload.suggestions,
    quickReplies: payload.quickReplies,
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
