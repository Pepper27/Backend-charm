const axios = require('axios');
const Product = require('../../models/product.model');
const ChatInquiry = require('../../models/chatInquiry.model');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const OPENAI_URL = process.env.OPENAI_API_URL || 'https://api.openai.com/v1/chat/completions';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1';
const GEMINI_URL_BASE = 'https://generativelanguage.googleapis.com/v1beta2/models';

const functionDefs = [
  {
    name: 'getProductInfo',
    description: 'Return product information by id or slug',
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'string' },
        slug: { type: 'string' }
      }
    }
  },
  {
    name: 'createInquiry',
    description: 'Create an inquiry/contact request from user',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        message: { type: 'string' }
      },
      required: ['name','message']
    }
  }
];

function joinMessagesToPrompt(messages) {
  return messages
    .map((m) => {
      const role = m.role || 'user';
      const content = m.content || '';
      return `${role.toUpperCase()}: ${content}`;
    })
    .join('\n');
}

async function callModel(messages) {
  // Prefer Gemini if configured
  if (GEMINI_API_KEY) {
    const prompt = joinMessagesToPrompt(messages) +
      "\n\nIf you need to call a function, reply ONLY with a single JSON object like {\"function_call\":{\"name\":\"FUNCTION_NAME\",\"arguments\":{...}}}. Otherwise reply with assistant text only.";

    const url = `${GEMINI_URL_BASE}/${GEMINI_MODEL}:generate?key=${encodeURIComponent(GEMINI_API_KEY)}`;
    const body = {
      prompt: { text: prompt },
      maxOutputTokens: 512,
      temperature: 0.2
    };

    const resp = await axios.post(url, body, { timeout: 20000 });
    const data = resp.data || {};

    // Extract text from possible response shapes
    let text = '';
    if (data.candidates && data.candidates[0]) {
      // v1beta2 often returns candidates[].output or candidates[].content
      const cand = data.candidates[0];
      if (typeof cand.output === 'string') text = cand.output;
      else if (cand.content && cand.content[0] && cand.content[0].text) text = cand.content[0].text;
      else if (cand.content && cand.content[0] && cand.content[0].type === 'output_text' && cand.content[0].text) text = cand.content[0].text;
    }
    if (!text && data.output && Array.isArray(data.output) && data.output[0]) {
      const o = data.output[0];
      if (o.content && o.content[0] && o.content[0].text) text = o.content[0].text;
      else if (o.text) text = o.text;
    }

    // Try parse JSON function_call if present
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      // try to extract JSON substring
      const m = text && text.match(/(\{[\s\S]*\})/);
      if (m) {
        try { parsed = JSON.parse(m[1]); } catch (e2) { parsed = null; }
      }
    }

    if (parsed && parsed.function_call) {
      return { choices: [{ message: { function_call: parsed.function_call } }] };
    }

    // otherwise return assistant-style message
    return { choices: [{ message: { content: text } }] };
  }

  // Fallback to OpenAI-compatible call
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');

  const resp = await axios.post(
    OPENAI_URL,
    {
      model: OPENAI_MODEL,
      messages,
      functions: functionDefs,
      function_call: 'auto'
    },
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 20000
    }
  );
  return resp.data;
}

async function execFunction(name, args = {}) {
  try {
    if (name === 'getProductInfo') {
      const { productId, slug } = args;
      let product = null;
      if (productId) product = await Product.findById(productId).lean();
      if (!product && slug) product = await Product.findOne({ slug }).lean();
      if (!product) return { found: false };
      // keep small payload
      return {
        found: true,
        id: product._id,
        name: product.name,
        slug: product.slug,
        priceMin: product.priceMin,
        priceMax: product.priceMax,
        variantsCount: Array.isArray(product.variants) ? product.variants.length : 0,
      };
    }

    if (name === 'createInquiry') {
      const { name, email, phone, message } = args;
      const doc = await ChatInquiry.create({ name, email, phone, message, metadata: { via: 'chatbot' } });
      return { created: true, id: doc._id };
    }

    return { error: 'unknown_function' };
  } catch (err) {
    return { error: err.message || String(err) };
  }
}

async function handleChat(userMessages = [], opts = {}) {
  // userMessages: array of messages in {role: 'user'|'assistant'|'system', content: '...'}
  const systemMsg = {
    role: 'system',
    content: 'You are a helpful product assistant. Use function calling to fetch product info or create inquiries.'
  };

  const messages = [systemMsg, ...userMessages];

  if (!GEMINI_API_KEY && !OPENAI_API_KEY) {
    // Fallback: simple rule based responder
    const last = userMessages[userMessages.length - 1];
    const text = (last && last.content) || '';
    if (/product|info|price|giá|sản phẩm/i.test(text)) {
      return { reply: 'Vui lòng cho biết mã/số hiệu hoặc đường dẫn sản phẩm để tôi tra giúp.' };
    }
    return { reply: "Xin chào — tôi có thể giúp gì cho bạn?" };
  }

  // 1) Ask model
  const firstResp = await callModel(messages);
  const choice = firstResp.choices && firstResp.choices[0];
  const msg = choice && choice.message;

  // If model requested a function call, execute and then send result back
  if (msg && msg.function_call) {
    const fname = msg.function_call.name;
    let fargs = {};
    try {
      fargs = msg.function_call.arguments ? JSON.parse(msg.function_call.arguments) : {};
    } catch (e) {
      // ignore parse errors
      fargs = {};
    }

    const funcResult = await execFunction(fname, fargs);

    // send the function result back to the model to produce a final assistant response
    const followupMessages = [...messages,
      { role: 'assistant', content: null, name: fname, function_call: msg.function_call },
      { role: 'function', name: fname, content: JSON.stringify(funcResult) }
    ];

    const finalResp = await callOpenAI(followupMessages);
    const finalChoice = finalResp.choices && finalResp.choices[0];
    const finalMsg = finalChoice && finalChoice.message && (finalChoice.message.content || finalChoice.message);
    return { reply: finalMsg, function: { name: fname, args: fargs, result: funcResult } };
  }

  // No function call — return assistant content
  const assistantText = (msg && msg.content) || (choice && choice.text) || '';
  return { reply: assistantText };
}

module.exports = { handleChat, functionDefs };
