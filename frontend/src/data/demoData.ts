import { addMoney } from "@/lib/format";
import type {
  AiAnalysis,
  AuditActorType,
  AuditEntry,
  AuditEventType,
  CurrencyCode,
  Customer,
  DashboardMetrics,
  Order,
  PolicyCheck,
  PolicyEvaluation,
  RefundRecord,
  RefundStepStatus,
  RefundTimelineStep,
  ReturnPolicy,
  ReturnRequest,
  ReturnStatus,
} from "@/types";

/**
 * DEMO DATA ONLY.
 * Every customer, order and return below is fictional. No PayPal request has
 * been made, and no transaction or refund ID in this app is real
 * (paypalCaptureId / paypalRefundId are intentionally null).
 *
 * "Now" is pinned so relative dates and return-window math stay stable.
 */
export const DEMO_NOW_ISO = "2026-10-12T09:00:00Z";

export const DEMO_NOTICE =
  "Demo data: fictional customers and orders. No PayPal request has been made and no transaction IDs are real.";

const DEMO_CURRENCY: CurrencyCode = "USD";

/* ---------- Policy ---------- */

export const demoPolicy: ReturnPolicy = {
  returnWindowDays: 30,
  requirePaymentCaptured: true,
  allowPartialRefunds: true,
  manualReviewThreshold: "150.00",
  currency: DEMO_CURRENCY,
  restockingFeePercent: 0,
};

/* ---------- Customers ---------- */

const customers: Record<string, Customer> = {
  aarav: { id: "cus_01", name: "Aarav Mehta", email: "aarav.mehta@example.com" },
  sofia: { id: "cus_02", name: "Sofia Alvarez", email: "sofia.alvarez@example.com" },
  liam: { id: "cus_03", name: "Liam O'Connor", email: "liam.oconnor@example.com" },
  priya: { id: "cus_04", name: "Priya Nair", email: "priya.nair@example.com" },
  noah: { id: "cus_05", name: "Noah Becker", email: "noah.becker@example.com" },
  hana: { id: "cus_06", name: "Hana Kimura", email: "hana.kimura@example.com" },
  mateo: { id: "cus_07", name: "Mateo Silva", email: "mateo.silva@example.com" },
  emma: { id: "cus_08", name: "Emma Fischer", email: "emma.fischer@example.com" },
};

/* ---------- Orders ---------- */

