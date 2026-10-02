import axios from "axios";

const PAYMONGO_API_BASE = "https://api.paymongo.com/v1";
const DEFAULT_PAYMENT_METHOD_TYPES = ["gcash", "paymaya", "card"];
const ALLOWED_PAYMENT_METHOD_TYPES = new Set(DEFAULT_PAYMENT_METHOD_TYPES);
const NETWORK_ERROR_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "EPIPE",
]);

const normalizeText = (value) => String(value || "").trim();

const isNetworkError = (error) =>
  NETWORK_ERROR_CODES.has(String(error?.code || error?.errno || "").toUpperCase());

const getUserFriendlyMessage = (error, fallbackMessage) => {
  if (isNetworkError(error)) {
    return "Payment service is temporarily unavailable. Please try again later.";
  }

  const status = error?.response?.status;
  if (status >= 500) {
    return "Payment service is temporarily unavailable. Please try again later.";
  }

  if (status >= 400) {
    return "We could not start the payment. Please review the details and try again.";
  }

  return fallbackMessage || "We could not complete the payment request. Please try again.";
};

const toPayMongoError = (error, fallbackMessage) => {
  const message =
    error?.response?.data?.errors?.[0]?.detail ||
    error?.response?.data?.errors?.[0]?.title ||
    error?.response?.data?.message ||
    error?.message ||
    fallbackMessage;
  const wrapped = new Error(message);
  wrapped.isPayMongoError = true;
  wrapped.statusCode = error?.response?.status || (isNetworkError(error) ? 503 : 500);
  wrapped.code = error?.code || error?.errno || null;
  wrapped.userMessage = getUserFriendlyMessage(error, fallbackMessage);
  return wrapped;
};

const getSecretKey = () => {
  const secretKey = normalizeText(process.env.PAYMONGO_SECRET_KEY);
  if (!secretKey) {
    const error = new Error("PayMongo is not configured. Missing PAYMONGO_SECRET_KEY.");
    error.isPayMongoError = true;
    error.statusCode = 500;
    throw error;
  }
  return secretKey;
};

const getPaymentMethodTypes = () => {
  const raw = normalizeText(process.env.PAYMONGO_PAYMENT_METHODS);
  if (!raw) return DEFAULT_PAYMENT_METHOD_TYPES;
  const parsed = raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => DEFAULT_PAYMENT_METHOD_TYPES.includes(item));
  return parsed.length ? parsed : DEFAULT_PAYMENT_METHOD_TYPES;
};

const sanitizePaymentMethodTypes = (paymentMethodTypes) => {
  if (!Array.isArray(paymentMethodTypes) || paymentMethodTypes.length === 0) {
    return getPaymentMethodTypes();
  }

  const normalized = [
    ...new Set(
      paymentMethodTypes
        .map((item) => String(item || "").trim().toLowerCase())
        .filter((item) => ALLOWED_PAYMENT_METHOD_TYPES.has(item))
    ),
  ];
  return normalized.length ? normalized : getPaymentMethodTypes();
};

const getAuthHeaders = () => {
  const token = Buffer.from(`${getSecretKey()}:`).toString("base64");
  return {
    Authorization: `Basic ${token}`,
    "Content-Type": "application/json",
  };
};

const unwrap = (value) => value?.data || value;
const attributesOf = (value) => unwrap(value)?.attributes || unwrap(value) || {};
const statusOf = (value) => normalizeText(attributesOf(value).status).toLowerCase();
const paymentResources = (session) => {
  const intent = unwrap(session?.attributes?.payment_intent);
  const sources = [session?.attributes?.payments, attributesOf(intent).payments];
  const payments = sources.flatMap((source) => {
    const value = unwrap(source);
    return Array.isArray(value) ? value : [];
  });
  const ids = new Set(payments.map((payment) => payment.id).filter(Boolean));
  return payments.map((payment) => (session.included || []).find(
    (item) => item.type === "payment" && ids.has(item.id) && item.id === payment.id
  ) || payment);
};
const paymentIntentResource = (session) => {
  const intent = unwrap(session?.attributes?.payment_intent);
  const id = typeof intent === "string" ? intent : intent?.id;
  return (session?.included || []).find((item) => item.type === "payment_intent" && id && item.id === id) || intent;
};

export const getPayMongoCheckoutId = (checkoutSession) =>
  normalizeText(checkoutSession?.id || checkoutSession?.data?.id || "");

export const getPayMongoCheckoutUrl = (checkoutSession) =>
  normalizeText(checkoutSession?.attributes?.checkout_url || "");

export const getPayMongoCheckoutReferenceNumber = (checkoutSession) =>
  normalizeText(checkoutSession?.attributes?.reference_number || "");

export const getPayMongoPaymentIntentId = (checkoutSession) => {
  const paymentIntent = checkoutSession?.attributes?.payment_intent;
  if (!paymentIntent) return "";
  if (typeof paymentIntent === "string") return normalizeText(paymentIntent);
  return normalizeText(paymentIntent.id || paymentIntent?.data?.id || "");
};

export const getPayMongoCheckoutMetadata = (checkoutSession) => {
  const metadata = checkoutSession?.attributes?.metadata;
  if (!metadata || typeof metadata !== "object") return {};
  return metadata;
};

