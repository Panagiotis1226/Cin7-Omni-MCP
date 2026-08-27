/**
 * Registry of every resource exposed by the Cin7 Omni v1/v2 API.
 *
 * Verb matrix taken from Cin7's official swagger spec
 * (https://api.cin7.com/api/swagger/v1/swagger.json) — the API supports
 * exactly these operations per resource, nothing more.
 */

export type Verb = "list" | "get" | "create" | "update" | "delete";

export interface ResourceDef {
  /** Path under the API base, e.g. "v1/SalesOrders". */
  path: string;
  verbs: Verb[];
  /** What the {id} path segment means for GET-by-id / DELETE. */
  idName: "id" | "barcode" | "code";
  idType: "integer" | "string";
  description: string;
  /** POST/PUT accept a ?loadboms= query flag (orders/quotes only). */
  supportsLoadBoms?: boolean;
  /** PUT goes to {path}/{id} instead of {path} (Cartons only). */
  updateRequiresId?: boolean;
  /** Key into FIELD_REFERENCE when it differs from the registry key. */
  fieldKey?: string;
  notes?: string;
}

export const RESOURCES: { [key: string]: ResourceDef } = {
  Adjustments: {
    path: "v1/Adjustments",
    verbs: ["list", "get", "create", "update"],
    idName: "id",
    idType: "integer",
    description:
      "Stock adjustments (quantity corrections, write-offs). Each has lineItems adjusting product quantities at a branch.",
  },
  BomMasters: {
    path: "v1/BomMasters",
    verbs: ["list", "get"],
    idName: "id",
    idType: "integer",
    description:
      "Bill of Materials masters (v1): finished products and the component products/quantities they are built from. Read-only.",
  },
  BomMasters_v2: {
    path: "v2/BomMasters",
    verbs: ["list", "get"],
    idName: "id",
    idType: "integer",
    description:
      "Bill of Materials masters (v2 endpoint, newer response shape). Read-only.",
  },
  Branches: {
    path: "v1/Branches",
    verbs: ["list", "get", "create", "update"],
    idName: "id",
    idType: "integer",
    description:
      "Branches / locations (warehouses, retail stores) including address and company details.",
  },
  BranchTransfers: {
    path: "v1/BranchTransfers",
    verbs: ["list", "get", "create", "update"],
    idName: "id",
    idType: "integer",
    description:
      "Stock transfers between branches, with lineItems for the products and quantities moved.",
  },
  Cartons: {
    path: "v1/Cartons",
    verbs: ["get", "update"],
    idName: "id",
    idType: "integer",
    description:
      "Cartons for a sales order (packing/freight details). GET and PUT take a SALES ORDER id and operate on that order's cartons; there is no list endpoint — use SalesOrdersWithCartons to browse.",
    updateRequiresId: true,
  },
  Contacts: {
    path: "v1/Contacts",
    verbs: ["list", "get", "create", "update", "delete"],
    idName: "id",
    idType: "integer",
    description:
      "Customers, suppliers and other contacts (type field: Customer | Supplier). Includes billing/postal addresses, payment terms, price tier.",
  },
  CreditNotes: {
    path: "v1/CreditNotes",
    verbs: ["list", "get", "create", "update"],
    idName: "id",
    idType: "integer",
    description:
      "Credit notes issued against sales orders/invoices, with lineItems being credited.",
  },
  PaymentFees: {
    path: "v1/PaymentFeesAndPayouts/Fees",
    verbs: ["list"],
    idName: "id",
    idType: "integer",
    description:
      "Payment processing fees (e.g. from payment gateways). Read-only list; filter with 'where'.",
    fieldKey: "PaymentFeesAndPayouts",
  },
  PaymentPayouts: {
    path: "v1/PaymentFeesAndPayouts/Payouts",
    verbs: ["list"],
    idName: "id",
    idType: "integer",
    description:
      "Payment gateway payouts to your bank account. Read-only list; filter with 'where'.",
    fieldKey: "PaymentFeesAndPayouts",
  },
  Payments: {
    path: "v1/Payments",
    verbs: ["list", "get", "create", "update", "delete"],
    idName: "id",
    idType: "integer",
    description:
      "Payments recorded against sales orders (orderId/orderRef), with method, amount and date.",
  },
  ProductCategories: {
    path: "v1/ProductCategories",
    verbs: ["list", "get", "create", "update"],
    idName: "id",
    idType: "integer",
    description: "Product categories / hierarchy used to organise products.",
  },
  ProductOptions: {
    path: "v1/ProductOptions",
    verbs: ["list", "get", "create", "update"],
    idName: "id",
    idType: "integer",
    description:
      "Product options / variants (size, colour, SKU-level records) including code, barcode, prices and stock-related settings. Each belongs to a product (productId).",
  },
  ProductionJobs: {
    path: "v1/ProductionJobs",
    verbs: ["list", "get", "create", "update"],
    idName: "id",
    idType: "integer",
    description:
      "Production / assembly jobs that build finished products from components (uses BOMs).",
  },
  Products: {
    path: "v1/Products",
    verbs: ["list", "get", "create", "update"],
    idName: "id",
    idType: "integer",
    description:
      "Products (parent records). Variant/SKU-level detail lives in productOptions (also exposed as the ProductOptions resource).",
  },
  PurchaseOrders: {
    path: "v1/PurchaseOrders",
    verbs: ["list", "get", "create", "update"],
    idName: "id",
    idType: "integer",
    description:
      "Purchase orders to suppliers, with lineItems, supplier (memberId/company), stages and totals.",
    supportsLoadBoms: true,
  },
  Quotes: {
    path: "v1/Quotes",
    verbs: ["list", "get", "create", "update"],
    idName: "id",
    idType: "integer",
    description: "Sales quotes (pre-order stage), with lineItems and customer details.",
    supportsLoadBoms: true,
  },
  SalesOrders: {
    path: "v1/SalesOrders",
    verbs: ["list", "get", "create", "update"],
    idName: "id",
    idType: "integer",
    description:
      "Sales orders/invoices, with lineItems, customer (memberId/company), stages, dispatch and totals. The core sales document in Cin7.",
    supportsLoadBoms: true,
  },
  SalesOrdersWithCartons: {
    path: "v1/SalesOrdersWithCartons",
    verbs: ["list", "get"],
    idName: "id",
    idType: "integer",
    description:
      "Sales orders including their carton/packing data. Read-only variant of SalesOrders.",
  },
  SerialNumbers: {
    path: "v1/SerialNumbers",
    verbs: ["list", "get"],
    idName: "id",
    idType: "integer",
    description: "Serial numbers tracked against products and orders. Read-only.",
  },
  SizeRanges: {
    path: "v1/SizeRanges",
    verbs: ["list", "get"],
    idName: "id",
    idType: "integer",
    description: "Size ranges (e.g. S/M/L sets) used by product options. Read-only.",
  },
  Stock: {
    path: "v1/Stock",
    verbs: ["list", "get"],
    idName: "barcode",
    idType: "string",
    description:
      "Stock on hand per product option per branch: available, open orders, incoming, stockOnHand. Read-only. GET-by-id looks up by BARCODE; for other lookups use list with a 'where' filter (e.g. \"code='CTS001'\" or branchId=123).",
  },
  Users: {
    path: "v1/Users",
    verbs: ["list", "get"],
    idName: "id",
    idType: "integer",
    description: "Cin7 user accounts (names, departments). Read-only.",
  },
  Voucher: {
    path: "v1/Voucher",
    verbs: ["list", "get"],
    idName: "code",
    idType: "string",
    description:
      "Gift vouchers / store credit vouchers. Read-only via API. GET-by-id looks up by voucher CODE.",
  },
};

export type ResourceKey = keyof typeof RESOURCES & string;

export const RESOURCE_KEYS = Object.keys(RESOURCES) as ResourceKey[];

/** Resource keys supporting a given verb. */
export function resourcesSupporting(verb: Verb): ResourceKey[] {
  return RESOURCE_KEYS.filter((k) => RESOURCES[k].verbs.includes(verb));
}

/**
 * Validate that `resource` supports `verb`; returns an actionable error
 * message (or null when the call is allowed).
 */
export function verbError(resource: ResourceKey, verb: Verb): string | null {
  const def = RESOURCES[resource];
  if (!def) {
    return `Unknown resource '${resource}'. Valid resources: ${RESOURCE_KEYS.join(", ")}`;
  }
  if (!def.verbs.includes(verb)) {
    return (
      `The Cin7 Omni API does not support '${verb}' on ${resource} ` +
      `(supported: ${def.verbs.join(", ")}). ` +
      `Resources that DO support '${verb}': ${resourcesSupporting(verb).join(", ") || "none"}.`
    );
  }
  return null;
}