export const demoOrders: Order[] = [
  {
    id: "ord_2001",
    orderNumber: "RW-2001",
    customer: customers.aarav,
    items: [
      { id: "itm_2001_1", sku: "EARBUDS-PRO", name: "Wireless Earbuds Pro", quantity: 1, unitPrice: "79.99", returnable: true },
      { id: "itm_2001_2", sku: "CABLE-USBC", name: "USB-C Charging Cable", quantity: 2, unitPrice: "12.50", returnable: true },
    ],
    currency: DEMO_CURRENCY,
    total: "104.99",
    refundedAmount: "0.00",
    paymentStatus: "captured",
    paypalCaptureId: null,
    placedAt: "2026-09-28T10:14:00Z",
    deliveredAt: "2026-10-02T15:30:00Z",
  },
  {
    id: "ord_2002",
    orderNumber: "RW-2002",
    customer: customers.sofia,
    items: [
      { id: "itm_2002_1", sku: "BLANKET-LINEN", name: "Linen Throw Blanket", quantity: 1, unitPrice: "64.00", returnable: true },
      { id: "itm_2002_2", sku: "MUG-SET-4", name: "Ceramic Mug Set (4 pcs)", quantity: 1, unitPrice: "38.50", returnable: true },
    ],
    currency: DEMO_CURRENCY,
    total: "102.50",
    refundedAmount: "0.00",
    paymentStatus: "captured",
    paypalCaptureId: null,
    placedAt: "2026-09-25T08:40:00Z",
    deliveredAt: "2026-09-30T12:05:00Z",
  },
  {
    id: "ord_2003",
    orderNumber: "RW-2003",
    customer: customers.liam,
    items: [
      { id: "itm_2003_1", sku: "SHOE-TRAIL-42", name: "Trail Running Shoes", quantity: 1, unitPrice: "129.00", returnable: true },
    ],
    currency: DEMO_CURRENCY,
    total: "129.00",
    refundedAmount: "0.00",
    paymentStatus: "captured",
    paypalCaptureId: null,
    placedAt: "2026-08-14T17:22:00Z",
    deliveredAt: "2026-08-20T11:00:00Z",
  },
  {
    id: "ord_2004",
    orderNumber: "RW-2004",
    customer: customers.priya,
    items: [
      { id: "itm_2004_1", sku: "YOGA-MAT", name: "Yoga Mat", quantity: 1, unitPrice: "45.00", returnable: true },
      { id: "itm_2004_2", sku: "BANDS-SET", name: "Resistance Bands Set", quantity: 1, unitPrice: "18.00", returnable: true },
    ],
    currency: DEMO_CURRENCY,
    total: "63.00",
    refundedAmount: "45.00",
    paymentStatus: "partially_refunded",
    paypalCaptureId: null,
    placedAt: "2026-09-10T09:05:00Z",
    deliveredAt: "2026-09-15T14:45:00Z",
  },
  {
    id: "ord_2005",
    orderNumber: "RW-2005",
    customer: customers.noah,
    items: [
      { id: "itm_2005_1", sku: "WATCH-ENGRAVED", name: "Custom Engraved Watch", quantity: 1, unitPrice: "210.00", returnable: false },
      { id: "itm_2005_2", sku: "STRAP-LEATHER", name: "Leather Watch Strap", quantity: 1, unitPrice: "25.00", returnable: true },
    ],
    currency: DEMO_CURRENCY,
    total: "235.00",
    refundedAmount: "0.00",
    paymentStatus: "captured",
    paypalCaptureId: null,
    placedAt: "2026-09-29T13:50:00Z",
    deliveredAt: "2026-10-05T10:20:00Z",
  },
  {
    id: "ord_2006",
    orderNumber: "RW-2006",
    customer: customers.hana,
    items: [
      { id: "itm_2006_1", sku: "KB-MECH-ANSI", name: "Mechanical Keyboard (ANSI)", quantity: 1, unitPrice: "149.00", returnable: true },
      { id: "itm_2006_2", sku: "KEYCAP-SET", name: "PBT Keycap Set", quantity: 1, unitPrice: "35.00", returnable: true },
    ],
    currency: DEMO_CURRENCY,
    total: "184.00",
    refundedAmount: "0.00",
    paymentStatus: "captured",
    paypalCaptureId: null,
    placedAt: "2026-10-03T07:30:00Z",
    deliveredAt: "2026-10-08T16:10:00Z",
  },
  {
    id: "ord_2007",
    orderNumber: "RW-2007",
    customer: customers.mateo,
    items: [
      { id: "itm_2007_1", sku: "LAMP-DESK", name: "LED Desk Lamp", quantity: 1, unitPrice: "55.00", returnable: true },
    ],
    currency: DEMO_CURRENCY,
    total: "55.00",
    refundedAmount: "0.00",
    paymentStatus: "pending",
    paypalCaptureId: null,
    placedAt: "2026-10-11T18:05:00Z",
    deliveredAt: null,
  },
  {
    id: "ord_2008",
    orderNumber: "RW-2008",
    customer: customers.emma,
    items: [
      { id: "itm_2008_1", sku: "BACKPACK-24L", name: "Everyday Backpack 24L", quantity: 1, unitPrice: "89.00", returnable: true },
    ],
    currency: DEMO_CURRENCY,
    total: "89.00",
    refundedAmount: "0.00",
    paymentStatus: "captured",
    paypalCaptureId: null,
    placedAt: "2026-09-27T11:11:00Z",
    deliveredAt: "2026-10-01T09:40:00Z",
  },
];

/* ---------- Return requests ---------- */