export const getPayMongoCheckoutAmountInCentavos = (checkoutSession) => {
  const rawLineItems = checkoutSession?.attributes?.line_items;
  const lineItems = Array.isArray(rawLineItems)
    ? rawLineItems
    : Array.isArray(rawLineItems?.data)
      ? rawLineItems.data
      : [];

  return lineItems.reduce((sum, item) => {
    const attributes = item?.attributes || {};
    const amount = Number(item?.amount ?? attributes.amount ?? 0);
    const quantity = Number(item?.quantity ?? attributes.quantity ?? 1);
    if (!Number.isFinite(amount) || !Number.isFinite(quantity) || amount < 0 || quantity < 0) {
      return sum;
    }
    return sum + Math.round(amount * quantity);
  }, 0);
};

export const isPayMongoCheckoutPaid = (session) =>
  statusOf(paymentIntentResource(session)) === "succeeded" ||
  paymentResources(session).some((payment) => statusOf(payment) === "paid");

export const isPayMongoCheckoutProcessing = (session) =>
  ["processing", "authorized", "awaiting_capture", "awaiting_next_action"].includes(statusOf(paymentIntentResource(session)));

export const getPayMongoCapturedAmountInCentavos = (session) => {
  const paid = paymentResources(session).filter((payment) => statusOf(payment) === "paid");
  const resources = paid.length ? paid : statusOf(paymentIntentResource(session)) === "succeeded"
    ? [paymentIntentResource(session)] : [];
  const unique = [...new Map(resources.map((item, i) => [item.id || i, item])).values()];
  if (!unique.length) return 0;
  let total = 0;
  for (const item of unique) {
    const { amount, currency } = attributesOf(item);
    if (currency !== "PHP" || !Number.isSafeInteger(amount) || amount <= 0) return 0;
    total += amount;
  }
  return total;
};

export const createPayMongoCheckoutSession = async ({
  amountInCentavos,
  itemName,
  description,
  referenceNumber,
  successUrl,
  cancelUrl,
  metadata = {},
  billing,
  paymentMethodTypes = [],
  idempotencyKey,
}) => {
  try {
    if (!Number.isInteger(amountInCentavos) || amountInCentavos <= 0) {
      const error = new Error("Invalid payment amount for PayMongo checkout.");
      error.isPayMongoError = true;
      error.statusCode = 400;
      throw error;
    }

    const allowedPaymentMethodTypes = sanitizePaymentMethodTypes(paymentMethodTypes);

    const payload = {
      data: {
        attributes: {
          payment_method_types: allowedPaymentMethodTypes,
          line_items: [
            {
              currency: "PHP",
              amount: amountInCentavos,
              name: normalizeText(itemName) || "Vehicle Booking",
              quantity: 1,
              description: normalizeText(description) || "Vehicle booking payment",
            },
          ],
          description: normalizeText(description) || "Vehicle booking payment",
          reference_number: normalizeText(referenceNumber),
          success_url: normalizeText(successUrl),
          cancel_url: normalizeText(cancelUrl),
          show_description: true,
          show_line_items: true,
          billing: billing && typeof billing === "object" ? billing : undefined,
          metadata: Object.fromEntries(Object.entries(metadata).map(([key, value]) => [key, String(value)])),
        },
      },
    };

    if (payload.data.attributes.billing) {
      const sanitized = Object.entries(payload.data.attributes.billing).reduce((acc, [key, value]) => {
        const normalized = normalizeText(value);
        if (normalized) acc[key] = normalized;
        return acc;
      }, {});
      if (Object.keys(sanitized).length) {
        payload.data.attributes.billing = sanitized;
      } else {
        delete payload.data.attributes.billing;
      }
    }

    const response = await axios.post(`${PAYMONGO_API_BASE}/checkout_sessions`, payload, {
      headers: { ...getAuthHeaders(), ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
      timeout: 15000,
    });
    const checkoutSession = response?.data?.data;
    if (!checkoutSession?.id) {
      throw toPayMongoError(
        { message: "PayMongo did not return a valid checkout session." },
        "Failed to create PayMongo checkout session."
      );
    }
    return checkoutSession;
  } catch (error) {
    if (error?.isPayMongoError) throw error;
    throw toPayMongoError(error, "Failed to create PayMongo checkout session.");
  }
};

export const expirePayMongoCheckoutSession = async (checkoutId) => {
  try {
    const response = await axios.post(
      `${PAYMONGO_API_BASE}/checkout_sessions/${encodeURIComponent(checkoutId)}/expire`, {},
      { headers: { ...getAuthHeaders(), "Idempotency-Key": `expire-${checkoutId}` }, timeout: 15000 }
    );
    return response?.data?.data;
  } catch (error) {
    throw toPayMongoError(error, "Could not close the previous payment checkout.");
  }
};

export const getPayMongoCheckoutSession = async (checkoutId) => {
  try {
    const normalizedCheckoutId = normalizeText(checkoutId);
    if (!normalizedCheckoutId) {
      const error = new Error("Missing PayMongo checkout session ID.");
      error.isPayMongoError = true;
      error.statusCode = 400;
      throw error;
    }

    const response = await axios.get(
      `${PAYMONGO_API_BASE}/checkout_sessions/${encodeURIComponent(normalizedCheckoutId)}`,
      {
        headers: getAuthHeaders(),
        timeout: 15000,
      }
    );
    const checkoutSession = response?.data?.data;
    if (!checkoutSession?.id) {
      throw toPayMongoError(
        { message: "PayMongo checkout session lookup returned an invalid payload." },
        "Failed to retrieve PayMongo checkout session."
      );
    }
    const included = Array.isArray(response?.data?.included) ? response.data.included : [];
    if (included.length) {
      checkoutSession.included = included;
    }
    return checkoutSession;
  } catch (error) {
    if (error?.isPayMongoError) throw error;
    throw toPayMongoError(error, "Failed to retrieve PayMongo checkout session.");
  }
};
