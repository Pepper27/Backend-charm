const { GoogleGenAI } = require("@google/genai");
const { DEFAULT_MODEL, asArray, asText, normalizeModelName } = require("./shared");

const MAX_TOOL_ROUNDS = 3;
const MAX_TOOL_CALLS_PER_ROUND = 4;

const FUNCTION_DECLARATIONS = [
  {
    name: "layThongTinSanPham",
    description:
      "Lay thong tin chi tiet cua mot san pham cu the theo ten san pham de tra loi ve gia, chat lieu, mo ta, bien the va thong tin ban hang.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        tenSanPham: {
          type: "string",
          description: "Ten san pham can tra cuu, vi du: Vong tay Moments tron mo",
        },
      },
      required: ["tenSanPham"],
    },
  },
  {
    name: "timSanPhamTheoNhuCau",
    description:
      "Tim danh sach san pham phu hop theo nhu cau khach hang, ngan sach, chat lieu, loai san pham hoac tu khoa tim kiem.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        yeuCau: {
          type: "string",
          description:
            "Nhu cau tim san pham cua khach, co the giu nguyen cau hoi goc hoac rut gon thanh yeu cau tim kiem",
        },
        soLuong: {
          type: "number",
          description: "So san pham muon lay ra de goi y, thuong tu 3 den 6",
        },
      },
      required: ["yeuCau"],
    },
  },
  {
    name: "kiemTraTonKhoSanPham",
    description:
      "Kiem tra ton kho cua san pham theo ten, co the kem size va chat lieu neu khach hoi con hang bien the cu the.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        tenSanPham: {
          type: "string",
          description: "Ten san pham can kiem tra ton kho",
        },
        size: {
          type: "string",
          description: "Size khach dang hoi, neu co",
        },
        chatLieu: {
          type: "string",
          description: "Chat lieu khach dang hoi, neu co",
        },
      },
      required: ["tenSanPham"],
    },
  },
  {
    name: "soSanhSanPham",
    description:
      "So sanh truc tiep hai san pham cu the theo ten. Dung tool nay khi khach hoi so sanh, khac nhau, nen chon mau nao, mau nao hop hon.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        tenSanPhamA: {
          type: "string",
          description: "Ten san pham thu nhat can so sanh",
        },
        tenSanPhamB: {
          type: "string",
          description: "Ten san pham thu hai can so sanh",
        },
      },
      required: ["tenSanPhamA", "tenSanPhamB"],
    },
  },
  {
    name: "layHuongDanChonSizeVongTay",
    description:
      "Lay huong dan tom tat cach chon size vong tay, cach do co tay va bang quy doi size co ban cho Pandora Moments.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        dongSanPham: {
          type: "string",
          description:
            "Dong san pham neu khach co nhac den, vi du Pandora Moments, Pandora ME, Pandora Reflexions",
        },
      },
    },
  },
  {
    name: "layChinhSachDoiTraHoanHang",
    description:
      "Lay chinh sach doi tra va hoan hang chinh thuc cua shop, gom thoi gian ap dung, dieu kien doi hang va ho so bat buoc.",
    parametersJsonSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "layChinhSachGiaoHang",
    description: "Lay chinh sach giao hang va mien phi van chuyen chinh thuc cua shop.",
    parametersJsonSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "traCuuDonHang",
    description: "Tra cuu trang thai don hang theo ma don, email hoac so dien thoai cua khach.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        maDonHang: {
          type: "string",
          description: "Ma don hang neu khach cung cap, vi du ORDABC12345",
        },
        email: {
          type: "string",
          description: "Email dat hang cua khach neu khong co ma don",
        },
        soDienThoai: {
          type: "string",
          description: "So dien thoai dat hang cua khach neu khong co ma don",
        },
      },
    },
  },
  {
    name: "layHuongDanThanhToan",
    description:
      "Lay thong tin huong dan thanh toan, cach chon COD hoac ZaloPay va cac buoc checkout tren website.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        phuongThuc: {
          type: "string",
          description: "Phuong thuc ma khach dang quan tam, vi du COD hoac ZaloPay",
        },
      },
    },
  },
];