export const demoReturns: ReturnRequest[] = [
  {
    id: "ret_1001",
    reference: "RET-1001",
    orderId: "ord_2001",
    customer: customers.aarav,
    status: "submitted",
    items: [{ orderItemId: "itm_2001_1", quantity: 1 }],
    customerComment: "Left earbud stopped charging after 3 days. The case LED blinks red.",
    requestedAmount: "79.99",
    currency: DEMO_CURRENCY,
    submittedAt: "2026-10-11T08:20:00Z",
    updatedAt: "2026-10-11T08:20:00Z",
    decisionNote: null,
  },
  {
    id: "ret_1002",
    reference: "RET-1002",
    orderId: "ord_2002",
    customer: customers.sofia,
    status: "under_review",
    items: [{ orderItemId: "itm_2002_2", quantity: 1 }],
    customerComment: "Two of the four mugs arrived cracked. I would like a refund for the whole set.",
    requestedAmount: "38.50",
    currency: DEMO_CURRENCY,
    submittedAt: "2026-10-09T14:10:00Z",
    updatedAt: "2026-10-10T09:00:00Z",
    decisionNote: null,
  },
  {
    id: "ret_1003",
    reference: "RET-1003",
    orderId: "ord_2003",
    customer: customers.liam,
    status: "submitted",
    items: [{ orderItemId: "itm_2003_1", quantity: 1 }],
    customerComment: "They fit fine but I just don't like the color.",
    requestedAmount: "129.00",
    currency: DEMO_CURRENCY,
    submittedAt: "2026-10-10T19:45:00Z",
    updatedAt: "2026-10-10T19:45:00Z",
    decisionNote: null,
  },
  {
    id: "ret_1004",
    reference: "RET-1004",
    orderId: "ord_2004",
    customer: customers.priya,
    status: "refunded",
    items: [{ orderItemId: "itm_2004_1", quantity: 1 }],
    customerComment: "The mat is much thinner than the listing described.",
    requestedAmount: "45.00",
    currency: DEMO_CURRENCY,
    submittedAt: "2026-10-01T10:00:00Z",
    updatedAt: "2026-10-05T13:30:00Z",
    decisionNote: "Approved: listing thickness was unclear.",
  },
  {
    id: "ret_1005",
    reference: "RET-1005",
    orderId: "ord_2005",
    customer: customers.noah,
    status: "rejected",
    items: [{ orderItemId: "itm_2005_1", quantity: 1 }],
    customerComment: "I changed my mind about the gift.",
    requestedAmount: "210.00",
    currency: DEMO_CURRENCY,
    submittedAt: "2026-10-07T12:00:00Z",
    updatedAt: "2026-10-07T16:20:00Z",
    decisionNote: "Custom engraved items are final sale under the store policy.",
  },
  {
    id: "ret_1006",
    reference: "RET-1006",
    orderId: "ord_2006",
    customer: customers.hana,
    status: "refund_pending",
    items: [{ orderItemId: "itm_2006_1", quantity: 1 }],
    customerComment: "I received the ISO layout keyboard but I ordered ANSI.",
    requestedAmount: "149.00",
    currency: DEMO_CURRENCY,
    submittedAt: "2026-10-09T09:15:00Z",
    updatedAt: "2026-10-10T11:00:00Z",
    decisionNote: "Approved: wrong layout was shipped.",
  },
  {
    id: "ret_1007",
    reference: "RET-1007",
    orderId: "ord_2008",
    customer: customers.emma,
    status: "refund_failed",
    items: [{ orderItemId: "itm_2008_1", quantity: 1 }],
    customerComment: "The zipper broke the first time I used the backpack.",
    requestedAmount: "89.00",
    currency: DEMO_CURRENCY,
    submittedAt: "2026-10-06T15:30:00Z",
    updatedAt: "2026-10-08T10:15:00Z",
    decisionNote: "Approved: probable manufacturing defect.",
  },
  {
    id: "ret_1008",
    reference: "RET-1008",
    orderId: "ord_2001",
    customer: customers.aarav,
    status: "approved",
    items: [{ orderItemId: "itm_2001_2", quantity: 1 }],
    customerComment: "The cable is too short for my desk setup.",
    requestedAmount: "12.50",
    currency: DEMO_CURRENCY,
    submittedAt: "2026-10-10T07:50:00Z",
    updatedAt: "2026-10-11T12:00:00Z",
    decisionNote: "Approved: low-value item within policy.",
  },
];

/* ---------- Policy evaluations (hand-written, demo only) ---------- */

const windowCheck = (passed: boolean, detail: string): PolicyCheck => ({
  code: passed ? "WITHIN_RETURN_WINDOW" : "RETURN_WINDOW_EXPIRED",
  label: "Within return window",
  passed,
  detail,
});

const paymentCheck = (passed: boolean, detail: string): PolicyCheck => ({
  code: passed ? "PAYMENT_CAPTURED" : "PAYMENT_NOT_CAPTURED",
  label: "Payment captured",
  passed,
  detail,
});

const itemCheck = (passed: boolean, detail: string): PolicyCheck => ({
  code: passed ? "ITEM_RETURNABLE" : "ITEM_NOT_RETURNABLE",
  label: "Item is returnable",
  passed,
  detail,
});

const quantityCheck = (passed: boolean, detail: string): PolicyCheck => ({
  code: passed ? "QUANTITY_VALID" : "QUANTITY_EXCEEDS_ORDERED",
  label: "Quantity is valid",
  passed,
  detail,
});

const amountCheck = (passed: boolean, detail: string): PolicyCheck => ({
  code: passed ? "AMOUNT_WITHIN_REFUNDABLE" : "AMOUNT_EXCEEDS_REFUNDABLE",
  label: "Amount within refundable balance",
  passed,
  detail,
});

const duplicateCheck = (passed: boolean, detail: string): PolicyCheck => ({
  code: passed ? "NO_DUPLICATE_REQUEST" : "DUPLICATE_REQUEST",
  label: "No duplicate request",
  passed,
  detail,
});

function evaluation(
  returnId: string,
  evaluatedAt: string,
  checks: PolicyCheck[],
): PolicyEvaluation {
  return {
    returnId,
    eligible: checks.every((check) => check.passed),
    checks,
    evaluatedAt,
  };
}

const NO_DUPLICATE = "No other open request for this item.";
const CAPTURED = "Payment status is captured.";

