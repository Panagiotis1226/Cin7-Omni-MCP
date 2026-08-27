# Cin7 Omni MCP Server

An [MCP](https://modelcontextprotocol.io) server that gives Claude full access to the [Cin7 Omni API](https://api.cin7.com/api/) — every resource and every operation the API supports:

**Contacts · Branches · Product Categories · Products · Product Options · Product Images · Size Ranges · Stock · Serial Numbers · Branch Transfers · Adjustments · Vouchers · Sales Orders (incl. cartons) · Payments · Payment Fees & Payouts · Purchase Orders · Quotes · Credit Notes · BOM Masters (v1 & v2) · Production Jobs · Users · Cartons**

The verb matrix (which resources can be listed, fetched, created, updated or deleted) is taken from Cin7's official swagger spec and enforced by the server, so Claude can never attempt an operation the API doesn't support.

## Tools

| Tool | What it does |
|---|---|
| `cin7_list` | List/search any resource with `where` filters, field selection, ordering and pagination |
| `cin7_get` | Fetch a single record by id (barcode for Stock, voucher code for Vouchers) |
| `cin7_describe` | Field reference for any resource (from Cin7's swagger) — no API call, use before writing |
| `cin7_create` | Create records (POST, array payload) |
| `cin7_update` | Update records (PUT; `null` = leave unchanged, `""` = clear) |
| `cin7_delete` | Delete a record (Cin7 only allows this for Contacts and Payments) |
| `cin7_upload_product_image` | Upload an image file to a product (multipart) |

Reads and writes are separate tools with proper MCP annotations (`readOnlyHint`, `destructiveHint`), so in Claude you can set each write tool to **Always allow**, **Ask each time**, or **Deny** independently of reads.

## Install in Claude Desktop (3 steps, no config editing)

1. **Get your Cin7 API credentials** — in Cin7 Omni: **Settings (⚙) → Integrations → API v1 → Add API Connection**. This gives you an **API Username** and **API Key** (Basic-auth credentials, not your Cin7 login). Grant the connection permission to the modules you want Claude to reach — a module without permission returns 403.
2. **Download** [`dist/cin7-omni.mcpb`](dist/cin7-omni.mcpb) — one file, ~150 KB.
3. **Open it** — double-click the file (or in Claude Desktop: Settings → Extensions → drag the file in) and click **Install**. Paste the API Username and API Key when prompted; the key is stored in your computer's keychain, never in a file. There's also a **Read-only mode** toggle if you want Claude locked to lookups only.

Then ask Claude something like *"describe the Cin7 SalesOrders resource"* to confirm it works.

To remove it later: Claude Desktop → Settings → Extensions → Cin7 Omni → Uninstall.

## Other ways to run it

A prebuilt, self-contained server also ships in the repo (`dist/index.js` — all dependencies bundled in), so cloning is enough to run it: no `npm install`, no build step. `git pull` always gets you the latest ready-to-test build.

```bash
git clone https://github.com/panagiotis1226/cin7-omni-mcp.git
```

Only if you edit the source yourself: `npm install` (which auto-builds) or `npm run build` to rebuild.

**Claude Code**:

```bash
claude mcp add cin7-omni \
  -e CIN7_API_USERNAME=YourApiUsername \
  -e CIN7_API_KEY=your-api-key \
  -- node /absolute/path/to/cin7-omni-mcp/dist/index.js
```

**Claude Desktop (manual config)** — add to `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "cin7-omni": {
      "command": "node",
      "args": ["/absolute/path/to/cin7-omni-mcp/dist/index.js"],
      "env": {
        "CIN7_API_USERNAME": "YourApiUsername",
        "CIN7_API_KEY": "your-api-key"
      }
    }
  }
}
```

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `CIN7_API_USERNAME` | yes | API connection username |
| `CIN7_API_KEY` | yes | API connection key |
| `CIN7_READ_ONLY` | no | `true` = only register read tools (`cin7_list`/`cin7_get`/`cin7_describe`) |
| `CIN7_BASE_URL` | no | Override API base URL (default `https://api.cin7.com/api`) |

## Controlling write access

Two layers:

1. **Claude's per-tool permissions** — when Claude first calls `cin7_create`, `cin7_update`, `cin7_delete` or `cin7_upload_product_image`, you're prompted and can choose *allow once*, *always allow*, or *deny* per tool (in Claude Code, manage these under `/permissions`).
2. **Hard server-side lock** — set `CIN7_READ_ONLY=true` and the write tools aren't registered at all.

## Rate limits

Cin7 enforces **3 calls/second, 60/minute, 5,000/day**. The server queues requests client-side to stay under the per-second/minute limits and automatically retries on 429/5xx with backoff, so large multi-page scans are slow by design. Use `where` filters (e.g. `modifiedDate>='...'`) and the `fields` parameter to minimize calls.

## Example prompts

- *"How much stock of CTS001 do we have across branches?"* → `cin7_list` on Stock with `where: "code='CTS001'"`
- *"Show me sales orders dispatched this week over $500"* → `cin7_list` on SalesOrders with a `where` filter
- *"Create a purchase order for supplier X with these lines…"* → `cin7_describe` PurchaseOrders, then `cin7_create`
- *"What fields does a Contact have?"* → `cin7_describe` Contacts

## Development

```bash
npm test           # builds, then runs the stdio smoke test against a mock Cin7 API
npm run build:mcpb # rebuild + validate manifest + repack dist/cin7-omni.mcpb
npm run dev        # run from source with tsx
```

The build emits two bundles from the same source: `dist/index.js` (ESM, for clone-and-run / Claude Code) and `server/index.cjs` (CJS, packed into the `.mcpb` extension).

`src/fieldReference.ts` is generated from Cin7's official swagger spec by `scripts/gen_fields.py` (expects `swagger.json` from `https://api.cin7.com/api/swagger/v1/swagger.json` in the working directory) — regenerate if Cin7 updates their API.

## Not covered

- Cin7 Omni webhooks (push notifications) — this server is request/response only.
- Anything Cin7 doesn't expose via the v1/v2 API.
- Remote/HTTP deployment — this is a local stdio server; a streamable-HTTP entrypoint could be added later.
