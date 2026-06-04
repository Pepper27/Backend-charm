const crypto = require("crypto");

const zalopayConfig = () => {
  return {
    appId: String(process.env.ZALOPAY_ID || "").trim(),
    key1: String(process.env.ZALOPAYKEY1 || "").trim(),
    key2: String(process.env.ZALOPAYKEY2 || "").trim(),
    domain: String(process.env.ZALOPAYDOMAIN || "https://sb-openapi.zalopay.vn").trim(),
  };
};

// Minimal ZaloPay refund adapter. Behaviour:
// - If required credentials missing, throws an error so caller can mark manual_review.
// - Attempts to call /v2/refund and returns normalized result.
// Note: MAC calculation and exact params follow the repo's existing patterns (may require
// slight adjustments if the payment provider expects a different MAC ordering).
module.exports.zalopayRefund = async ({
  appTransId,
  amount,
  description = "Refund",
  idempotencyKey = "",
}) => {
  const cfg = zalopayConfig();
  if (!cfg.appId || !cfg.key1) {
    const e = new Error("ZaloPay credentials (ZALOPAY_ID/ZALOPAYKEY1) not configured");
    e.transient = false;
    throw e;
  }

  // Build mac similar to other places in repo. If ZaloPay expects a different format
  // you can adjust this to match their doc.
  const macData = [
    cfg.appId,
    String(appTransId || ""),
    String(Math.round(Number(amount) || 0)),
    cfg.key1,
  ].join("|");
  const mac = crypto.createHmac("sha256", cfg.key1).update(macData).digest("hex");

  const params = new URLSearchParams();
  params.set("app_id", String(cfg.appId));
  params.set("app_trans_id", String(appTransId || ""));
  params.set("amount", String(Math.round(Number(amount) || 0)));
  params.set("description", String(description || "Refund"));
  if (idempotencyKey) params.set("idempotency_key", String(idempotencyKey));
  params.set("mac", mac);

  const url = `${cfg.domain.replace(/\/$/, "")}/v2/refund`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const data = await resp.json().catch(() => null);

  // Normalize response
  const normalized = { raw: data || null, httpStatus: resp.status };
  if (!resp.ok) {
    normalized.status = "failed";
    normalized.message = (data && (data.return_message || data.message)) || `HTTP ${resp.status}`;
    return normalized;
  }

  // ZaloPay returns return_code === 1 for success in other endpoints used in this repo.
  if (data && (data.return_code === 1 || data.return_code === 200)) {
    normalized.status = "succeeded";
    // provider refund id may be present under data.refund_id or data.zp_refund_id etc.
    normalized.providerRefundId =
      data.refund_id || data.zp_refund_id || data.refund_trans_id || data.refundTransId || null;
    normalized.message = data.return_message || data.sub_return_message || "OK";
    return normalized;
  }

  // Not a success - treat as failed (caller may decide manual_review)
  normalized.status = "failed";
  normalized.message =
    data?.sub_return_message || data?.return_message || JSON.stringify(data || {});
  return normalized;
};
