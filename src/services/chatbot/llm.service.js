const { isGlobalChatScope } = require("./context.service");
const { parseProductRequest } = require("./intent.service");
const {
  chooseBestSizeProduct,
  inferCompareStyleHint,
  inferStyleHint,
  isBraceletLike,
} = require("./product.service");
const {
  DEFAULT_FALLBACK_MODELS,
  GEMINI_API_BASE,
  INTENT,
  TOOL,
  asArray,
  asText,
  extractMeasurementCm,
  normalizeModelName,
  uniqueBy,
} = require("./shared");

const buildBraceletSizeAdvice = ({ product, wristCm }) => {
  if (!wristCm || wristCm <= 0) return null;
  const suggested = Math.round((wristCm + 2) * 10) / 10;
  const snug = Math.round((wristCm + 1) * 10) / 10;
  const roomy = Math.round((wristCm + 3) * 10) / 10;
  const display = Number.isInteger(suggested)
    ? `${suggested}cm`
    : `${String(suggested).replace(".", ",")}cm`;
  const snugDisplay = Number.isInteger(snug) ? `${snug}cm` : `${String(snug).replace(".", ",")}cm`;
  const roomyDisplay = Number.isInteger(roomy)
    ? `${roomy}cm`
    : `${String(roomy).replace(".", ",")}cm`;
  return {
    answer: [
      product?.name
        ? `Với ${product.name}, nếu cổ tay bạn ${wristCm}cm thì nên chọn khoảng ${display}.`
        : `Nếu cổ tay bạn ${wristCm}cm thì nên chọn vòng khoảng ${display}.`,
      "Rule mình đang áp dụng là cộng thêm 2cm so với cổ tay để đeo thoải mái hơn.",
      `Nếu bạn thích đeo ôm tay hơn có thể cân nhắc khoảng ${snugDisplay}. Nếu bạn định phối nhiều charm thì có thể lên khoảng ${roomyDisplay}.`,
    ].join("\n"),
    suggestions: [display, snugDisplay, roomyDisplay],
    quickReplies: ["Mình đeo ít charm thôi", "Mình muốn đeo ôm tay", "Mình muốn phối nhiều charm"],
  };
};