export const demoPolicyEvaluations: Record<string, PolicyEvaluation> = {
  ret_1001: evaluation("ret_1001", "2026-10-11T08:21:00Z", [
    windowCheck(true, "Delivered 9 days ago; policy allows 30 days."),
    paymentCheck(true, CAPTURED),
    itemCheck(true, "Wireless Earbuds Pro is returnable."),
    quantityCheck(true, "Requesting 1 of 1 ordered."),
    amountCheck(true, "$79.99 requested; $104.99 refundable."),
    duplicateCheck(true, NO_DUPLICATE),
  ]),
  ret_1002: evaluation("ret_1002", "2026-10-09T14:11:00Z", [
    windowCheck(true, "Delivered 9 days ago; policy allows 30 days."),
    paymentCheck(true, CAPTURED),
    itemCheck(true, "Ceramic Mug Set (4 pcs) is returnable."),
    quantityCheck(true, "Requesting 1 of 1 ordered."),
    amountCheck(true, "$38.50 requested; $102.50 refundable."),
    duplicateCheck(true, NO_DUPLICATE),
  ]),
  ret_1003: evaluation("ret_1003", "2026-10-10T19:46:00Z", [
    windowCheck(false, "Delivered 51 days ago; policy allows 30 days."),
    paymentCheck(true, CAPTURED),
    itemCheck(true, "Trail Running Shoes is returnable."),
    quantityCheck(true, "Requesting 1 of 1 ordered."),
    amountCheck(true, "$129.00 requested; $129.00 refundable."),
    duplicateCheck(true, NO_DUPLICATE),
  ]),
  ret_1004: evaluation("ret_1004", "2026-10-01T10:01:00Z", [
    windowCheck(true, "Delivered 16 days ago; policy allows 30 days."),
    paymentCheck(true, CAPTURED),
    itemCheck(true, "Yoga Mat is returnable."),
    quantityCheck(true, "Requesting 1 of 1 ordered."),
    amountCheck(true, "$45.00 requested; $63.00 refundable."),
    duplicateCheck(true, NO_DUPLICATE),
  ]),
  ret_1005: evaluation("ret_1005", "2026-10-07T12:01:00Z", [
    windowCheck(true, "Delivered 2 days ago; policy allows 30 days."),
    paymentCheck(true, CAPTURED),
    itemCheck(false, "Custom Engraved Watch is marked final sale."),
    quantityCheck(true, "Requesting 1 of 1 ordered."),
    amountCheck(true, "$210.00 requested; $235.00 refundable."),
    duplicateCheck(true, NO_DUPLICATE),
  ]),
  ret_1006: evaluation("ret_1006", "2026-10-09T09:16:00Z", [
    windowCheck(true, "Delivered 1 day ago; policy allows 30 days."),
    paymentCheck(true, CAPTURED),
    itemCheck(true, "Mechanical Keyboard (ANSI) is returnable."),
    quantityCheck(true, "Requesting 1 of 1 ordered."),
    amountCheck(true, "$149.00 requested; $184.00 refundable."),
    duplicateCheck(true, NO_DUPLICATE),
  ]),
  ret_1007: evaluation("ret_1007", "2026-10-06T15:31:00Z", [
    windowCheck(true, "Delivered 5 days ago; policy allows 30 days."),
    paymentCheck(true, CAPTURED),
    itemCheck(true, "Everyday Backpack 24L is returnable."),
    quantityCheck(true, "Requesting 1 of 1 ordered."),
    amountCheck(true, "$89.00 requested; $89.00 refundable."),
    duplicateCheck(true, NO_DUPLICATE),
  ]),
  ret_1008: evaluation("ret_1008", "2026-10-10T07:51:00Z", [
    windowCheck(true, "Delivered 8 days ago; policy allows 30 days."),
    paymentCheck(true, CAPTURED),
    itemCheck(true, "USB-C Charging Cable is returnable."),
    quantityCheck(true, "Requesting 1 of 2 ordered."),
    amountCheck(true, "$12.50 requested; $104.99 refundable."),
    duplicateCheck(true, NO_DUPLICATE),
  ]),
};

/* ---------- AI analyses (static demo content, source = "demo") ---------- */

