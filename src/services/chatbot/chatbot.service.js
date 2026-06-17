const { normalizeContext, isGlobalChatScope } = require("./context.service");
const {
  detectIntent,
  parseProductRequest,
  parseVariantInquiry,
  hasSearchState,
  isLikelySearchFollowUp,
  mergeSearchRequests,
  buildPolicyHints,
} = require("./intent.service");
const { lookupOrderForChat } = require("./order.service");
const {
  resolveConversationProduct,
  resolveVariantStock,
  resolveCatalogForIntent,
  buildComparison,
  findRecommendations,
  resolveComparisonReadiness,
} = require("./product.service");
const { resolveAssistantResult, resolveDefaultQuickReplies } = require("./llm.service");
const {
  clampHistory,
  createHttpError,
  DEFAULT_MODEL,
  INTENT,
  MAX_MESSAGE_LENGTH,
  MAX_RECOMMENDATIONS,
  TOOL,
  normalizeModelName,
} = require("./shared");

const resolveSearchRequestFromHistory = ({ message, history, context }) => {
  const currentRequest = parseProductRequest(message, context);
  const currentIntent = detectIntent({ message, context, isGlobalChatScope });

  let previousRequest = null;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index];
    if (item?.role !== "user") continue;
    const previousMessage = String(item?.content || "").trim();
    if (!previousMessage) continue;
    const previousIntent = detectIntent({ message: previousMessage, context, isGlobalChatScope });
    if (![INTENT.SEARCH, INTENT.BESTSELLER, INTENT.ADVICE].includes(previousIntent)) continue;
    const parsed = parseProductRequest(previousMessage, context);
    if (!hasSearchState(parsed)) continue;
    previousRequest = parsed;
    break;
  }

  const shouldFollowUp =
    Boolean(previousRequest) &&
    [INTENT.SEARCH, INTENT.GENERAL].includes(currentIntent) &&
    isLikelySearchFollowUp(message, currentRequest) &&
    !currentRequest.categoryRootSlugs.length;

  if (!shouldFollowUp) {
    return {
      request: currentRequest,
      intent: currentIntent,
      continued: false,
    };
  }

  return {
    request: mergeSearchRequests(previousRequest, currentRequest, {
      usePreviousSearchTerms: !currentRequest.categoryRootSlugs.length,
    }),
    intent: INTENT.SEARCH,
    continued: true,
  };
};

const processChatbotMessage = async (body) => {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
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
  context.__messageRaw = message;
  const resolvedSearch = resolveSearchRequestFromHistory({ message, history, context });
  context.__searchRequest = resolvedSearch.request;
  context.__resolvedProduct = await resolveConversationProduct({ message, history, context });
  context.__variantInquiry = parseVariantInquiry(message);
  context.__variantStock = resolveVariantStock({
    product: context.__resolvedProduct,
    inquiry: context.__variantInquiry,
  });
  context.__resolvedOrder = await lookupOrderForChat({ message, context });

  const intent = resolvedSearch.intent;
  const { tool: catalogTool, catalog } = await resolveCatalogForIntent({
    intent,
    message,
    context,
  });
  const comparison =
    intent === INTENT.COMPARE
      ? await buildComparison({ message, context, catalog })
      : { names: [], products: [] };
  resolveComparisonReadiness({ comparison, context });
  const policyHints = buildPolicyHints(message);
  const recommendedProducts = await findRecommendations({
    intent,
    message,
    context,
    catalog,
    comparison,
  });
  const { result, sourceMeta } = await resolveAssistantResult({
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

  if (!result.quickReplies.length) result.quickReplies = resolveDefaultQuickReplies(intent);

  return {
    answer: result.answer,
    suggestions: result.suggestions,
    quickReplies: result.quickReplies,
    recommendedProducts: recommendedProducts.slice(0, MAX_RECOMMENDATIONS),
    intent,
    sourceMeta: {
      catalogTool,
      orderTool: context.__resolvedOrder ? TOOL.ORDER_LOOKUP : null,
      policyTool: policyHints.length ? TOOL.POLICY_HINTS : null,
      recommendationTool: TOOL.RECOMMENDATIONS,
      followUpSearch: resolvedSearch.continued,
      ...sourceMeta,
    },
  };
};

module.exports = {
  processChatbotMessage,
};