const buildSystemInstruction =
  () => `Bạn là trợ lý bán hàng AI của Kim Bảo Jewelry, chạy theo mô hình function calling.

Quy tắc vận hành:
- Khi khách hỏi về sản phẩm, đơn hàng hoặc thanh toán, hãy ưu tiên gọi function phù hợp để lấy dữ liệu thật từ hệ thống trước khi trả lời.
- Nếu khách yêu cầu so sánh 2 sản phẩm, hãy gọi function soSanhSanPham. Sau khi có dữ liệu, phải nêu rõ điểm giống, điểm khác và kết luận ngắn gọn.
- Nếu khách hỏi về cách chọn size vòng tay hoặc đo cổ tay, hãy gọi function layHuongDanChonSizeVongTay.
- Nếu khách hỏi về đổi trả, hoàn hàng, lỗi sản phẩm, giao sai hàng hoặc điều kiện khiếu nại, hãy gọi function layChinhSachDoiTraHoanHang.
- Nếu khách hỏi về giao hàng, phí ship, miễn phí vận chuyển hoặc phạm vi giao hàng, hãy gọi function layChinhSachGiaoHang.
- Không được bịa giá, tồn kho, trạng thái đơn, phương thức thanh toán hay thông số sản phẩm nếu function chưa trả về.
- Nếu function báo không tìm thấy dữ liệu, nói rõ là hệ thống chưa tìm thấy và hướng dẫn khách cung cấp lại tên sản phẩm, link, mã đơn, email hoặc số điện thoại.
- Chỉ dùng dữ liệu do function trả về để kết luận. Không tự thêm dữ kiện bên ngoài.
- Khi trả lời so sánh, nếu có đủ 2 sản phẩm thì phải nhắc tên từng sản phẩm trong phần trả lời chính và trình bày theo dạng bảng hoặc từng tiêu chí rõ ràng.
- Khi khách cần liên hệ hỗ trợ, chỉ dùng đúng thông tin này:
  Hotline: 0372359999
  Email: kimbaojewelry@gmail.com
  Zalo: Kim Bảo Jewelry
- Không được tự tạo số hotline, email hay kênh liên hệ khác ngoài 3 thông tin trên.

Định dạng câu trả lời cuối cùng ưu tiên là JSON hợp lệ:
{
  "answer": "câu trả lời chính",
  "suggestions": ["gợi ý 1", "gợi ý 2"],
  "quickReplies": ["nút 1", "nút 2", "nút 3"]
}

Nếu không thể trả JSON hợp lệ thì vẫn phải trả lời ngắn gọn, rõ ràng bằng tiếng Việt.`;

const toContentParts = (text) => [{ text: asText(text, 4000) }];

const toGeminiContents = ({ history, message }) => {
  const contents = [];
  for (const item of asArray(history)) {
    const text = asText(item?.content, 4000);
    if (!text) continue;
    contents.push({
      role: item?.role === "assistant" ? "model" : "user",
      parts: toContentParts(text),
    });
  }
  contents.push({ role: "user", parts: toContentParts(message) });
  return contents;
};

const extractResponseText = (response) => {
  const directText = asText(response?.text, 6000);
  if (directText) return directText;

  const candidates = asArray(response?.candidates);
  for (const candidate of candidates) {
    const parts = asArray(candidate?.content?.parts);
    for (const part of parts) {
      const text = asText(part?.text, 6000);
      if (text) return text;
    }
  }
  return "";
};

const stripCodeFences = (text) =>
  String(text || "")
    .replace(/```(?:json)?\s*([\s\S]*?)```/gi, "$1")
    .trim();

const stripTrailingJsonObject = (text) => {
  const raw = String(text || "").trim();
  if (!raw) return "";
  const match = raw.match(/\{[\s\S]*"answer"\s*:[\s\S]*\}\s*$/i);
  if (!match || match.index === undefined) return raw;
  return raw.slice(0, match.index).trim();
};

const extractEmbeddedJsonPayload = (text) => {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const matches = raw.match(/\{[\s\S]*\}/g);
  if (!matches?.length) return null;
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(matches[index]);
      if (parsed && typeof parsed === "object") return parsed;
    } catch (error) {
      void error;
    }
  }
  return null;
};

