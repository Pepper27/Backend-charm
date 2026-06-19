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
  DETAIL: "product_detail",
  STOCK: "variant_stock_check",
  ADVICE: "product_advice",
  SIZE: "size_consult",
  DESIGN: "charm_design_help",
  ORDER: "order_support",
  PAYMENT: "payment_support",
  POLICY: "policy_faq",
  GENERAL: "general_support",
};

const TOOL = {
  CATALOG_SEARCH: "catalog_search",
  CHARM_SEARCH: "charm_search",
  PRODUCT_LOOKUP: "product_lookup",
  VARIANT_STOCK: "variant_stock",
  ORDER_LOOKUP: "order_lookup",
  POLICY_HINTS: "policy_hints",
  RECOMMENDATIONS: "recommendations",
  GEMINI_RESPONSE: "gemini_response",
  DETERMINISTIC_RESPONSE: "deterministic_response",
};

const ORDER_CODE_PATTERN = /\b(ORD[A-Z0-9]{8,})\b/i;

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

const uniqueBy = (items, keyFn) => {
  const map = new Map();
  for (const item of items || []) {
    const key = keyFn(item);
    if (!key || map.has(key)) continue;
    map.set(key, item);
  }
  return Array.from(map.values());
};

const clampHistory = (history) =>
  asArray(history)
    .slice(-MAX_HISTORY_ITEMS)
    .map((item) => ({
      role: item?.role === "assistant" ? "assistant" : "user",
      content: asText(item?.content, 1200),
    }))
    .filter((item) => item.content);

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

const createHttpError = (message, status = 500, code = "chatbot_failed") => {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
};

module.exports = {
  GEMINI_API_BASE,
  DEFAULT_MODEL,
  DEFAULT_FALLBACK_MODELS,
  MAX_MESSAGE_LENGTH,
  MAX_HISTORY_ITEMS,
  MAX_RECOMMENDATIONS,
  MAX_SEARCH_RESULTS,
  INTENT,
  TOOL,
  asText,
  asArray,
  slugifyLite,
  escapeRegex,
  uniqueBy,
  clampHistory,
  normalizeModelName,
  extractPriceNumber,
  extractMeasurementCm,
  formatPrice,
  extractOrderCode,
  extractEmail,
  extractPhone,
  createHttpError,
};
