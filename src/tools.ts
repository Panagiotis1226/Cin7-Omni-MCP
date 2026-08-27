/**
 * MCP tool definitions for the Cin7 Omni API.
 *
 * The Cin7 Omni v1 API is uniform — every resource shares the same
 * list/get/create/update pattern and query parameters — so a small set of
 * generic tools with a `resource` enum covers 100% of the API surface.
 * The registry in resources.ts enforces exactly which verbs each resource
 * supports, and cin7_describe serves the per-resource field reference
 * generated from Cin7's official swagger spec.
 */

import { readFile } from "node:fs/promises";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  cin7Request,
  cin7UploadProductImage,
  Cin7ApiError,
  type Cin7Config,
} from "./client.js";
import {
  RESOURCES,
  RESOURCE_KEYS,
  resourcesSupporting,
  verbError,
  type ResourceKey,
  type Verb,
} from "./resources.js";
import { FIELD_REFERENCE } from "./fieldReference.js";

const CHARACTER_LIMIT = 50_000;

function resourceEnum(verb?: Verb): z.ZodEnum<[string, ...string[]]> {
  const keys = verb ? resourcesSupporting(verb) : RESOURCE_KEYS;
  return z.enum(keys as [string, ...string[]]);
}

function ok(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

function fail(message: string) {
  return { isError: true, content: [{ type: "text" as const, text: `Error: ${message}` }] };
}

function toErrorResult(err: unknown) {
  if (err instanceof Cin7ApiError || err instanceof Error) return fail(err.message);
  return fail(String(err));
}

function checkVerb(resource: string, verb: Verb) {
  const msg = verbError(resource as ResourceKey, verb);
  return msg ? fail(msg) : null;
}

function summaryLine(resource: string): string {
  const def = RESOURCES[resource];
  return `${resource} (${def.verbs.join("/")}): ${def.description}`;
}

export function registerTools(server: McpServer, config: Cin7Config, readOnly: boolean): void {
  // ---------------------------------------------------------------- list
  server.registerTool(
    "cin7_list",
    {
      title: "List Cin7 records",
      description: `List/search records of any Cin7 Omni resource, with filtering, field selection, ordering and pagination.

Resources: ${RESOURCE_KEYS.join(", ")}. Call cin7_describe first to see a resource's fields.

Filtering ('where'): SQL-like syntax with operators =, <>, >, <, >=, <=, LIKE, IN, IS. String values in single quotes, dates in UTC ISO format. Combine with AND/OR.
Examples: "firstName='Jane' AND lastName='Doe'", "modifiedDate>='2026-01-01T00:00:00Z'", "code IN ('CTS001','CTS002')", "company LIKE '%ltd%'".

'fields' selects specific fields (comma-separated, e.g. "id,code,stockOnHand") — use it to keep responses small.
'order' sorts (e.g. "modifiedDate DESC" or "code ASC"; default direction is DESC).

Returns a JSON object: { resource, page, rows_requested, count, items: [...], has_more }. If has_more is true, request the next page. Responses over ${CHARACTER_LIMIT} characters are truncated — narrow with 'fields'/'where' or lower 'rows'.

Note: Cin7 rate-limits to 3 calls/sec, 60/min, 5000/day; this server queues and retries automatically, so bulk scans across many pages are slow by design.`,
      inputSchema: {
        resource: resourceEnum("list").describe("Which Cin7 resource to list"),
        where: z.string().optional().describe("Filter expression, e.g. \"modifiedDate>='2026-01-01T00:00:00Z'\""),
        fields: z.string().optional().describe("Comma-separated fields to return, e.g. 'id,code,firstName'"),
        order: z.string().optional().describe("Sort field(s), e.g. 'modifiedDate DESC' or 'code ASC'"),
        page: z.number().int().min(1).default(1).describe("Page number, starting at 1"),
        rows: z.number().int().min(1).max(250).default(50).describe("Records per page (max 250)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ resource, where, fields, order, page, rows }) => {
      const bad = checkVerb(resource, "list");
      if (bad) return bad;
      try {
        const data = await cin7Request(config, "GET", RESOURCES[resource].path, {
          where,
          fields,
          order,
          page,
          rows,
        });
        const items = Array.isArray(data) ? data : data === null ? [] : [data];
        const payload = {
          resource,
          page,
          rows_requested: rows,
          count: items.length,
          items,
          has_more: items.length === rows,
        };
        let text = JSON.stringify(payload, null, 2);
        if (text.length > CHARACTER_LIMIT) {
          let keep = items.length;
          while (keep > 1 && text.length > CHARACTER_LIMIT) {
            keep = Math.floor(keep / 2);
            text = JSON.stringify(
              {
                ...payload,
                count: keep,
                items: items.slice(0, keep),
                truncated: true,
                truncation_message: `Response was too large; showing ${keep} of ${items.length} fetched records. Use 'fields' to select fewer fields, add a 'where' filter, or lower 'rows'.`,
              },
              null,
              2,
            );
          }
        }
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return toErrorResult(err);
      }
    },
  );

  // ----------------------------------------------------------------- get
  server.registerTool(
    "cin7_get",
    {
      title: "Get a Cin7 record by id",
      description: `Fetch a single Cin7 Omni record by its identifier.

The identifier is the numeric 'id' for most resources, but: Stock is looked up by BARCODE, Voucher by voucher CODE, and Cartons by the SALES ORDER id. To find a record when you don't know its id, use cin7_list with a 'where' filter instead.`,
      inputSchema: {
        resource: resourceEnum("get").describe("Which Cin7 resource"),
        id: z.union([z.string(), z.number()]).describe("Record id (numeric), or barcode for Stock / voucher code for Voucher / sales-order id for Cartons"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ resource, id }) => {
      const bad = checkVerb(resource, "get");
      if (bad) return bad;
      try {
        const data = await cin7Request(
          config,
          "GET",
          `${RESOURCES[resource].path}/${encodeURIComponent(String(id))}`,
        );
        if (data === null) {
          return fail(`No ${resource} record found for ${RESOURCES[resource].idName} '${id}'.`);
        }
        return ok(data);
      } catch (err) {
        return toErrorResult(err);
      }
    },
  );

  // ------------------------------------------------------------ describe
  server.registerTool(
    "cin7_describe",
    {
      title: "Describe a Cin7 resource",
      description: `Get the field reference for a Cin7 Omni resource: every field name and type returned by GET, the fields accepted by POST/PUT (when different), supported operations, and usage notes. No API call is made — data comes from Cin7's official swagger spec.

Call this BEFORE constructing cin7_create/cin7_update payloads or 'fields'/'where' parameters, so field names are exact. Omit 'resource' to get a one-line summary of every resource.`,
      inputSchema: {
        resource: resourceEnum().optional().describe("Resource to describe; omit for a catalog of all resources"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ resource }) => {
      if (!resource) {
        return ok({
          base_url: config.baseUrl,
          rate_limits: "3 calls/sec, 60 calls/min, 5000 calls/day (enforced by Cin7; this server queues/retries)",
          resources: RESOURCE_KEYS.map(summaryLine),
          product_images:
            "Product images are uploaded with the dedicated cin7_upload_product_image tool (multipart upload).",
        });
      }
      const def = RESOURCES[resource];
      const fieldInfo = FIELD_REFERENCE[def.fieldKey ?? resource] ?? {};
      return ok({
        resource,
        endpoint: `${config.baseUrl}/${def.path}`,
        operations: def.verbs,
        id_lookup: `GET by ${def.idName} (${def.idType})`,
        description: def.description,
        ...(def.supportsLoadBoms
          ? { loadboms: "POST/PUT accept loadBoms=true to auto-load BOM components onto order lines" }
          : {}),
        ...(def.notes ? { notes: def.notes } : {}),
        write_semantics:
          def.verbs.includes("create") || def.verbs.includes("update")
            ? "POST/PUT take an ARRAY of records (max 250 per call). In PUT, omit or null a field to leave it unchanged; send an empty string to clear it."
            : undefined,
        ...fieldInfo,
      });
    },
  );

  if (readOnly) return;

  // -------------------------------------------------------------- create
  server.registerTool(
    "cin7_create",
    {
      title: "Create Cin7 records",
      description: `Create one or more records of a Cin7 Omni resource (POST). Writable resources: ${resourcesSupporting("create").join(", ")}.

'records' is an array of objects (max 250). Use cin7_describe first to get exact field names — Cin7 silently ignores unknown fields. Cin7 rejects the whole request (400) if a record duplicates an existing one and returns per-record success/error results otherwise.

Returns Cin7's per-record result array: [{ index, success, id, code, errors }]. A created record's new id is in 'id'.

This modifies live business data in your Cin7 account.`,
      inputSchema: {
        resource: resourceEnum("create").describe("Which Cin7 resource to create records in"),
        records: z.array(z.record(z.unknown())).min(1).max(250).describe("Array of record objects to create"),
        loadBoms: z.boolean().optional().describe("SalesOrders/Quotes/PurchaseOrders only: auto-load BOM components onto order lines"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ resource, records, loadBoms }) => {
      const bad = checkVerb(resource, "create");
      if (bad) return bad;
      try {
        const query = RESOURCES[resource].supportsLoadBoms && loadBoms !== undefined ? { loadboms: loadBoms } : undefined;
        const data = await cin7Request(config, "POST", RESOURCES[resource].path, query, records);
        return ok(data);
      } catch (err) {
        return toErrorResult(err);
      }
    },
  );

  // -------------------------------------------------------------- update
  server.registerTool(
    "cin7_update",
    {
      title: "Update Cin7 records",
      description: `Update one or more existing records of a Cin7 Omni resource (PUT). Writable resources: ${resourcesSupporting("update").join(", ")}.

'records' is an array of objects (max 250), each of which MUST include its 'id'. Field semantics: omit or null a field to leave it unchanged; send an empty string ("") to clear it. Use cin7_describe first for exact field names.

Special case — Cartons: pass 'salesOrderId' (the PUT goes to /v1/Cartons/{salesOrderId}) and 'records' holds that order's cartons.

Returns Cin7's per-record result array: [{ index, success, id, code, errors }].

This modifies live business data in your Cin7 account.`,
      inputSchema: {
        resource: resourceEnum("update").describe("Which Cin7 resource to update records in"),
        records: z.array(z.record(z.unknown())).min(1).max(250).describe("Array of record objects to update (each must include its id)"),
        loadBoms: z.boolean().optional().describe("SalesOrders/Quotes/PurchaseOrders only: auto-load BOM components onto order lines"),
        salesOrderId: z.number().int().optional().describe("Cartons only: the sales order whose cartons are being updated"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ resource, records, loadBoms, salesOrderId }) => {
      const bad = checkVerb(resource, "update");
      if (bad) return bad;
      try {
        const def = RESOURCES[resource];
        let path = def.path;
        if (def.updateRequiresId) {
          if (salesOrderId === undefined) {
            return fail(`Updating ${resource} requires 'salesOrderId' (the PUT goes to /${def.path}/{salesOrderId}).`);
          }
          path = `${def.path}/${salesOrderId}`;
        }
        const query = def.supportsLoadBoms && loadBoms !== undefined ? { loadboms: loadBoms } : undefined;
        const data = await cin7Request(config, "PUT", path, query, records);
        return ok(data);
      } catch (err) {
        return toErrorResult(err);
      }
    },
  );

  // -------------------------------------------------------------- delete
  server.registerTool(
    "cin7_delete",
    {
      title: "Delete a Cin7 record",
      description: `Permanently delete a single Cin7 Omni record by id. The Cin7 API only supports DELETE for: ${resourcesSupporting("delete").join(", ")}.

This is irreversible and removes live business data — double-check the id (e.g. via cin7_get) before deleting.`,
      inputSchema: {
        resource: resourceEnum("delete").describe("Which Cin7 resource to delete from"),
        id: z.number().int().describe("Numeric id of the record to delete"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ resource, id }) => {
      const bad = checkVerb(resource, "delete");
      if (bad) return bad;
      try {
        const data = await cin7Request(config, "DELETE", `${RESOURCES[resource].path}/${id}`);
        return ok(data ?? { success: true, deleted: { resource, id } });
      } catch (err) {
        return toErrorResult(err);
      }
    },
  );

  // ------------------------------------------------- product image upload
  server.registerTool(
    "cin7_upload_product_image",
    {
      title: "Upload a product image",
      description: `Upload an image file to a Cin7 Omni product (POST /v1/ProductImages, multipart upload).

Provide the image either as a local file path OR as base64 data with a file name. imagePriority: 0 = main/primary image, 1–2 = additional priority slots (optional).`,
      inputSchema: {
        productId: z.number().int().describe("The Cin7 product id to attach the image to"),
        filePath: z.string().optional().describe("Path to a local image file to upload"),
        fileBase64: z.string().optional().describe("Base64-encoded image bytes (alternative to filePath)"),
        fileName: z.string().optional().describe("File name (required with fileBase64, e.g. 'front.jpg')"),
        imagePriority: z.number().int().min(0).max(2).optional().describe("0 = main image; 1-2 = additional priority"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ productId, filePath, fileBase64, fileName, imagePriority }) => {
      try {
        let bytes: Buffer;
        let name: string;
        if (filePath) {
          bytes = await readFile(filePath);
          name = fileName ?? filePath.split(/[\\/]/).pop() ?? "image.jpg";
        } else if (fileBase64) {
          if (!fileName) return fail("'fileName' is required when uploading via fileBase64.");
          bytes = Buffer.from(fileBase64, "base64");
          name = fileName;
        } else {
          return fail("Provide either 'filePath' or 'fileBase64' (+ 'fileName').");
        }
        const data = await cin7UploadProductImage(config, productId, name, bytes, imagePriority);
        return ok(data ?? { success: true, productId, fileName: name });
      } catch (err) {
        return toErrorResult(err);
      }
    },
  );
}