const sanitizeAssistantText = (text) =>
  stripTrailingJsonObject(stripCodeFences(text))
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const extractFunctionCallState = (response) => {
  const candidates = asArray(response?.candidates);
  for (const candidate of candidates) {
    const content = candidate?.content;
    const parts = asArray(content?.parts);
    const calls = [];
    for (const part of parts) {
      if (part?.functionCall?.name) calls.push(part.functionCall);
    }
    if (calls.length) {
      return {
        functionCalls: calls,
        modelContent: content,
      };
    }
  }

  return {
    functionCalls: asArray(response?.functionCalls),
    modelContent: null,
  };
};

const parseStructuredAnswer = (text) => {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const embedded = extractEmbeddedJsonPayload(raw);
  if (embedded) return embedded;

  const candidate = stripCodeFences(raw);

  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return {
      answer: sanitizeAssistantText(raw),
      suggestions: [],
      quickReplies: [],
    };
  }
};

const normalizeAssistantPayload = (payload) => {
  const answer = asText(sanitizeAssistantText(payload?.answer), 6000);
  return {
    answer: answer || "Mình chưa lấy được câu trả lời cuối cùng từ trợ lý.",
    suggestions: asArray(payload?.suggestions)
      .map((item) => asText(item, 120))
      .filter(Boolean)
      .slice(0, 4),
    quickReplies: asArray(payload?.quickReplies)
      .map((item) => asText(item, 80))
      .filter(Boolean)
      .slice(0, 4),
  };
};

const createGenAiClient = (apiKey) => new GoogleGenAI({ apiKey });

const callGemini = async ({ client, model, contents }) => {
  return client.models.generateContent({
    model: normalizeModelName(model || DEFAULT_MODEL),
    contents,
    config: {
      systemInstruction: buildSystemInstruction(),
      tools: [{ functionDeclarations: FUNCTION_DECLARATIONS }],
      generationConfig: {
        temperature: 0.35,
        topP: 0.9,
        maxOutputTokens: 900,
      },
    },
  });
};

const continueWithToolResponses = ({ contents, modelContent, toolResponses }) => {
  return [
    ...contents,
    ...(modelContent ? [modelContent] : []),
    {
      role: "user",
      parts: toolResponses.map((item) => ({
        functionResponse: {
          name: item.name,
          response: {
            result: item.response,
          },
        },
      })),
    },
  ];
};

const runFunctionCallingChat = async ({ apiKey, model, history, message, executeTool }) => {
  const client = createGenAiClient(apiKey);
  let contents = toGeminiContents({ history, message });
  const toolCalls = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = await callGemini({ client, model, contents });
    const { functionCalls, modelContent } = extractFunctionCallState(response);
    const limitedFunctionCalls = functionCalls.slice(0, MAX_TOOL_CALLS_PER_ROUND);

    if (!limitedFunctionCalls.length) {
      const payload = normalizeAssistantPayload(
        parseStructuredAnswer(extractResponseText(response))
      );
      return { payload, toolCalls };
    }

    const toolResponses = [];
    for (const call of limitedFunctionCalls) {
      const args =
        call && typeof call.args === "object" && call.args
          ? call.args
          : call && typeof call.arguments === "object" && call.arguments
            ? call.arguments
            : {};
      const responsePayload = await executeTool(call.name, args);
      toolCalls.push({ name: call.name, args, response: responsePayload });
      toolResponses.push({ name: call.name, response: responsePayload });
    }

    contents = continueWithToolResponses({ contents, modelContent, toolResponses });
  }

  const finalPayload = {
    answer:
      "Mình đã lấy được dữ liệu từ hệ thống nhưng chưa thể tổng hợp câu trả lời cuối cùng. Bạn thử hỏi lại một lần nữa giúp mình nhé.",
    suggestions: [],
    quickReplies: ["Tư vấn sản phẩm", "Tra cứu đơn hàng", "Hướng dẫn thanh toán"],
  };
  return { payload: finalPayload, toolCalls };
};

module.exports = {
  FUNCTION_DECLARATIONS,
  runFunctionCallingChat,
};