const requestTargetsCharm = (request) =>
  [
    ...asArray(request?.categoryHints),
    ...asArray(request?.categorySlugs),
    ...asArray(request?.categoryRootSlugs),
  ].some((item) =>
    String(item || "")
      .toLowerCase()
      .startsWith("charm")
  );

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
  const catalogLines =
    asArray(catalog?.products)
      .slice(0, 6)
      .map(
        (item, index) =>
          `${index + 1}. ${item.name} | ${item.priceText || "liên hệ"} | chất liệu: ${item.materialText || "-"}`
      )
      .join("\n") || "Không có sản phẩm phù hợp được backend tìm thấy.";
  const compareLines =
    asArray(comparison?.products)
      .map(
        (item, index) =>
          `${index + 1}. ${item.name} | ${item.priceText || "liên hệ"} | điểm nổi bật: ${inferStyleHint(item)}`
      )
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
  if (intent === INTENT.STOCK && context.__resolvedProduct?.name) {
    const stock = context.__variantStock;
    const product = context.__resolvedProduct;
    const requestedSize = stock?.requestedSize;
    const requestedMaterials = asArray(stock?.requestedMaterials);
    const matchedVariants = asArray(stock?.variants);
    const allVariants = asArray(stock?.allVariants);

    if (requestedSize) {
      if (!matchedVariants.length) {
        return {
          answer: `Mẫu ${product.name} hiện không có biến thể size ${requestedSize}${requestedMaterials.length ? ` với chất liệu ${requestedMaterials.join(", ")}` : ""}. Nếu muốn, mình có thể gợi ý size khác đang có sẵn cho bạn.`,
          suggestions: allVariants
            .map((item) => item.size)
            .filter(Boolean)
            .slice(0, 4),
          quickReplies: ["Xem size khác", "Mẫu này giá bao nhiêu?", "Gợi ý mẫu tương tự"],
        };
      }

      const available = matchedVariants.filter((item) => Number(item.quantity) > 0);
      if (available.length) {
        const best = available.sort((a, b) => Number(b.quantity || 0) - Number(a.quantity || 0))[0];
        return {
          answer: `Mẫu ${product.name} hiện còn size ${requestedSize}${best.material ? ` (${best.material})` : ""}, số lượng còn khoảng ${best.quantity} sản phẩm${best.price ? `, giá hiện tại ${best.price.toLocaleString("vi-VN")}đ` : ""}.`,
          suggestions: [],
          quickReplies: ["Giữ giúp mình mẫu này", "Xem size khác", "Gợi ý mẫu tương tự"],
        };
      }

      return {
        answer: `Mẫu ${product.name} có biến thể size ${requestedSize}${requestedMaterials.length ? ` với chất liệu ${requestedMaterials.join(", ")}` : ""}, nhưng hiện đang hết hàng. Nếu muốn, mình có thể gợi ý size khác hoặc mẫu gần giống đang còn sẵn.`,
        suggestions: allVariants
          .map((item) => item.size)
          .filter(Boolean)
          .slice(0, 4),
        quickReplies: ["Xem size khác", "Gợi ý mẫu gần giống", "Mẫu này giá bao nhiêu?"],
      };
    }

    const availableVariants = allVariants.filter((item) => Number(item.quantity) > 0);
    if (availableVariants.length) {
      return {
        answer: `Mẫu ${product.name} hiện đang còn hàng. ${availableVariants
          .slice(0, 4)
          .map(
            (item) =>
              `${item.size ? `Size ${item.size}` : "Biến thể"}${item.material ? ` - ${item.material}` : ""}: còn khoảng ${item.quantity}`
          )
          .join("; ")}.`,
        suggestions: availableVariants
          .map((item) => item.size)
          .filter(Boolean)
          .slice(0, 4),
        quickReplies: ["Kiểm tra size 18", "Mẫu này giá bao nhiêu?", "Gợi ý mẫu tương tự"],
      };
    }
  }

  if (intent === INTENT.DETAIL && context.__resolvedProduct?.name) {
    const product = context.__resolvedProduct;
    const variants = asArray(product.variantSummaries);
    const materialSummary = uniqueBy(
      variants.map((item) => item.material).filter(Boolean),
      (item) => item
    ).slice(0, 4);
    const sizeSummary = uniqueBy(
      variants.map((item) => item.size).filter(Boolean),
      (item) => item
    ).slice(0, 6);
    return {
      answer: `${product.name}${product.priceText ? ` hiện có mức giá ${product.priceText}` : ""}${materialSummary.length ? `, chất liệu gồm ${materialSummary.join(", ")}` : ""}${sizeSummary.length ? `, size đang có ${sizeSummary.join(", ")}` : ""}. ${product.description ? product.description : "Nếu muốn, mình có thể kiểm tra thêm tồn kho theo size hoặc gợi ý mẫu tương tự cho bạn."}`,
      suggestions: sizeSummary,
      quickReplies: ["Còn size 18 không?", "Mẫu này có mạ vàng không?", "Gợi ý mẫu tương tự"],
    };
  }

  if (intent === INTENT.BESTSELLER && catalog.products.length) {
    const top = [...catalog.products]
      .sort((a, b) => (Number(b.totalSold) || 0) - (Number(a.totalSold) || 0))
      .slice(0, 4);
    const request = parseProductRequest(context.__messageRaw || "", context);
    const label = requestTargetsCharm(request) ? "mẫu charm" : "mẫu sản phẩm";
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
        quickReplies: [
          "Mình đeo ít charm thôi",
          "Mình muốn đeo ôm tay",
          "Mình muốn phối nhiều charm",
        ],
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
        "Mình gợi ý bạn ưu tiên các charm bạc hoặc charm có điểm nhấn sáng để vòng nhìn cân đối hơn.",
        `Một vài charm bạn có thể tham khảo ngay là: ${top.map((item) => item.name).join(", ")}.`,
        "Nếu muốn, mình có thể gợi ý tiếp theo 3 kiểu: thanh lịch, dễ đeo hằng ngày hoặc nổi bật để làm quà tặng.",
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
    return {
      answer: [
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
        .join("\n"),
      suggestions: [a.name, b.name].slice(0, 2),
      quickReplies: [
        "Mẫu nào dễ phối charm hơn?",
        "Mẫu nào hợp làm quà tặng?",
        "Lọc thêm mẫu tương tự",
      ],
    };
  }

  if (intent === INTENT.COMPARE) {
    const requestedNames = asArray(comparison?.names).filter(Boolean);
    const foundNames = asArray(comparison?.products).map((item) => item.name);
    if (foundNames.length === 1 && requestedNames.length >= 2) {
      const missing =
        requestedNames.find(
          (name) => !foundNames[0] || !String(foundNames[0]).includes(String(name))
        ) || requestedNames[1];
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
    return {
      answer: `Mình thấy vài mẫu khá hợp với nhu cầu của bạn: ${top.map((item, index) => `${index + 1}. ${item.name}${item.priceText ? ` - ${item.priceText}` : ""}`).join("; ")}. Nếu bạn muốn, mình có thể lọc tiếp theo ngân sách, kiểu dáng thanh lịch hay kiểu charm để phối hạt.`,
      suggestions: top.map((item) => item.name).slice(0, 3),
      quickReplies: ["Lọc dưới 2 triệu", "Gợi ý mẫu thanh lịch", "Gợi ý mẫu phối charm"],
    };
  }

  if ((intent === INTENT.SEARCH || intent === INTENT.BESTSELLER) && !catalog.products.length) {
    const request =
      context.__searchRequest || parseProductRequest(context.__messageRaw || "", context);
    const budgetText =
      request.priceMax > 0 ? ` dưới ${request.priceMax.toLocaleString("vi-VN")}đ` : "";
    const categoryText = requestTargetsCharm(request) ? "mẫu charm" : "sản phẩm";
    return {
      answer: `Hiện tại mình chưa tìm thấy ${categoryText}${budgetText} đúng với yêu cầu của bạn. Bạn có thể thử nới ngân sách thêm một chút hoặc để mình gợi ý các mẫu gần mức giá đó nhất.`,
      suggestions: [],
      quickReplies: ["Gợi ý gần 2 triệu nhất", "Nới ngân sách lên 3 triệu", "Lọc charm thanh lịch"],
    };
  }

  if (intent === INTENT.ORDER) {
    const order = context.__resolvedOrder;
    if (order?.multiple && asArray(order.orders).length) {
      return {
        answer: `Mình tìm thấy ${order.orders.length} đơn gần nhất liên quan đến ${order.lookupKey}:\n${order.orders.map((item, index) => `${index + 1}. ${item.orderCode} - ${item.status}${item.totalText ? ` - ${item.totalText}` : ""}${item.paymentStatus ? ` (${item.paymentStatus})` : ""}`).join("\n")}\nBạn có thể gửi mã đơn cụ thể để mình giải thích chi tiết hơn.`,
        suggestions: order.orders.map((item) => item.orderCode).slice(0, 3),
        quickReplies: [
          "Giải thích trạng thái đơn",
          "Đơn này có hủy được không?",
          "Hướng dẫn thanh toán",
        ],
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
        quickReplies: [
          "Đơn này có hủy được không?",
          "Giải thích trạng thái đơn",
          "Hướng dẫn thanh toán lại",
        ],
      };
    }
    return {
      answer:
        "Bạn có thể tra cứu đơn bằng mã đơn (vd: ORD...), email hoặc số điện thoại đã dùng khi mua. Nếu chưa có mã, vào mục Đơn hàng trên website và nhập email/số điện thoại để xem danh sách đơn.",
      suggestions: [],
      quickReplies: [
        "Hướng dẫn tra cứu đơn",
        "Hướng dẫn thanh toán",
        "Đơn chưa thanh toán xử lý sao?",
      ],
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
      quickReplies: [
        "COD khác gì ZaloPay?",
        "Thanh toán lại đơn cũ",
        "Đơn chưa thanh toán xử lý sao?",
      ],
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
    answer:
      'Mình có thể hỗ trợ bạn tìm sản phẩm, so sánh mẫu, chọn size, tư vấn mix charm hoặc giải thích đơn hàng. Bạn có thể nói rõ hơn như: "mình cần vòng tay bạc dưới 2 triệu" hoặc "so sánh giúp mình 2 mẫu này".',
    suggestions: [],
    quickReplies: ["Tìm vòng tay bạc", "So sánh 2 mẫu", "Hướng dẫn chọn size"],
  };
};

const callGeminiOnce = async ({
  apiKey,
  model,
  message,
  history,
  context,
  intent,
  catalog,
  comparison,
  policyHints,
}) => {
  const response = await fetch(
    `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: buildSystemInstruction() }] },
        contents: [
          ...toGeminiHistory(history),
          {
            role: "user",
            parts: [
              {
                text: buildUserPrompt({
                  message,
                  context,
                  intent,
                  catalog,
                  comparison,
                  policyHints,
                }),
              },
            ],
          },
        ],
        generationConfig: { temperature: 0.55, topP: 0.9, maxOutputTokens: 700 },
      }),
    }
  );
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      data?.error?.message || data?.message || `Gemini request failed (${response.status})`
    );
  const structured = parseStructuredAnswer(extractText(data));
  if (!structured || !structured.answer) throw new Error("Gemini returned an invalid response");
  return {
    answer: asText(structured.answer, 4000),
    suggestions: asArray(structured.suggestions)
      .map((item) => asText(item, 120))
      .filter(Boolean)
      .slice(0, 4),
    quickReplies: asArray(structured.quickReplies)
      .map((item) => asText(item, 80))
      .filter(Boolean)
      .slice(0, 4),
  };
};

const requestGemini = async ({
  apiKey,
  model,
  message,
  history,
  context,
  intent,
  catalog,
  comparison,
  policyHints,
}) => {
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
    (item) => item
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
      const canRetry = /high demand|unavailable|invalid response|deadline|timeout|internal/.test(
        messageText
      );
      if (!canRetry || currentModel === fallbackModels[fallbackModels.length - 1]) break;
    }
  }
  throw lastError || new Error("Gemini request failed");
};

const resolveAssistantResult = async ({
  apiKey,
  model,
  message,
  history,
  context,
  intent,
  catalog,
  comparison,
  policyHints,
}) => {
  if (
    intent === INTENT.COMPARE ||
    context.__comparisonReady ||
    [INTENT.STOCK, INTENT.DETAIL, INTENT.ORDER, INTENT.PAYMENT, INTENT.POLICY].includes(intent)
  ) {
    return {
      result: buildDeterministicAnswer({ intent, catalog, comparison, context, policyHints }),
      sourceMeta: { answerTool: TOOL.DETERMINISTIC_RESPONSE, usedLlm: false, fallbackUsed: false },
    };
  }
  try {
    const result = await requestGemini({
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
    return {
      result,
      sourceMeta: { answerTool: TOOL.GEMINI_RESPONSE, usedLlm: true, fallbackUsed: false },
    };
  } catch {
    return {
      result: buildDeterministicAnswer({ intent, catalog, comparison, context, policyHints }),
      sourceMeta: { answerTool: TOOL.DETERMINISTIC_RESPONSE, usedLlm: false, fallbackUsed: true },
    };
  }
};

const resolveDefaultQuickReplies = (intent) =>
  intent === INTENT.STOCK
    ? ["Kiểm tra size khác", "Mẫu này giá bao nhiêu?", "Gợi ý mẫu tương tự"]
    : intent === INTENT.DETAIL
      ? ["Còn size 18 không?", "Mẫu này có mạ vàng không?", "Gợi ý mẫu tương tự"]
      : intent === INTENT.COMPARE
        ? ["Mẫu nào dễ phối charm hơn?", "Mẫu nào hợp làm quà tặng?", "Xem thêm mẫu tương tự"]
        : intent === INTENT.ORDER
          ? ["Hướng dẫn tra cứu đơn", "Giải thích trạng thái đơn", "Hướng dẫn thanh toán"]
          : intent === INTENT.PAYMENT
            ? ["COD khác gì ZaloPay?", "Thanh toán lại đơn cũ", "Đơn chưa thanh toán xử lý sao?"]
            : intent === INTENT.SEARCH
              ? ["Lọc dưới 2 triệu", "Gợi ý mẫu thanh lịch", "Gợi ý vòng charm"]
              : ["Tìm vòng tay bạc", "So sánh sản phẩm", "Hướng dẫn chọn size"];

module.exports = {
  buildDeterministicAnswer,
  requestGemini,
  resolveAssistantResult,
  resolveDefaultQuickReplies,
};