export const demoAiAnalyses: Record<string, AiAnalysis> = {
  ret_1001: {
    returnId: "ret_1001",
    source: "demo",
    category: "damaged",
    summary: "Customer reports the left earbud stopped charging three days after delivery and the case LED blinks red.",
    keyPoints: [
      "Fault appeared within days of delivery",
      "Case LED reportedly blinks red",
      "No mention of physical damage or misuse",
    ],
    suggestedAction: "approve",
    rationale: "All policy checks pass and the described fault is consistent with a hardware defect. The decision rests with the seller.",
    confidence: 0.86,
    generatedAt: "2026-10-11T08:22:00Z",
  },
  ret_1002: {
    returnId: "ret_1002",
    source: "demo",
    category: "damaged",
    summary: "Two of the four mugs in the set arrived cracked; the customer asks for a refund of the whole set.",
    keyPoints: [
      "Partial damage: 2 of 4 mugs",
      "Likely shipping damage",
      "Full-set refund requested for partial damage",
    ],
    suggestedAction: "request_more_info",
    rationale: "Policy allows partial refunds, so consider confirming whether the customer accepts a partial refund or wants to return the full set.",
    confidence: 0.72,
    generatedAt: "2026-10-09T14:12:00Z",
  },
  ret_1003: {
    returnId: "ret_1003",
    source: "demo",
    category: "changed_mind",
    summary: "Customer likes the fit but dislikes the color and wants to return the shoes.",
    keyPoints: [
      "No defect or fulfillment error claimed",
      "Request falls outside the 30-day return window",
    ],
    suggestedAction: "reject",
    rationale: "The return window check failed and no defect is claimed. Eligibility is decided by the policy rules, not by this suggestion.",
    confidence: 0.93,
    generatedAt: "2026-10-10T19:47:00Z",
  },
  ret_1004: {
    returnId: "ret_1004",
    source: "demo",
    category: "not_as_described",
    summary: "Customer says the yoga mat is thinner than the product listing described.",
    keyPoints: [
      "Possible listing accuracy issue",
      "Only the mat is being returned; the bands are kept",
    ],
    suggestedAction: "approve",
    rationale: "Policy checks pass. Consider reviewing the listing's thickness details to prevent repeat returns.",
    confidence: 0.78,
    generatedAt: "2026-10-01T10:02:00Z",
  },
  ret_1005: {
    returnId: "ret_1005",
    source: "demo",
    category: "changed_mind",
    summary: "Customer changed their mind about a gift.",
    keyPoints: [
      "Item is custom engraved",
      "Store policy marks engraved items as final sale",
    ],
    suggestedAction: "reject",
    rationale: "The item is non-returnable under the configured policy, so the eligibility check fails.",
    confidence: 0.95,
    generatedAt: "2026-10-07T12:02:00Z",
  },
  ret_1006: {
    returnId: "ret_1006",
    source: "demo",
    category: "wrong_item",
    summary: "Customer received an ISO-layout keyboard but ordered the ANSI layout.",
    keyPoints: [
      "Fulfillment error on the seller side",
      "Customer is within the return window",
    ],
    suggestedAction: "approve",
    rationale: "A shipping mistake with all policy checks passing is a low-risk approval.",
    confidence: 0.9,
    generatedAt: "2026-10-09T09:17:00Z",
  },
  ret_1007: {
    returnId: "ret_1007",
    source: "demo",
    category: "damaged",
    summary: "Backpack zipper broke on first use.",
    keyPoints: [
      "Possible manufacturing defect",
      "Full order amount requested",
    ],
    suggestedAction: "approve",
    rationale: "The complaint describes a defect on first use and all policy checks pass.",
    confidence: 0.84,
    generatedAt: "2026-10-06T15:32:00Z",
  },
  ret_1008: {
    returnId: "ret_1008",
    source: "demo",
    category: "other",
    summary: "Customer says the charging cable is too short for their desk setup.",
    keyPoints: [
      "No defect claimed",
      "Low-value item, one of two cables",
    ],
    suggestedAction: "approve",
    rationale: "The request is within policy and low in value; no defect is claimed, so the seller may also weigh goodwill.",
    confidence: 0.7,
    generatedAt: "2026-10-10T07:52:00Z",
  },
};

/* ---------- Refund records and timelines ---------- */

const DEMO_STEP_NOTE = "Demo state only: no PayPal request was sent.";

type StepRow = [
  title: string,
  description: string,
  status: RefundStepStatus,
  occurredAt: string | null,
];

function steps(returnId: string, rows: StepRow[]): RefundTimelineStep[] {
  return rows.map(([title, description, status, occurredAt], index) => ({
    id: `${returnId}_step_${index + 1}`,
    title,
    description,
    status,
    occurredAt,
  }));
}

