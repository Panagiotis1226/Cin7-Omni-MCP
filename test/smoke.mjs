// Smoke test for the Cin7 Omni MCP server:
// 1. starts a mock Cin7 API (http://127.0.0.1:PORT/api)
// 2. drives the built server over stdio with JSON-RPC
// 3. exercises tools/list, list/get/create happy paths, verb rejection,
//    429 retry, describe, and read-only mode.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import assert from "node:assert";

let hits429 = 0;
const mock = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const send = (code, body) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const auth = req.headers.authorization ?? "";
  if (auth !== "Basic " + Buffer.from("testuser:testkey").toString("base64")) {
    return send(401, { error: "unauthorized" });
  }
  if (url.pathname === "/api/v1/Products" && req.method === "GET") {
    return send(200, [
      { id: 1, name: "Mattress", styleCode: "MAT1" },
      { id: 2, name: "Pillow", styleCode: "PIL1" },
    ]);
  }
  if (url.pathname === "/api/v1/Products/1" && req.method === "GET") {
    return send(200, { id: 1, name: "Mattress" });
  }
  if (url.pathname === "/api/v1/Contacts" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const records = JSON.parse(body);
      send(200, records.map((r, index) => ({ index, success: true, id: 100 + index })));
    });
    return;
  }
  if (url.pathname === "/api/v1/Stock" && req.method === "GET") {
    // fail twice with 429 then succeed, to prove retry works
    hits429++;
    if (hits429 <= 2) {
      res.writeHead(429, { "Retry-After": "1" });
      return res.end("rate limited");
    }
    return send(200, [{ productId: 1, stockOnHand: 42, branchId: 5 }]);
  }
  send(404, { error: "not found " + req.method + " " + url.pathname });
});

function rpcClient(env) {
  const child = spawn("node", ["dist/index.js"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buf = "";
  const pending = new Map();
  child.stdout.on("data", (d) => {
    buf += d.toString();
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    }
  });
  let nextId = 1;
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      setTimeout(() => reject(new Error("timeout on " + method)), 30000).unref();
    });
  const notify = (method, params = {}) =>
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  return { child, call, notify };
}

async function initClient(env) {
  const c = rpcClient(env);
  const init = await c.call("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke", version: "0" },
  });
  assert(init.result.serverInfo.name === "cin7-omni-mcp-server");
  c.notify("notifications/initialized");
  return c;
}

const toolText = (r) => r.result.content[0].text;

await new Promise((r) => mock.listen(0, "127.0.0.1", r));
const port = mock.address().port;
const baseEnv = {
  CIN7_API_USERNAME: "testuser",
  CIN7_API_KEY: "testkey",
  CIN7_BASE_URL: `http://127.0.0.1:${port}/api`,
};

// ---- full read/write server ----
const c = await initClient(baseEnv);

const tools = (await c.call("tools/list")).result.tools;
const names = tools.map((t) => t.name).sort();
console.log("tools:", names.join(", "));
assert.deepEqual(names, [
  "cin7_create",
  "cin7_delete",
  "cin7_describe",
  "cin7_get",
  "cin7_list",
  "cin7_update",
  "cin7_upload_product_image",
]);
const listTool = tools.find((t) => t.name === "cin7_list");
assert(listTool.annotations.readOnlyHint === true);
assert(tools.find((t) => t.name === "cin7_delete").annotations.destructiveHint === true);
assert(listTool.inputSchema.properties.resource.enum.length === 23);
assert.deepEqual(
  tools.find((t) => t.name === "cin7_delete").inputSchema.properties.resource.enum.sort(),
  ["Contacts", "Payments"],
);

// list happy path
let r = await c.call("tools/call", { name: "cin7_list", arguments: { resource: "Products", rows: 50 } });
let parsed = JSON.parse(toolText(r));
assert(parsed.count === 2 && parsed.items[0].name === "Mattress" && parsed.has_more === false);
console.log("cin7_list Products OK");

// get happy path
r = await c.call("tools/call", { name: "cin7_get", arguments: { resource: "Products", id: 1 } });
assert(JSON.parse(toolText(r)).name === "Mattress");
console.log("cin7_get Products/1 OK");

// create happy path (array body)
r = await c.call("tools/call", {
  name: "cin7_create",
  arguments: { resource: "Contacts", records: [{ firstName: "Jane", type: "Customer" }] },
});
assert(JSON.parse(toolText(r))[0].success === true && JSON.parse(toolText(r))[0].id === 100);
console.log("cin7_create Contacts OK");

// verb rejection: delete on Products isn't in the enum -> schema error; also check update on Stock
r = await c.call("tools/call", { name: "cin7_update", arguments: { resource: "Stock", records: [{ id: 1 }] } });
assert(r.result.isError || toolText(r).includes("Invalid"), "expected rejection");
console.log("verb rejection (update Stock) OK:", toolText(r).slice(0, 90).replace(/\n/g, " "));

// 429 retry: first two mock responses are 429, third succeeds
r = await c.call("tools/call", { name: "cin7_list", arguments: { resource: "Stock" } });
parsed = JSON.parse(toolText(r));
assert(parsed.items[0].stockOnHand === 42 && hits429 === 3);
console.log("429 retry OK (server retried transparently)");

// describe
r = await c.call("tools/call", { name: "cin7_describe", arguments: { resource: "SalesOrders" } });
parsed = JSON.parse(toolText(r));
assert(parsed.operations.includes("create") && parsed.responseFields.lineItems);
r = await c.call("tools/call", { name: "cin7_describe", arguments: {} });
assert(JSON.parse(toolText(r)).resources.length === 24);
console.log("cin7_describe OK");

c.child.kill();

// ---- read-only mode ----
const ro = await initClient({ ...baseEnv, CIN7_READ_ONLY: "true" });
const roNames = (await ro.call("tools/list")).result.tools.map((t) => t.name).sort();
assert.deepEqual(roNames, ["cin7_describe", "cin7_get", "cin7_list"]);
console.log("read-only mode OK:", roNames.join(", "));
ro.child.kill();

mock.close();
console.log("\nALL SMOKE TESTS PASSED");
