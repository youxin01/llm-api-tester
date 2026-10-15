const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

async function page({ keyError = null, extraEndpoints = [], history = [], testRequest = null,
  historyError = false, preference = null, language = null, capabilities = null } = {}) {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]));
  const elements = new Map();
  const requests = [];
  const copied = [];
  const storage = new Map(preference ? [["relay.endpointView", preference]] : []);
  if (language) storage.set("relay.language", language);
  const staticNodes = [...html.matchAll(/<([a-z][\w-]*)\b([^>]*\bdata-i18n(?:-|=)[^>]*)>/g)].map(match => {
    const attrs = Object.fromEntries([...match[2].matchAll(/([\w-]+)=(?:"([^"]*)"|'([^']*)')/g)]
      .map(attr => [attr[1], attr[2] ?? attr[3]]));
    return { attrs, dataset: { i18n: attrs["data-i18n"] },
      getAttribute(name) { return this.attrs[name]; },
      setAttribute(name, value) { this.attrs[name] = value; } };
  });
  const records = [...history];
  let testCalls = 0;
  const saved = { id: "test-id", name: "Test", base_url: "https://example.test",
    model: "test-model", api_key_hint: "sk-***inal" };
  function getElement(id) {
    assert.ok(ids.has(id), `Missing production HTML element: ${id}`);
    if (!elements.has(id)) elements.set(id, {
      value: "", type: "password", open: false, listeners: {},
      classList: { values: new Set(), add(name) { this.values.add(name); },
        remove(name) { this.values.delete(name); }, contains(name) { return this.values.has(name); } },
      addEventListener(name, handler) { this.listeners[name] = handler; },
      setAttribute(name, value) { this[name] = value; },
      options: [...(html.match(new RegExp('<select id="' + id + '"[^>]*>([\\s\\S]*?)</select>'))?.[1] || "")
        .matchAll(/<option value="([^"]*)"/g)].map(match => ({value: match[1], disabled: false})),
      querySelector() { return null; },
      showModal() { this.open = true; },
      scrollIntoView() {},
      close() { this.open = false; this.listeners.close?.(); },
      reset() { for (const element of elements.values()) element.value = ""; },
    });
    return elements.get(id);
  }
  const context = vm.createContext({
    document: { getElementById: getElement, documentElement: {lang: "zh-CN"},
      querySelectorAll(selector) { return staticNodes.filter(node => selector.slice(1, -1) in node.attrs); } },
    window: {}, console,
    localStorage: { getItem(key) { return storage.get(key) ?? null; },
      setItem(key, value) { storage.set(key, value); } },
    navigator: { clipboard: { async writeText(value) { copied.push(value); } } },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith("/api-key") && keyError) throw new Error(keyError);
      if (url.startsWith("/api/history") && historyError && testCalls) throw new Error("history offline");
      if (url.startsWith("/api/test/")) {
        testCalls++;
        const ep = [saved, ...extraEndpoints].find(ep => url.endsWith("/" + ep.id));
        const data = testRequest ? await testRequest(ep) : {
          id: "result-" + ep.id, endpoint_id: ep.id, endpoint_name: ep.name,
          requested_model: ep.model, ok: true, model_match: true, http_status: 200, content: "OK",
        };
        records.unshift(data);
        return { ok: true, async text() { return JSON.stringify(data); } };
      }
      const data = url.endsWith("/api-key") ? { api_key: "sk-test-original" }
        : url === "/api/generation-capabilities" ? capabilities || []
        : url === "/api/endpoints" ? [saved, ...extraEndpoints]
        : url.startsWith("/api/history") ? records : [];
      return { ok: true, async text() { return JSON.stringify(data); } };
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "i18n.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "app.js"), "utf8"), context);
  await vm.runInContext("loadAll()", context);
  return { context, getElement, requests, copied, storage, staticNodes };
}

test("entered key can be shown, hidden, and copied without changing its value", async () => {
  const p = await page();
  vm.runInContext("openAdd()", p.context);
  p.getElement("apiKey").value = "sk-test-entered";
  await p.getElement("toggleApiKeyBtn").listeners.click();
  assert.equal(p.getElement("apiKey").type, "text");
  assert.equal(p.getElement("toggleApiKeyBtn").textContent, "隐藏");
  await p.getElement("toggleApiKeyBtn").listeners.click();
  assert.equal(p.getElement("apiKey").type, "password");
  await p.getElement("copyApiKeyBtn").listeners.click();
  assert.deepEqual(p.copied, ["sk-test-entered"]);
  assert.equal(p.getElement("apiKey").value, "sk-test-entered");
});

test("saved key is fetched on demand, copied in full, and replaceable", async () => {
  const p = await page();
  vm.runInContext('openEdit("test-id")', p.context);
  assert.equal(p.getElement("apiKey").value, "");
  await p.getElement("copyApiKeyBtn").listeners.click();
  assert.deepEqual(p.copied, ["sk-test-original"]);
  await p.getElement("toggleApiKeyBtn").listeners.click();
  assert.equal(p.getElement("apiKey").type, "text");
  p.getElement("apiKey").value = "sk-test-replacement";
  await vm.runInContext("saveEndpoint({ preventDefault() {} })", p.context);
  const save = p.requests.find(r => r.options.method === "PUT");
  assert.equal(JSON.parse(save.options.body).api_key, "sk-test-replacement");
  assert.equal(p.getElement("apiKey").value, "");
  assert.equal(p.getElement("apiKey").type, "password");
});

test("copying an empty new key gives a message and does not write the clipboard", async () => {
  const p = await page();
  vm.runInContext("openAdd()", p.context);
  await p.getElement("copyApiKeyBtn").listeners.click();
  assert.deepEqual(p.copied, []);
  assert.match(p.getElement("apiKeyMessage").textContent, /没有 API Key/);
  assert.equal(p.getElement("copyApiKeyBtn").disabled, false);
});

test("failed saved-key fetch shows an adjacent error and leaves buttons usable", async () => {
  const p = await page({ keyError: "Failed to fetch" });
  vm.runInContext('openEdit("test-id")', p.context);
  await p.getElement("toggleApiKeyBtn").listeners.click();
  assert.match(p.getElement("apiKeyMessage").textContent, /Failed to fetch/);
  assert.match(p.getElement("apiKeyMessage").textContent, /重启 Python 服务/);
  assert.equal(p.getElement("toggleApiKeyBtn").disabled, false);
  assert.equal(p.getElement("copyApiKeyBtn").disabled, false);
});

test("search and filtering preserve selections across rendering and refresh", async () => {
  const p = await page({ extraEndpoints: [
    { id: "deepseek", name: "DeepSeek", base_url: "https://deepseek.example", model: "deepseek-chat", enabled: true },
    { id: "local", name: "Local", base_url: "http://localhost", model: "qwen", enabled: false },
  ] });
  assert.equal(vm.runInContext("selectedIds().length", p.context), 2);
  p.getElement("endpointSearch").value = "DEEPSEEK";
  p.getElement("endpointSearch").listeners.input();
  assert.equal(vm.runInContext("visibleEndpoints().length", p.context), 1);
  assert.match(p.getElement("selectionCount").textContent, /筛选外 1 个/);
  p.getElement("selectAll").listeners.change({ target: { checked: false } });
  assert.equal(vm.runInContext("state.selected.has('deepseek')", p.context), false);
  assert.equal(vm.runInContext("state.selected.has('test-id')", p.context), true);
  p.getElement("endpointSearch").value = "";
  p.getElement("endpointFilter").value = "enabled";
  p.getElement("endpointFilter").listeners.change();
  assert.equal(vm.runInContext("visibleEndpoints().length", p.context), 2);
  await vm.runInContext("loadEndpoints()", p.context);
  assert.equal(vm.runInContext("state.selected.has('deepseek')", p.context), false);
  assert.equal(p.getElement("selectAll").indeterminate, true);
});

test("overview restores latest stored result instead of inventing live status", async () => {
  const p = await page({ history: [
    { id: "latest", endpoint_id: "test-id", endpoint_name: "Test", requested_model: "test-model", ok: false, latency_ms: 240, error: "timeout" },
    { id: "old", endpoint_id: "test-id", endpoint_name: "Test", requested_model: "test-model", ok: true, latency_ms: 90, content: "OK" },
  ] });
  p.getElement("endpointFilter").value = "failed";
  assert.equal(vm.runInContext("visibleEndpoints().length", p.context), 1);
  assert.match(p.getElement("averageLatency").innerHTML, /240/);
  assert.match(p.getElement("healthyEndpoints").innerHTML, /^0<small>\/ 1/);
  assert.equal(p.getElement("historyCount").textContent, 2);
});

test("selected and all test buttons keep their request scopes when the list is filtered", async () => {
  const p = await page({ extraEndpoints: [
    { id: "disabled", name: "Disabled", model: "qwen", enabled: false },
  ] });
  p.getElement("prompt").value = "Please reply OK.";
  p.getElement("endpointSearch").value = "no-match";
  p.getElement("endpointSearch").listeners.input();
  await p.getElement("testSelectedBtn").listeners.click();
  await p.getElement("testAllBtn").listeners.click();
  const requests = p.requests.filter(r => r.url.startsWith("/api/test/"));
  assert.deepEqual(requests.map(r => r.url), ["/api/test/test-id", "/api/test/test-id"]);
  vm.runInContext("state.selected.add('disabled')", p.context);
  await p.getElement("testSelectedBtn").listeners.click();
  assert.equal(p.requests.filter(r => r.url === "/api/test/disabled").length, 1);
  assert.equal(p.getElement("testAllBtn").disabled, false);
});

test("card/list toggle retains filters, selection and a reloadable view preference", async () => {
  const p = await page();
  await p.getElement("cardViewBtn").listeners.click();
  assert.equal(p.getElement("cardViewBtn")["aria-pressed"], "true");
  assert.equal(p.getElement("endpointListView").classList.contains("hidden"), true);
  assert.match(p.getElement("endpointCards").innerHTML, /test-model/);
  assert.doesNotMatch(p.getElement("endpointCards").innerHTML, /example\.test|sk-\*\*\*/);
  for (const action of ["testSingle", "probeModels", "openEdit", "removeEndpoint"]) {
    assert.match(p.getElement("endpointCards").innerHTML, new RegExp(action));
  }
  p.getElement("endpointCards").listeners.change({ target: { dataset: { id: "test-id" }, checked: false } });
  assert.equal(p.getElement("selectAll").checked, false);
  assert.equal(p.getElement("cardSelectAll").checked, false);
  p.getElement("endpointSearch").value = "no-match";
  p.getElement("endpointSearch").listeners.input();
  assert.match(p.getElement("endpointCards").innerHTML, /没有找到/);
  p.getElement("listViewBtn").listeners.click();
  assert.equal(p.getElement("endpointSearch").value, "no-match");
  assert.equal(vm.runInContext("selectedIds().length", p.context), 0);
  p.getElement("cardViewBtn").listeners.click();
  const reloaded = await page({ preference: p.storage.get("relay.endpointView") });
  assert.equal(reloaded.getElement("cardViewBtn")["aria-pressed"], "true");
});

test("parallel tests identify every site/model and update before the slowest completes", async () => {
  const pending = new Map();
  const p = await page({ extraEndpoints: [
    { id: "slow", name: "Slow API", base_url: "https://slow.example", model: "deepseek-v4", enabled: true },
  ], testRequest: ep => new Promise((resolve, reject) => pending.set(ep.id, { resolve, reject })) });
  p.getElement("prompt").value = "OK";
  const run = p.getElement("testAllBtn").listeners.click();
  assert.equal(pending.size, 2, "both requests start before either is resolved");
  assert.equal(p.getElement("testProgress")["aria-busy"], "true");
  assert.match(p.getElement("testProgressList").innerHTML, /Test/);
  assert.match(p.getElement("testProgressList").innerHTML, /test-model/);
  assert.match(p.getElement("testProgressList").innerHTML, /Slow API/);
  assert.match(p.getElement("testProgressList").innerHTML, /deepseek-v4/);
  await vm.runInContext('testSingle("test-id")', p.context);
  assert.equal(p.requests.filter(r => r.url.startsWith("/api/test/")).length, 2, "overlapping run ignored");
  pending.get("test-id").resolve({ id: "first", endpoint_id: "test-id", endpoint_name: "Test",
    requested_model: "test-model", returned_model: "different", model_match: false, ok: true });
  await new Promise(setImmediate);
  assert.equal(p.getElement("testProgressBar").value, 1);
  assert.match(p.getElement("testProgressList").innerHTML, /模型不一致/);
  assert.match(p.getElement("testProgressTitle").textContent, /1 个站点/);
  assert.equal(p.getElement("testAllBtn").disabled, true);
  pending.get("slow").reject(new Error("Failed to fetch"));
  await run;
  assert.equal(p.getElement("testProgressBar").value, 2);
  assert.match(p.getElement("testProgressList").innerHTML, /请求失败|Failed to fetch/);
  assert.equal(p.getElement("testProgress")["aria-busy"], "false");
  assert.equal(p.getElement("testSelectedBtn").disabled, false);
  p.getElement("endpointFilter").value = "failed";
  assert.equal(vm.runInContext("visibleEndpoints()[0].id", p.context), "slow");
  assert.match(p.getElement("endpointCards").innerHTML, /请求失败/);
  vm.runInContext("showRunDetail(1)", p.context);
  assert.match(p.getElement("detailOutcome").textContent, /请求未完成/);
});

test("single-site results keep upstream errors and survive a history refresh failure", async () => {
  const p = await page({ historyError: true, testRequest: async ep => ({
    id: "unauthorized", endpoint_id: ep.id, endpoint_name: ep.name, requested_model: ep.model,
    ok: false, http_status: 401, error: "Invalid API key", latency_ms: 80,
  }) });
  p.getElement("prompt").value = "OK";
  await vm.runInContext('testSingle("test-id")', p.context);
  assert.match(p.getElement("testProgressList").innerHTML, /Invalid API key/);
  assert.match(p.getElement("testProgressList").innerHTML, /HTTP 401/);
  assert.match(p.getElement("testHistoryWarning").textContent, /history offline/);
  assert.equal(p.getElement("testHistoryWarning").classList.contains("hidden"), false);
  assert.equal(p.getElement("testAllBtn").disabled, false);
  vm.runInContext("showRunDetail(0)", p.context);
  assert.match(p.getElement("detailContent").textContent, /Invalid API key/);
  assert.equal(p.getElement("detailDialog").open, true);
});

test("progress starts compact and expands all or failed results without changing selection", async () => {
  const p = await page({ extraEndpoints: [
    { id: "bad", name: "Quota API", model: "deepseek-v4", enabled: true },
  ], testRequest: async ep => ({ id: ep.id + "-result", endpoint_id: ep.id,
    endpoint_name: ep.name, requested_model: ep.model, ok: ep.id !== "bad",
    http_status: ep.id === "bad" ? 429 : 200,
    error: ep.id === "bad" ? "Your quota has been exhausted" : null, content: "OK" }) });
  p.getElement("prompt").value = "OK";
  await vm.runInContext("runTests()", p.context);
  assert.equal(p.getElement("testProgressList").classList.contains("hidden"), true);
  assert.equal(p.getElement("testProgressToggle")["aria-expanded"], "false");
  assert.equal(p.getElement("testActiveSummary").classList.contains("hidden"), true);
  p.getElement("testFailuresBtn").listeners.click();
  assert.equal(p.getElement("testProgressList").classList.contains("hidden"), false);
  assert.equal(p.getElement("testFailuresBtn")["aria-pressed"], "true");
  assert.match(p.getElement("testProgressList").innerHTML, /Quota API/);
  assert.doesNotMatch(p.getElement("testProgressList").innerHTML, /test-model/);
  assert.equal(vm.runInContext("selectedIds().length", p.context), 2);
  p.getElement("testProgressToggle").listeners.click();
  p.getElement("testProgressToggle").listeners.click();
  assert.match(p.getElement("testProgressList").innerHTML, /test-model/);
  assert.match(p.getElement("testProgressList").innerHTML, /deepseek-v4/);
});

test("error explanations distinguish known quota, rate limits, auth, timeout and model mismatch", async () => {
  const p = await page();
  const cases = [
    [{ ok: false, http_status: 429, error: "Your token-plan 1-month quota has been exhausted. The quota will reset at 10-19 16:00:00 UTC." }, /额度已用尽/, /重置时间/],
    [{ ok: false, http_status: 429, error: "Too many requests" }, /请求受限/, /不能仅凭 HTTP 429/],
    [{ ok: false, http_status: 401, error: "Invalid API key" }, /认证失败/, /API Key/],
    [{ ok: false, http_status: 403 }, /访问被拒绝/, /权限/],
    [{ ok: false, http_status: 503 }, /服务暂不可用/, /不一定是密钥问题/],
    [{ ok: false, error: "Request timed out after 30 seconds" }, /请求超时/, /调整超时/],
    [{ ok: false, transport_error: true, error: "Failed to fetch" }, /请求未完成/, /本地服务/],
    [{ ok: true, model_match: false }, /返回模型不同/, /不能仅凭名称/],
    [{ ok: true, model_match: true }, /接口可用/, /不代表所有模型/],
  ];
  for (const [input, title, advice] of cases) {
    const info = vm.runInContext(`resultExplanation(${JSON.stringify(input)})`, p.context);
    assert.match(info.title, title);
    assert.match(info.advice, advice);
  }
});

test("friendly details preserve raw error, copy exactly, and edit without saving", async () => {
  const error = "Your quota has been exhausted. The quota will reset at 10-19 16:00:00 UTC.";
  const p = await page({ history: [{ id: "quota", endpoint_id: "test-id", endpoint_name: "Test",
    requested_model: "test-model", http_status: 429, ok: false, error, latency_ms: 13486 }] });
  vm.runInContext('showDetail("quota")', p.context);
  assert.match(p.getElement("detailOutcome").textContent, /额度/);
  assert.equal(p.getElement("detailMessage").textContent, error);
  assert.equal(p.getElement("rawDetails").open, false);
  assert.match(p.getElement("detailContent").textContent, /10-19 16:00:00 UTC/);
  assert.match(p.getElement("detailFacts").innerHTML, /13.5 秒/);
  await p.getElement("detailCopyBtn").listeners.click();
  assert.equal(p.copied.at(-1), error);
  p.getElement("detailEditBtn").listeners.click();
  assert.equal(p.getElement("detailDialog").open, false);
  assert.equal(p.getElement("endpointDialog").open, true);
  assert.equal(p.getElement("endpointId").value, "test-id");
  assert.equal(p.requests.some(request => request.options?.method === "PUT"), false);
});

test("success detail and probe detail do not leak each other's display state", async () => {
  const p = await page({ history: [{ id: "success", endpoint_id: "test-id", endpoint_name: "Test",
    requested_model: "test-model", returned_model: "test-model", ok: true, content: "An exact reply." }] });
  vm.runInContext('showDetail("success")', p.context);
  assert.equal(p.getElement("detailCopyBtn").textContent, "复制回复");
  assert.equal(p.getElement("detailEditBtn").classList.contains("hidden"), true);
  await p.getElement("detailCopyBtn").listeners.click();
  assert.equal(p.copied.at(-1), "An exact reply.");
  p.getElement("detailDialog").close();
  vm.runInContext('showModelProbeResult({auth_status:"accepted",ok:true,http_status:200,models:["qwen"]},"Demo")', p.context);
  assert.equal(p.getElement("testResultSummary").classList.contains("hidden"), true);
  assert.equal(p.getElement("rawDetails").open, true);
  assert.match(p.getElement("detailContent").textContent, /qwen/);
});

test("card and list status buttons open the latest saved result without making requests", async () => {
  const p = await page({ history: [
    { id: "newest", endpoint_id: "test-id", endpoint_name: "Test", requested_model: "new-model", ok: false, http_status: 503, error: "Latest failure" },
    { id: "older", endpoint_id: "test-id", endpoint_name: "Test", requested_model: "old-model", ok: true, content: "Old reply" },
  ] });
  for (const id of ["endpointBody", "endpointCards"]) {
    assert.match(p.getElement(id).innerHTML, /<button[^>]+class="badge status-link bad"/);
    assert.match(p.getElement(id).innerHTML, /showEndpointResult\('test-id'\)/);
    assert.match(p.getElement(id).innerHTML, /查看 Test 最近测试详情/);
  }
  const before = p.requests.length;
  vm.runInContext('showEndpointResult("test-id")', p.context);
  assert.equal(p.getElement("detailMessage").textContent, "Latest failure");
  assert.match(p.getElement("detailFacts").innerHTML, /new-model/);
  assert.doesNotMatch(p.getElement("detailFacts").innerHTML, /old-model/);
  assert.equal(p.requests.length, before);
  p.getElement("detailDialog").close();
  await vm.runInContext("loadHistory()", p.context);
  vm.runInContext('showEndpointResult("test-id")', p.context);
  assert.equal(p.getElement("detailMessage").textContent, "Latest failure");
});

test("just-completed success and mismatch statuses use the same current result as their details", async () => {
  const p = await page({ testRequest: async ep => ({ id: "new", endpoint_id: ep.id,
    endpoint_name: ep.name, requested_model: ep.model, returned_model: "alias-model",
    model_match: false, ok: true, content: "Current reply" }) });
  p.getElement("prompt").value = "OK";
  await vm.runInContext('testSingle("test-id")', p.context);
  assert.match(p.getElement("endpointCards").innerHTML, /badge status-link warn/);
  vm.runInContext('showEndpointResult("test-id")', p.context);
  assert.equal(p.getElement("detailMessage").textContent, "Current reply");
  assert.match(p.getElement("detailOutcome").textContent, /返回模型不同/);
  vm.runInContext("state.latest.get('test-id').model_match = true; renderEndpoints()", p.context);
  assert.match(p.getElement("endpointCards").innerHTML, /badge status-link good/);
});

test("untested/running statuses are not links, and transport failures open full context", async () => {
  let rejectRequest;
  const p = await page({ testRequest: () => new Promise((resolve, reject) => { rejectRequest = reject; }) });
  assert.doesNotMatch(p.getElement("endpointCards").innerHTML, /status-link/);
  vm.runInContext('showEndpointResult("test-id")', p.context);
  assert.equal(p.getElement("detailDialog").open, false);
  p.getElement("prompt").value = "OK";
  const run = vm.runInContext('testSingle("test-id")', p.context);
  assert.match(p.getElement("endpointCards").innerHTML, /测试中/);
  assert.doesNotMatch(p.getElement("endpointCards").innerHTML, /status-link/);
  vm.runInContext('showEndpointResult("test-id")', p.context);
  assert.equal(p.getElement("detailDialog").open, false);
  rejectRequest(new Error("Failed to fetch"));
  await run;
  vm.runInContext('showEndpointResult("test-id")', p.context);
  assert.match(p.getElement("detailOutcome").textContent, /请求未完成/);
  assert.match(p.getElement("detailFacts").innerHTML, /test-model|example.test/);
  assert.equal(p.getElement("detailMessage").textContent, "Failed to fetch");
});

test("manual add has its own editable default and no remaining configuration importer", async () => {
  const p = await page();
  vm.runInContext("openAdd()", p.context);
  assert.equal(p.getElement("model").value, "gpt-5.6-sol");
  p.getElement("model").value = "deepseek-chat";
  assert.equal(p.getElement("model").value, "deepseek-chat");
  for (const file of ["index.html", "app.js"]) {
    const source = fs.readFileSync(path.join(__dirname, file), "utf8");
    assert.doesNotMatch(source, /CodexConfig|codex_config|importCodex|importSettings|codexConfig/);
  }
  for (const file of ["codex_config.js", "codex_config.test.cjs"]) {
    assert.equal(fs.existsSync(path.join(__dirname, file)), false);
  }
});

test("saved English preference translates static and dynamic UI through production scripts", async () => {
  const p = await page({ language: "en" });
  assert.equal(p.context.document.documentElement.lang, "en");
  assert.equal(p.getElement("languageSelect").value, "en");
  assert.match(p.getElement("connectionStatus").innerHTML, /Connected/);
  assert.match(p.getElement("endpointCards").innerHTML, /Untested/);
  assert.match(p.getElement("selectionCount").textContent, /Selected: 1/);
  assert.equal(p.staticNodes.find(node => node.dataset.i18n === "新增站点").textContent, "Add connection");
  assert.equal(p.staticNodes.find(node => node.attrs["data-i18n-placeholder"] === "搜索站点、URL 或模型…")
    .attrs.placeholder, "Search name, URL or model…");
  assert.equal(vm.runInContext('durationText(2200)', p.context), "2.2 s");
  for (const node of p.staticNodes) {
    for (const [attr, key] of Object.entries(node.attrs)) {
      if (attr === "data-i18n" || attr.startsWith("data-i18n-")) {
        assert.equal(vm.runInContext(`Object.hasOwn(ENGLISH, ${JSON.stringify(key)})`, p.context), true, key);
      }
    }
  }
  const js = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  for (const match of js.matchAll(/\bt\((?:"([^"\n]+)"|'([^'\n]+)')/g)) {
    const key = match[1] ?? match[2];
    assert.equal(vm.runInContext(`Object.hasOwn(ENGLISH, ${JSON.stringify(key)})`, p.context), true, key);
  }
});

test("language switch preserves an unsaved form, key visibility, filters and custom prompt", async () => {
  const p = await page();
  vm.runInContext('openEdit("test-id")', p.context);
  p.getElement("name").value = "自定义连接";
  p.getElement("baseUrl").value = "https://private.example/v1";
  p.getElement("apiKey").value = "sk-test-unsaved";
  p.getElement("model").value = "自定义模型";
  await p.getElement("toggleApiKeyBtn").listeners.click();
  p.getElement("prompt").value = "保留我的中文 Prompt";
  p.getElement("prompt").listeners.input();
  p.getElement("endpointSearch").value = "Test";
  p.getElement("endpointFilter").value = "enabled";
  const requests = p.requests.length;
  p.getElement("languageSelect").listeners.change({ target: {value: "en"} });
  assert.equal(p.storage.get("relay.language"), "en");
  assert.equal(p.getElement("endpointDialog").open, true);
  assert.equal(p.getElement("name").value, "自定义连接");
  assert.equal(p.getElement("model").value, "自定义模型");
  assert.equal(p.getElement("baseUrl").value, "https://private.example/v1");
  assert.equal(p.getElement("apiKey").value, "sk-test-unsaved");
  assert.equal(p.getElement("apiKey").type, "text");
  assert.equal(p.getElement("toggleApiKeyBtn").textContent, "Hide");
  assert.equal(p.getElement("apiKeyMessage").textContent, "Full API key shown.");
  assert.equal(p.getElement("prompt").value, "保留我的中文 Prompt");
  assert.equal(p.getElement("endpointSearch").value, "Test");
  assert.equal(vm.runInContext("selectedIds().length", p.context), 1);
  assert.equal(p.requests.length, requests);
  vm.runInContext('changeLanguage("zh-CN")', p.context);
  assert.equal(p.getElement("toggleApiKeyBtn").textContent, "隐藏");
  assert.equal(p.getElement("apiKey").value, "sk-test-unsaved");
});

test("switching a running test keeps the request and renders completion in the new language", async () => {
  let complete;
  const p = await page({testRequest: ep => new Promise(resolve => { complete = () => resolve({
    id: "language-run", endpoint_id: ep.id, endpoint_name: ep.name, requested_model: ep.model,
    ok: false, http_status: 401, error: "服务原文：密钥无效", latency_ms: 95,
  }); })});
  p.getElement("prompt").value = "自定义内容";
  const run = vm.runInContext('testSingle("test-id")', p.context);
  vm.runInContext('changeLanguage("en")', p.context);
  assert.equal(p.requests.filter(r => r.url.startsWith("/api/test/")).length, 1);
  assert.match(p.getElement("testProgressTitle").textContent, /Testing connections: 1/);
  assert.match(p.getElement("testAllBtn").innerHTML, /Testing/);
  complete();
  await run;
  assert.equal(p.getElement("testProgressTitle").textContent, "Test run complete");
  assert.match(p.getElement("testStatus").textContent, /1 failed/);
  vm.runInContext('showEndpointResult("test-id")', p.context);
  assert.equal(p.getElement("detailOutcome").textContent, "Authentication failed");
  assert.equal(p.getElement("detailMessage").textContent, "服务原文：密钥无效");
  p.getElement("rawDetails").open = true;
  vm.runInContext('changeLanguage("zh-CN")', p.context);
  assert.equal(p.getElement("detailOutcome").textContent, "认证失败");
  assert.equal(p.getElement("rawDetails").open, true);
  await p.getElement("detailCopyBtn").listeners.click();
  assert.equal(p.copied.at(-1), "服务原文：密钥无效");
});

test("probe details follow language while the original pelican prompt and raw results stay unchanged", async () => {
  const p = await page();
  vm.runInContext('showModelProbeResult({auth_status:"rejected",ok:false,http_status:401,error:"原始报错",raw_response:{message:"原始报错"}},"中文站点")', p.context);
  vm.runInContext('changeLanguage("en")', p.context);
  assert.match(p.getElement("detailTitle").textContent, /Key and model check: 中文站点/);
  assert.match(p.getElement("detailContent").textContent, /Authentication: Rejected/);
  assert.match(p.getElement("detailContent").textContent, /原始报错/);
  assert.match(p.getElement("prompt").value, /knowledge cutoff/);
  p.getElement("pelicanPromptBtn").listeners.click();
  assert.equal(p.getElement("prompt").value, "创建一个 HTML，内容是 SVG 绘制一个鹈鹕骑自行车的 2D 动画");
  vm.runInContext('changeLanguage("zh-CN")', p.context);
  assert.equal(p.getElement("prompt").value, "创建一个 HTML，内容是 SVG 绘制一个鹈鹕骑自行车的 2D 动画");
  assert.match(p.getElement("detailContent").textContent, /认证状态：拒绝/);
  vm.runInContext('showModelProbeResult({auth_status:"unknown",ok:true,models:[]},null); changeLanguage("en")', p.context);
  assert.equal(p.getElement("detailTitle").textContent, "Key and model check: Unsaved connection");
});

test("editing invokes capability loading and disables unsupported thinking values", async () => {
  const p = await page({capabilities: {allowed_efforts:["", "none", "enabled"],switch_only:true}});
  vm.runInContext('openEdit("test-id")', p.context);
  assert.ok(p.requests.some(request => request.url === "/api/generation-capabilities"));
  await new Promise(resolve => setImmediate(resolve));
  const choices = p.getElement("endpointReasoningEffort").options;
  assert.equal(choices.find(option => option.value === "high").disabled, true);
  assert.equal(choices.find(option => option.value === "none").disabled, false);
  assert.match(p.getElement("endpointReasoningHint").textContent, /不支持强度档位/);
});

test("global stream override is included in the actual test payload", async () => {
  const p = await page();
  p.getElement("prompt").value = "OK";
  p.getElement("reasoningEffort").value = "none";
  p.getElement("streamMode").value = "true";
  await p.getElement("testSelectedBtn").listeners.click();
  const request = p.requests.find(item => item.url.startsWith("/api/test/"));
  const body = JSON.parse(request.options.body);
  assert.equal(body.stream, true);
  assert.equal(body.reasoning_effort, "none");
  assert.equal(body.max_tokens, null);
});

test("disconnect detail preserves partial HTML for preview and does not imply a bad key", async () => {
  const p = await page({history:[{id:"partial",endpoint_id:"test-id",endpoint_name:"Test",
    ok:false,http_status:200,error_code:"upstream_disconnected",error:"RemoteProtocolError",
    content:"<html><svg>partial</svg>"}]});
  vm.runInContext('showEndpointResult("test-id")', p.context);
  assert.equal(p.getElement("detailOutcome").textContent, "响应未完整返回");
  assert.equal(p.getElement("detailPartial").classList.contains("hidden"), false);
  assert.equal(p.getElement("detailPartialContent").textContent, "<html><svg>partial</svg>");
  assert.equal(p.getElement("detailPreviewBtn").classList.contains("hidden"), false);
  assert.match(p.getElement("detailAdvice").textContent, /不能据此认定密钥失效/);
});