export const demoRefundRecords: Record<string, RefundRecord> = {
  ret_1001: {
    returnId: "ret_1001",
    status: "not_started",
    amount: "79.99",
    currency: DEMO_CURRENCY,
    paypalRefundId: null,
    failureReason: null,
    steps: steps("ret_1001", [
      ["Return submitted", "Customer submitted the request.", "complete", "2026-10-11T08:20:00Z"],
      ["Seller decision", "Waiting for the seller to review.", "current", null],
      ["Refund initiated", "Starts after the seller approves.", "upcoming", null],
      ["Refund confirmed", "Confirmed once the payment provider reports success.", "upcoming", null],
    ]),
  },
  ret_1002: {
    returnId: "ret_1002",
    status: "not_started",
    amount: "38.50",
    currency: DEMO_CURRENCY,
    paypalRefundId: null,
    failureReason: null,
    steps: steps("ret_1002", [
      ["Return submitted", "Customer submitted the request.", "complete", "2026-10-09T14:10:00Z"],
      ["Seller decision", "Under review by the seller.", "current", "2026-10-10T09:00:00Z"],
      ["Refund initiated", "Starts after the seller approves.", "upcoming", null],
      ["Refund confirmed", "Confirmed once the payment provider reports success.", "upcoming", null],
    ]),
  },
  ret_1003: {
    returnId: "ret_1003",
    status: "not_started",
    amount: "129.00",
    currency: DEMO_CURRENCY,
    paypalRefundId: null,
    failureReason: null,
    steps: steps("ret_1003", [
      ["Return submitted", "Customer submitted the request.", "complete", "2026-10-10T19:45:00Z"],
      ["Seller decision", "Waiting for the seller to review.", "current", null],
      ["Refund initiated", "Starts after the seller approves.", "upcoming", null],
      ["Refund confirmed", "Confirmed once the payment provider reports success.", "upcoming", null],
    ]),
  },
  ret_1004: {
    returnId: "ret_1004",
    status: "completed",
    amount: "45.00",
    currency: DEMO_CURRENCY,
    paypalRefundId: null,
    failureReason: null,
    steps: steps("ret_1004", [
      ["Return submitted", "Customer submitted the request.", "complete", "2026-10-01T10:00:00Z"],
      ["Seller decision", "Approved by the seller.", "complete", "2026-10-02T09:30:00Z"],
      ["Refund initiated", DEMO_STEP_NOTE, "complete", "2026-10-02T09:35:00Z"],
      ["Refund confirmed", "Demo state only: not confirmed by PayPal.", "complete", "2026-10-05T13:30:00Z"],
    ]),
  },
  ret_1005: {
    returnId: "ret_1005",
    status: "not_started",
    amount: "0.00",
    currency: DEMO_CURRENCY,
    paypalRefundId: null,
    failureReason: null,
    steps: steps("ret_1005", [
      ["Return submitted", "Customer submitted the request.", "complete", "2026-10-07T12:00:00Z"],
      ["Seller decision", "Rejected: item is final sale. No refund will be issued.", "complete", "2026-10-07T16:20:00Z"],
    ]),
  },
  ret_1006: {
    returnId: "ret_1006",
    status: "pending",
    amount: "149.00",
    currency: DEMO_CURRENCY,
    paypalRefundId: null,
    failureReason: null,
    steps: steps("ret_1006", [
      ["Return submitted", "Customer submitted the request.", "complete", "2026-10-09T09:15:00Z"],
      ["Seller decision", "Approved by the seller.", "complete", "2026-10-10T10:55:00Z"],
      ["Refund initiated", DEMO_STEP_NOTE, "complete", "2026-10-10T11:00:00Z"],
      ["Refund confirmed", "Waiting for the payment provider to confirm.", "current", null],
    ]),
  },
  ret_1007: {
    returnId: "ret_1007",
    status: "failed",
    amount: "89.00",
    currency: DEMO_CURRENCY,
    paypalRefundId: null,
    failureReason: "Simulated failure shown for UI demonstration only.",
    steps: steps("ret_1007", [
      ["Return submitted", "Customer submitted the request.", "complete", "2026-10-06T15:30:00Z"],
      ["Seller decision", "Approved by the seller.", "complete", "2026-10-08T09:50:00Z"],
      ["Refund initiated", DEMO_STEP_NOTE, "complete", "2026-10-08T09:52:00Z"],
      ["Refund confirmed", "Simulated failure shown for UI demonstration only.", "failed", "2026-10-08T10:15:00Z"],
    ]),
  },
  ret_1008: {
    returnId: "ret_1008",
    status: "not_started",
    amount: "12.50",
    currency: DEMO_CURRENCY,
    paypalRefundId: null,
    failureReason: null,
    steps: steps("ret_1008", [
      ["Return submitted", "Customer submitted the request.", "complete", "2026-10-10T07:50:00Z"],
      ["Seller decision", "Approved by the seller.", "complete", "2026-10-11T12:00:00Z"],
      ["Refund initiated", "Ready for the seller to start the refund.", "current", null],
      ["Refund confirmed", "Confirmed once the payment provider reports success.", "upcoming", null],
    ]),
  },
};

/* ---------- Audit log ---------- */

const SELLER = "Demo Seller";
const SYSTEM = "ReturnWise";
const AI_ACTOR = "AI assistant (demo)";

let auditSeq = 0;

function audit(
  returnId: string | null,
  eventType: AuditEventType,
  actorType: AuditActorType,
  actorName: string,
  description: string,
  fromStatus: ReturnStatus | null,
  toStatus: ReturnStatus | null,
  occurredAt: string,
): AuditEntry {
  auditSeq += 1;
  return {
    id: `aud_${String(auditSeq).padStart(3, "0")}`,
    returnId,
    eventType,
    actorType,
    actorName,
    description,
    fromStatus,
    toStatus,
    occurredAt,
  };
}

export const demoAuditLog: AuditEntry[] = [
  audit(null, "policy_updated", "seller", SELLER, "Return window changed from 14 to 30 days.", null, null, "2026-09-20T09:00:00Z"),

  // RET-1004
  audit("ret_1004", "return_submitted", "customer", "Priya Nair", "Return request RET-1004 submitted.", null, "submitted", "2026-10-01T10:00:00Z"),
  audit("ret_1004", "policy_evaluated", "system", SYSTEM, "Policy check passed (6 of 6).", null, null, "2026-10-01T10:01:00Z"),
  audit("ret_1004", "ai_analysis_generated", "ai", AI_ACTOR, "Case analysis generated (demo content).", null, null, "2026-10-01T10:02:00Z"),
  audit("ret_1004", "review_started", "seller", SELLER, "Review started.", "submitted", "under_review", "2026-10-01T15:00:00Z"),
  audit("ret_1004", "return_approved", "seller", SELLER, "Return approved.", "under_review", "approved", "2026-10-02T09:30:00Z"),
  audit("ret_1004", "refund_initiated", "seller", SELLER, "Refund initiated (demo state, no PayPal request sent).", "approved", "refund_pending", "2026-10-02T09:35:00Z"),
  audit("ret_1004", "refund_completed", "system", SYSTEM, "Marked refunded in demo data; no real PayPal transaction exists.", "refund_pending", "refunded", "2026-10-05T13:30:00Z"),

  // RET-1007
  audit("ret_1007", "return_submitted", "customer", "Emma Fischer", "Return request RET-1007 submitted.", null, "submitted", "2026-10-06T15:30:00Z"),
  audit("ret_1007", "policy_evaluated", "system", SYSTEM, "Policy check passed (6 of 6).", null, null, "2026-10-06T15:31:00Z"),
  audit("ret_1007", "ai_analysis_generated", "ai", AI_ACTOR, "Case analysis generated (demo content).", null, null, "2026-10-06T15:32:00Z"),
  audit("ret_1007", "review_started", "seller", SELLER, "Review started.", "submitted", "under_review", "2026-10-07T09:00:00Z"),
  audit("ret_1007", "return_approved", "seller", SELLER, "Return approved.", "under_review", "approved", "2026-10-08T09:50:00Z"),
  audit("ret_1007", "refund_initiated", "seller", SELLER, "Refund initiated (demo state, no PayPal request sent).", "approved", "refund_pending", "2026-10-08T09:52:00Z"),
  audit("ret_1007", "refund_failed", "system", SYSTEM, "Simulated refund failure for UI demonstration.", "refund_pending", "refund_failed", "2026-10-08T10:15:00Z"),

  // RET-1005
  audit("ret_1005", "return_submitted", "customer", "Noah Becker", "Return request RET-1005 submitted.", null, "submitted", "2026-10-07T12:00:00Z"),
  audit("ret_1005", "policy_evaluated", "system", SYSTEM, "Policy check failed: item is final sale.", null, null, "2026-10-07T12:01:00Z"),
  audit("ret_1005", "ai_analysis_generated", "ai", AI_ACTOR, "Case analysis generated (demo content).", null, null, "2026-10-07T12:02:00Z"),
  audit("ret_1005", "review_started", "seller", SELLER, "Review started.", "submitted", "under_review", "2026-10-07T16:10:00Z"),
  audit("ret_1005", "return_rejected", "seller", SELLER, "Return rejected: custom engraved items are final sale.", "under_review", "rejected", "2026-10-07T16:20:00Z"),

  // RET-1006
  audit("ret_1006", "return_submitted", "customer", "Hana Kimura", "Return request RET-1006 submitted.", null, "submitted", "2026-10-09T09:15:00Z"),
  audit("ret_1006", "policy_evaluated", "system", SYSTEM, "Policy check passed (6 of 6).", null, null, "2026-10-09T09:16:00Z"),
  audit("ret_1006", "ai_analysis_generated", "ai", AI_ACTOR, "Case analysis generated (demo content).", null, null, "2026-10-09T09:17:00Z"),
  audit("ret_1006", "review_started", "seller", SELLER, "Review started.", "submitted", "under_review", "2026-10-09T13:00:00Z"),
  audit("ret_1006", "return_approved", "seller", SELLER, "Return approved.", "under_review", "approved", "2026-10-10T10:55:00Z"),
  audit("ret_1006", "refund_initiated", "seller", SELLER, "Refund initiated (demo state, no PayPal request sent).", "approved", "refund_pending", "2026-10-10T11:00:00Z"),

  // RET-1002
  audit("ret_1002", "return_submitted", "customer", "Sofia Alvarez", "Return request RET-1002 submitted.", null, "submitted", "2026-10-09T14:10:00Z"),
  audit("ret_1002", "policy_evaluated", "system", SYSTEM, "Policy check passed (6 of 6).", null, null, "2026-10-09T14:11:00Z"),
  audit("ret_1002", "ai_analysis_generated", "ai", AI_ACTOR, "Case analysis generated (demo content).", null, null, "2026-10-09T14:12:00Z"),
  audit("ret_1002", "review_started", "seller", SELLER, "Review started.", "submitted", "under_review", "2026-10-10T09:00:00Z"),

  // RET-1008
  audit("ret_1008", "return_submitted", "customer", "Aarav Mehta", "Return request RET-1008 submitted.", null, "submitted", "2026-10-10T07:50:00Z"),
  audit("ret_1008", "policy_evaluated", "system", SYSTEM, "Policy check passed (6 of 6).", null, null, "2026-10-10T07:51:00Z"),
  audit("ret_1008", "ai_analysis_generated", "ai", AI_ACTOR, "Case analysis generated (demo content).", null, null, "2026-10-10T07:52:00Z"),
  audit("ret_1008", "review_started", "seller", SELLER, "Review started.", "submitted", "under_review", "2026-10-10T14:00:00Z"),
  audit("ret_1008", "return_approved", "seller", SELLER, "Return approved.", "under_review", "approved", "2026-10-11T12:00:00Z"),

  // RET-1003
  audit("ret_1003", "return_submitted", "customer", "Liam O'Connor", "Return request RET-1003 submitted.", null, "submitted", "2026-10-10T19:45:00Z"),
  audit("ret_1003", "policy_evaluated", "system", SYSTEM, "Policy check failed: return window expired.", null, null, "2026-10-10T19:46:00Z"),
  audit("ret_1003", "ai_analysis_generated", "ai", AI_ACTOR, "Case analysis generated (demo content).", null, null, "2026-10-10T19:47:00Z"),

  // RET-1001
  audit("ret_1001", "return_submitted", "customer", "Aarav Mehta", "Return request RET-1001 submitted.", null, "submitted", "2026-10-11T08:20:00Z"),
  audit("ret_1001", "policy_evaluated", "system", SYSTEM, "Policy check passed (6 of 6).", null, null, "2026-10-11T08:21:00Z"),
  audit("ret_1001", "ai_analysis_generated", "ai", AI_ACTOR, "Case analysis generated (demo content).", null, null, "2026-10-11T08:22:00Z"),
];

/* ---------- Dashboard metrics (derived, so they always match the data) ---------- */

const MS_PER_HOUR = 3_600_000;

export function computeDashboardMetrics(
  returns: ReturnRequest[],
  auditLog: AuditEntry[],
  currency: CurrencyCode,
  now: Date,
): DashboardMetrics {
  const returnsByStatus: Record<ReturnStatus, number> = {
    submitted: 0,
    under_review: 0,
    approved: 0,
    rejected: 0,
    refund_pending: 0,
    refunded: 0,
    refund_failed: 0,
  };
  for (const item of returns) {
    returnsByStatus[item.status] += 1;
  }

  const openReturns = returns.filter(
    (item) => item.status !== "rejected" && item.status !== "refunded",
  ).length;

  // Sum refunded returns that were completed in the current UTC month.
  let refundedThisMonth = "0.00";
  for (const item of returns) {
    if (item.status !== "refunded") continue;
    const updated = new Date(item.updatedAt);
    if (
      updated.getUTCFullYear() === now.getUTCFullYear() &&
      updated.getUTCMonth() === now.getUTCMonth()
    ) {
      refundedThisMonth = addMoney(refundedThisMonth, item.requestedAmount);
    }
  }

  // Average hours from submission to the first approve/reject decision.
  const decisionAt = new Map<string, number>();
  for (const entry of auditLog) {
    if (
      entry.returnId &&
      (entry.eventType === "return_approved" || entry.eventType === "return_rejected") &&
      !decisionAt.has(entry.returnId)
    ) {
      decisionAt.set(entry.returnId, new Date(entry.occurredAt).getTime());
    }
  }
  const durations: number[] = [];
  for (const item of returns) {
    const decided = decisionAt.get(item.id);
    if (decided !== undefined) {
      durations.push((decided - new Date(item.submittedAt).getTime()) / MS_PER_HOUR);
    }
  }
  const avgDecisionHours =
    durations.length === 0
      ? 0
      : Math.round((durations.reduce((sum, h) => sum + h, 0) / durations.length) * 10) / 10;

  return {
    openReturns,
    awaitingReview: returnsByStatus.submitted + returnsByStatus.under_review,
    refundsPending: returnsByStatus.refund_pending,
    refundedThisMonth,
    currency,
    avgDecisionHours,
    returnsByStatus,
  };
}

export const demoDashboardMetrics: DashboardMetrics = computeDashboardMetrics(
  demoReturns,
  demoAuditLog,
  DEMO_CURRENCY,
  new Date(DEMO_NOW_ISO),
);