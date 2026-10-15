const state = {
  endpoints: [],
  latest: new Map(),
  history: [],
  selected: new Set(),
  endpointView: readEndpointView(),
  testRun: null,
  detailResult: null,
  customPrompts: readCustomPrompts(),
  activeCustomPrompt: null,
  previewHtml: "",
  modelProbe: null,
  connection: "正在连接",
  loadError: null,
  promptPreset: "不要联网搜索，你的模型知识库截止到什么时间？请只根据模型自身知识回答。",
};

function readEndpointView() {
  try { return localStorage.getItem("relay.endpointView") === "cards" ? "cards" : "list"; }
  catch { return "list"; }
}

const $ = (id) => document.getElementById(id);
const DEFAULT_TEST_MODEL = "gpt-5.6-sol";
const PELICAN_PROMPT = "创建一个 HTML，内容是 SVG 绘制一个鹈鹕骑自行车的 2D 动画";

const messages = new Map();

function setMessage(id, render) {
  messages.set(id, render);
  $(id).textContent = render();
}

function setConnection(key) {
  state.connection = key;
  $("connectionStatus").innerHTML = `<span class="dot"></span>${t(key)}`;
}

const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="#i-` + name + '"/></svg>';


function readCustomPrompts() {
  try {
    const prompts = JSON.parse(localStorage.getItem("relay.customPrompts") || "[]");
    return Array.isArray(prompts) ? prompts : [];
  } catch { return []; }
}

function renderPromptPresets() {
  $("promptPresetBtn").setAttribute("aria-pressed", String(Boolean(state.promptPreset)));
  $("pelicanPromptBtn").setAttribute("aria-pressed", String(!state.activeCustomPrompt && $("prompt").value === PELICAN_PROMPT));
  $("customPromptButtons").innerHTML = state.customPrompts.map(item =>
    `<button type="button" class="preset-btn" data-prompt-id="${escapeHtml(item.id)}" aria-pressed="${state.activeCustomPrompt === item.id}">${escapeHtml(item.name)}</button>`
  ).join("");
}

function applyPrompt(id) {
  const item = state.customPrompts.find(prompt => prompt.id === id);
  if (!item) return;
  state.promptPreset = null;
  state.activeCustomPrompt = id;
  $("prompt").value = item.content;
  renderPromptPresets();
}

function renderPromptEditorOptions() {
  const selected = $("promptEditorSelect").value;
  $("promptEditorSelect").innerHTML = `<option value="">${t("新建 Prompt")}</option>` +
    state.customPrompts.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("");
  $("promptEditorSelect").value = selected;
}

function selectPromptForEditing() {
  const item = state.customPrompts.find(prompt => prompt.id === $("promptEditorSelect").value);
  $("promptName").value = item?.name || "";
  $("promptContent").value = item?.content ?? $("prompt").value;
  $("deletePromptBtn").disabled = !item;
  setMessage("promptMessage", () => "");
}

function openPromptEditor() {
  renderPromptEditorOptions();
  $("promptEditorSelect").value = state.activeCustomPrompt || "";
  selectPromptForEditing();
  $("promptDialog").showModal();
  $("promptName").focus();
}

function saveCustomPrompt(event) {
  event.preventDefault();
  const name = $("promptName").value.trim();
  const content = $("promptContent").value;
  if (!name || !content.trim()) {
    setMessage("promptMessage", () => t("请填写 Prompt 名称和内容。"));
    return;
  }
  const id = $("promptEditorSelect").value || crypto.randomUUID();
  const item = {id, name, content};
  const prompts = state.customPrompts.some(prompt => prompt.id === id)
    ? state.customPrompts.map(prompt => prompt.id === id ? item : prompt)
    : [...state.customPrompts, item];
  try { localStorage.setItem("relay.customPrompts", JSON.stringify(prompts)); }
  catch (err) {
    setMessage("promptMessage", () => t("保存 Prompt 失败：{error}", {error: err.message}));
    return;
  }
  state.customPrompts = prompts;
  applyPrompt(id);
  $("promptDialog").close();
}

function deleteCustomPrompt() {
  const id = $("promptEditorSelect").value;
  const item = state.customPrompts.find(prompt => prompt.id === id);
  if (!item || !confirm(t("删除 Prompt「{name}」？", {name: item.name}))) return;
  const prompts = state.customPrompts.filter(prompt => prompt.id !== id);
  try { localStorage.setItem("relay.customPrompts", JSON.stringify(prompts)); }
  catch (err) {
    setMessage("promptMessage", () => t("保存 Prompt 失败：{error}", {error: err.message}));
    return;
  }
  state.customPrompts = prompts;
  if (state.activeCustomPrompt === id) state.activeCustomPrompt = null;
  $("promptEditorSelect").value = "";
  renderPromptEditorOptions();
  selectPromptForEditing();
  renderPromptPresets();
}

function extractPreviewHtml(content) {
  if (typeof content !== "string") return null;
  const blocks = [...content.matchAll(/\x60\x60\x60(?:html|svg|xml)?\s*\n([\s\S]*?)\x60\x60\x60/gi)];
  for (const block of blocks) {
    if (/<(?:!doctype|html|svg|div|body|canvas|style)\b/i.test(block[1])) return block[1].trim();
  }
  if (/^\s*</.test(content)) return content.trim();
  const start = content.search(/<!doctype\s+html|<html\b|<svg\b/i);
  if (start >= 0) return content.slice(start).replace(/\x60\x60\x60\s*$/, "").trim();
  return null;
}

function setPreviewMode(source) {
  $("previewFrame").classList[source ? "add" : "remove"]("hidden");
  $("previewSource").classList[source ? "remove" : "add"]("hidden");
  $("previewRenderBtn").setAttribute("aria-pressed", String(!source));
  $("previewSourceBtn").setAttribute("aria-pressed", String(source));
}

function openResultPreview() {
  const html = extractPreviewHtml(state.detailResult?.content);
  if (!html) return;
  state.previewHtml = html;
  // Unique-origin scripts may animate SVG, but cannot read the workspace or call its API.
  const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'";
  const policyMeta = '<meta http-equiv="Content-Security-Policy" content="' + policy + '">';
  $("previewFrame").srcdoc = /<head\b[^>]*>/i.test(html)
    ? html.replace(/<head\b[^>]*>/i, head => head + policyMeta)
    : '<!doctype html><html><head>' + policyMeta + '</head><body>' + html + '</body></html>';
  $("previewSource").textContent = html;
  setPreviewMode(false);
  $("previewDialog").showModal();
}

function downloadResultHtml() {
  if (!state.previewHtml) return;
  const url = URL.createObjectURL(new Blob([state.previewHtml], {type: "text/html;charset=utf-8"}));
  const link = document.createElement("a");
  link.href = url;
  link.download = "llm-result.html";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });

  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; }
  catch { data = text; }

  if (!response.ok) {
    const detail = data?.detail ?? data ?? `${response.status} ${response.statusText}`;
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail, null, 2));
  }
  return data;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fmtTime(iso) {
  if (!iso) return "-";
  try { return new Date(iso).toLocaleString(language); } catch { return iso; }
}

function durationText(ms) {
  if (!Number.isFinite(ms)) return "—";
  return ms < 1000 ? t("{ms} 毫秒", {ms: ms.toLocaleString(language)}) : t("{seconds} 秒", {seconds: (ms / 1000).toFixed(1)});
}

function resultExplanation(result) {
  if (result.ok) {
    if (result.finish_reason === "length") return {title: t("回复已截断"), advice: t("已收到正文，但服务报告输出长度耗尽。可清空输出上限或提高额度后重新生成；预览可能不完整。")};
    return result.model_match === false
      ? { title: t("接口可用，但返回模型不同"), advice: t("服务返回的模型名称与请求不同，可能使用了别名或路由。请核对返回模型，不能仅凭名称判断模型被替换。") }
      : { title: t("接口可用"), advice: t("已收到模型回复。本次测试通过不代表所有模型或功能均可访问。") };
  }
  if (result.transport_error) return { title: t("请求未完成"), advice: t("页面没有收到本地服务的结果。请确认 Python 服务仍在运行，再重试；这不能直接证明 API Key 无效。") };
  if (result.error_code === "unsupported_setting") return {
    title: t("思考设置不受支持"),
    advice: t("没有向上游发送请求。请按该连接支持的档位重新选择；开关型接口不能设置 low/high，部分模型不能关闭思考。")
  };
  if (["upstream_disconnected", "stream_incomplete", "upstream_stream_error"].includes(result.error_code) ||
      /RemoteProtocolError|disconnected without sending a response/.test(result.error || "")) return {
    title: t("响应未完整返回"),
    advice: t("服务端或中间网络在响应完成前断开，不能据此认定密钥失效。可尝试流式响应；已收到的正文会保留供查看，不会自动重试。")
  };
  const error = String(result.error || "");
  const reasoningTokens = result.usage?.completion_tokens_details?.reasoning_tokens || 0;
  if (result.http_status >= 200 && result.http_status < 300 && !result.content) {
    if (result.error_code === "output_limit" || result.finish_reason === "length") return {
      title: t("输出额度耗尽，未生成正文"),
      advice: t("HTTP 请求成功，但输出额度在正文生成前已用尽。请清空或提高输出 Token 上限，或降低思考程度后重试。")
    };
    if (result.reasoning_content || reasoningTokens) return {
      title: t("只有思考，未生成正文"),
      advice: t("接口返回了推理消耗，但没有正文。这不是密钥失效的证据；请清空输出上限，或减少思考后重新生成。")
    };
  }
  if (result.http_status === 401) return { title: t("认证失败"), advice: t("请检查 API Key 是否正确，以及它是否有权访问当前接口。可点击「编辑连接」查看或替换密钥。") };
  if (result.http_status === 403) return { title: t("访问被拒绝"), advice: t("当前请求没有访问权限，也可能受服务访问策略限制。请核对模型权限和服务端原始报错。") };
  if (result.http_status === 429) {
    return /(?:quota|credit|balance).*(?:exhaust|insufficient|deplet)|insufficient_quota|额度.*(?:耗尽|用尽|不足)|余额不足|配额.*(?:耗尽|用尽)/i.test(error)
      ? { title: t("额度已用尽或不足"), advice: t("服务返回了额度不足提示。请检查套餐或余额；若服务提供了重置时间，请以下方原始报错为准。") }
      : { title: t("请求受限"), advice: t("可能遇到限流或额度限制，不能仅凭 HTTP 429 确定原因。请查看下方报错；若为限流，稍后再试。") };
  }
  if (result.http_status === 404) return { title: t("接口或模型未找到"), advice: t("请核对 Base URL、Chat Path 和模型名称；该服务可能不支持当前请求路径。") };
  if (result.http_status >= 500) return { title: t("服务暂不可用"), advice: t("服务端或上游处理请求失败，不一定是密钥问题。可稍后重试，或查看服务方状态。") };
  if (/timed?\s*out|timeout|超时/i.test(error)) return { title: t("请求超时"), advice: t("等待接口响应超时。请检查网络和接口状态；如模型响应较慢，可在高级连接设置中调整超时。") };
  if (/connect|连接失败/i.test(error)) return { title: t("无法连接接口"), advice: t("请检查接口地址、网络连接和本地服务是否已启动，再重试。") };
  return { title: t("测试未通过"), advice: t("请根据下方原始报错核对连接配置。HTTP 成功但没有模型文本回复，也不会被计为测试通过。") };
}

function statusBadge(result) {
  if (!result) return `<span class="badge neutral">${t("未测试")}</span>`;
  if (hasReasoningWithoutReply(result)) return `<span class="badge warn">${t("无正文")}</span>`;
  if (!result.ok) return `<span class="badge bad">${t("失败")}</span>`;
  if (result.model_match === false) return `<span class="badge warn">${t("模型不一致")}</span>`;
  return `<span class="badge good">${t("可用")}</span>`;
}

function hasReasoningWithoutReply(result) {
  return result && !result.ok && result.http_status >= 200 && result.http_status < 300 &&
    (result.error_code === "reasoning_only" || result.error_code === "output_limit" ||
      result.reasoning_content || result.usage?.completion_tokens_details?.reasoning_tokens > 0);
}

function httpBadge(code) {
  if (!code) return "-";
  const cls = code >= 200 && code < 300 ? "good" : "bad";
  return `<span class="badge ${cls}">${code}</span>`;
}

async function loadAll() {
  state.loadError = null;
  $("refreshBtn").disabled = true;
  $("connectionStatus").className = "connection-status";
  setConnection("正在同步");
  try {
    await Promise.all([loadEndpoints(), loadHistory()]);
    $("connectionStatus").className = "connection-status connected";
    state.loadError = null;
    setConnection("服务已连接");
  } catch (err) {
    $("connectionStatus").className = "connection-status disconnected";
    setConnection("连接失败");
    throw err;
  } finally {
    $("refreshBtn").disabled = false;
  }
}

async function loadEndpoints() {
  const previousIds = new Set(state.endpoints.map(ep => ep.id));
  state.endpoints = await api("/api/endpoints");
  for (const ep of state.endpoints) {
    if (!previousIds.has(ep.id) && ep.enabled !== false) state.selected.add(ep.id);
  }
  const currentIds = new Set(state.endpoints.map(ep => ep.id));
  for (const id of state.selected) {
    if (!currentIds.has(id)) state.selected.delete(id);
  }
  renderEndpoints();
}

async function loadHistory() {
  state.history = await api("/api/history?limit=100");
  state.latest.clear();
  for (const item of state.history) {
    if (!state.latest.has(item.endpoint_id)) state.latest.set(item.endpoint_id, item);
  }
  renderHistory();
  renderEndpoints();
}

function visibleEndpoints() {
  const query = $("endpointSearch").value.trim().toLowerCase();
  const filter = $("endpointFilter").value || "all";
  return state.endpoints.filter(ep => {
    const result = endpointResult(ep.id);
    const matches = [ep.name, ep.base_url, ep.model].some(value =>
      String(value || "").toLowerCase().includes(query));
    if (!matches) return false;
    if (filter === "enabled") return ep.enabled !== false;
    if (filter === "ok") return result?.ok === true;
    if (filter === "failed") return result?.ok === false;
    if (filter === "untested") return !result;
    return true;
  });
}

function updateSelection() {
  const visible = visibleEndpoints();
  const checked = visible.filter(ep => state.selected.has(ep.id)).length;
  for (const id of ["selectAll", "cardSelectAll"]) {
    $(id).checked = visible.length > 0 && checked === visible.length;
    $(id).indeterminate = checked > 0 && checked < visible.length;
    $(id).disabled = visible.length === 0;
  }
  const hiddenSelected = state.selected.size - checked;
  $("selectionCount").textContent = t("已选中 {count} 个站点", {count: state.selected.size}) +
    (hiddenSelected > 0 ? t("（含筛选外 {count} 个）", {count: hiddenSelected}) : "");
  $("selectedTestCount").textContent = state.selected.size;
  $("visibleCount").textContent = t("显示 {visible} / {total} 个站点", {visible: visible.length, total: state.endpoints.length});
}

function renderOverview() {
  const results = state.endpoints.map(ep => endpointResult(ep.id)).filter(Boolean);
  const latencies = results.map(item => item.latency_ms).filter(value => Number.isFinite(value));
  $("totalEndpoints").textContent = state.endpoints.length;
  $("enabledEndpoints").textContent = state.endpoints.filter(ep => ep.enabled !== false).length;
  $("healthyEndpoints").innerHTML = results.length
    ? `${results.filter(item => item.ok).length}<small>/ ${results.length}</small>` : "—";
  $("testedCaption").textContent = results.length
    ? t("{count} 个站点的最近测试结果", {count: results.length}) : t("还没有测试记录");
  $("averageLatency").innerHTML = latencies.length
    ? escapeHtml(durationText(Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length))) : "—";
  $("endpointCount").textContent = state.endpoints.length;
  $("navEndpointCount").textContent = state.endpoints.length;
}

function setEndpointView(view) {
  state.endpointView = view;
  try { localStorage.setItem("relay.endpointView", view); } catch { /* The view still works without storage. */ }
  renderEndpoints();
}

function isTesting(id) {
  return state.testRun?.running && state.testRun.items.some(item => item.id === id && item.pending);
}

function endpointResult(id) {
  const item = state.testRun?.items.find(item => item.id === id);
  return item?.error ? { endpoint_id: item.id, endpoint_name: item.name, base_url: item.base_url,
    requested_model: item.model, ok: false, error: item.error, transport_error: true } : state.latest.get(id);
}

function endpointStatus(ep) {
  if (isTesting(ep.id)) return `<span class="badge testing"><span class="test-spinner" aria-hidden="true"></span>${t("测试中")}</span>`;
  const result = endpointResult(ep.id);
  if (!result) return statusBadge(null);
  const noReply = hasReasoningWithoutReply(result);
  const label = result.transport_error ? t("请求失败") : noReply ? t("无正文") : !result.ok ? t("失败") : result.model_match === false ? t("模型不一致") : t("可用");
  const tone = noReply ? "warn" : !result.ok ? "bad" : result.model_match === false ? "warn" : "good";
  return `<button type="button" class="badge status-link ${tone}" aria-label="${t('查看 {name} 最近测试详情：{status}', {name: escapeHtml(ep.name), status: label})}" aria-haspopup="dialog" title="${t("查看最近一次测试详情")}" onclick="showEndpointResult('${ep.id}')">${label}${icon("chevron")}</button>`;
}

function showEndpointResult(id) {
  if (isTesting(id)) return;
  const result = endpointResult(id);
  if (result) showTestResult(result);
}

function endpointActions(ep, card = false) {
  const name = escapeHtml(ep.name);
  if (card) return `<button class="card-action run" aria-label="${t('测试站点 {name}', {name})}" onclick="testSingle('${ep.id}')" ${state.testRun?.running ? "disabled" : ""}>${icon("play")}${t("测试")}</button>
    <button class="card-action" aria-label="${t('编辑站点 {name}', {name})}" onclick="openEdit('${ep.id}')">${icon("edit")}${t("编辑")}</button>
    <details class="endpoint-more"><summary aria-label="${t('{name} 的更多操作', {name})}" title="${t("更多操作")}">${icon("more")}</summary><div class="endpoint-more-menu"><button onclick="probeModels('${ep.id}')">${icon("pulse")}${t("检测 Key / 模型")}</button><button class="danger" onclick="removeEndpoint('${ep.id}')">${icon("trash")}${t("删除站点")}</button></div></details>`;
  return `<button class="row-action run" aria-label="${t('测试站点 {name}', {name})}" title="${t("测试站点 {name}", {name})}" onclick="testSingle('${ep.id}')" ${state.testRun?.running ? "disabled" : ""}>${icon("play")}</button>
    <button class="row-action" aria-label="${t('检测 {name} 的模型', {name})}" title="${t("检测 Key / 模型")}" onclick="probeModels('${ep.id}')">${icon("grid")}</button>
    <button class="row-action" aria-label="${t('编辑站点 {name}', {name})}" title="${t("编辑站点 / 查看密钥")}" onclick="openEdit('${ep.id}')">${icon("edit")}</button>
    <button class="row-action delete" aria-label="${t('删除站点 {name}', {name})}" title="${t("删除站点")}" onclick="removeEndpoint('${ep.id}')">${icon("trash")}</button>`;
}

function renderEndpoints() {
  const tbody = $("endpointBody");
  const cards = state.endpointView === "cards";
  $("endpointListView").classList[cards ? "add" : "remove"]("hidden");
  $("endpointCardView").classList[cards ? "remove" : "add"]("hidden");
  $("listViewBtn").setAttribute("aria-pressed", String(!cards));
  $("cardViewBtn").setAttribute("aria-pressed", String(cards));
  renderOverview();
  updateSelection();
  if (state.loadError && !state.endpoints.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">${t("加载失败：{error}", {error: escapeHtml(state.loadError)})}<p>${t("请确认 Python 服务正在运行，然后点击右上角刷新。")}</p></td></tr>`;
    $("endpointCards").innerHTML = `<div class="empty">${t("加载失败：{error}", {error: escapeHtml(state.loadError)})}</div>`;
    return;
  }
  if (!state.endpoints.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">` + icon("server") +
      `<strong>${t("还没有模型连接")}</strong><p>${t("添加一个站点，开始管理你的 URL、密钥和模型。")}</p>` +
      `<button type="button" class="btn secondary" onclick="openAdd()">${t("新增第一个站点")}</button></td></tr>`;
    $("endpointCards").innerHTML = `<div class="empty"><strong>${t("还没有模型连接")}</strong><p>${t("添加一个站点，开始测试。")}</p><button class="btn secondary" onclick="openAdd()">${t("新增第一个站点")}</button></div>`;
    return;
  }

  const visible = visibleEndpoints();
  if (!visible.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">` + icon("search") +
      `<strong>${t("没有找到匹配的站点")}</strong><p>${t("试试其他关键词，或切换到「全部站点」。")}</p></td></tr>`;
    $("endpointCards").innerHTML = `<div class="empty"><strong>${t("没有找到匹配的站点")}</strong><p>${t("试试其他关键词，或切换到「全部站点」。")}</p></div>`;
    return;
  }
  tbody.innerHTML = visible.map((ep, index) => {
    const result = endpointResult(ep.id);
    const latency = durationText(result?.latency_ms);
    const disabled = ep.enabled !== false ? "" : `<span class="mini-tag">${t("停用")}</span>`;
    const name = escapeHtml(ep.name);
    const keyHint = ep.api_key_hint ? t("密钥已配置 · 尾号 {suffix}", {suffix: ep.api_key_hint.slice(-4)}) : t("未配置 API Key");
    return `
      <tr class="${ep.enabled !== false ? "" : "disabled-row"} ${isTesting(ep.id) ? "testing-row" : ""}">
        <td class="check-cell"><input class="endpoint-check" data-id="${ep.id}" type="checkbox" aria-label="${t('选择站点 {name}', {name})}" ${state.selected.has(ep.id) ? "checked" : ""}></td>
        <td class="site-cell"><div class="endpoint-identity"><span class="endpoint-avatar tone-${index % 4}" aria-hidden="true">${escapeHtml(ep.name.slice(0, 1).toUpperCase())}</span><div class="endpoint-info"><div class="endpoint-name">${name} ${disabled}<span class="key-hint" title="${escapeHtml(keyHint)}" aria-label="${escapeHtml(keyHint)}">${icon("key")}</span></div><span class="endpoint-url" title="${escapeHtml(ep.base_url)}">${escapeHtml(ep.base_url)}</span></div></div></td>
        <td class="model-cell"><span class="model-name">${escapeHtml(ep.model)}</span>${result?.returned_model ? `<span class="cell-secondary">${t("返回：")}${escapeHtml(result.returned_model)}</span>` : ""}</td>
        <td class="status-cell">${endpointStatus(ep)}${!isTesting(ep.id) && result?.http_status ? `<span class="cell-secondary">HTTP ${result.http_status}</span>` : ""}</td>
        <td class="latency-cell">${isTesting(ep.id) ? "—" : latency}</td>
        <td class="ops">${endpointActions(ep)}</td>
      </tr>
    `;
  }).join("");
  $("endpointCards").innerHTML = visible.map(ep => {
    const result = endpointResult(ep.id);
    const name = escapeHtml(ep.name);
    return `<article class="endpoint-card ${isTesting(ep.id) ? "testing-card" : ""}">
      <div class="endpoint-card-top"><h3>${name}${ep.enabled === false ? ` <span class="mini-tag">${t("停用")}</span>` : ""}</h3><input class="endpoint-check" data-id="${ep.id}" type="checkbox" aria-label="${t('选择站点 {name}', {name})}" ${state.selected.has(ep.id) ? "checked" : ""}></div>
      <p class="card-model">${escapeHtml(ep.model)}</p>
      <div class="endpoint-card-status">${endpointStatus(ep)}<span>${!isTesting(ep.id) && result?.latency_ms != null ? durationText(result.latency_ms) : ""}</span></div>
      <div class="endpoint-card-actions">${endpointActions(ep, true)}</div>
    </article>`;
  }).join("");
}

function renderHistory() {
  const tbody = $("historyBody");
  $("historyCount").textContent = state.history.length;
  $("clearHistoryBtn").disabled = !state.history.length;
  if (!state.history.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">` + icon("clock") +
      `<strong>${t("每一次测试，都会留在这里")}</strong><p>${t("发起测试后，在这里查看模型回复、耗时和具体报错。")}</p></td></tr>`;
    return;
  }

  tbody.innerHTML = state.history.map(item => {
    const summary = item.ok ? item.content : `${resultExplanation(item).title}：${item.error || t("未收到有效回复")}`;
    const short = (summary || "-").slice(0, 90);
    return `
      <tr>
        <td class="history-time">${escapeHtml(fmtTime(item.started_at))}</td>
        <td><span class="history-name">${escapeHtml(item.endpoint_name)}</span><span class="cell-secondary">${escapeHtml(item.requested_model)}</span>${item.returned_model ? `<span class="cell-secondary">${t("返回：")}${escapeHtml(item.returned_model)}</span>` : ""}</td>
        <td>${statusBadge(item)}</td>
        <td>${httpBadge(item.http_status)}</td>
        <td class="latency-cell">${durationText(item.latency_ms)}</td>
        <td>
          <button class="summary-btn" aria-label="${t('查看 {name} 的测试详情', {name: escapeHtml(item.endpoint_name)})}" onclick='showDetail(${JSON.stringify(item.id)})'><span>${escapeHtml(short)}${summary?.length > 90 ? "…" : ""}</span>${icon("arrow")}</button>
        </td>
      </tr>
    `;
  }).join("");
}

function selectedIds() {
  return [...state.selected];
}

async function runTests(ids = null) {
  if (state.testRun?.running) return;
  const prompt = $("prompt").value.trim();
  if (!prompt) {
    alert(t("请输入测试内容。"));
    return;
  }

  const targets = state.endpoints.filter(ep => ids ? ids.includes(ep.id) : ep.enabled !== false);
  if (!targets.length) {
    setMessage("testStatus", () => t("没有可以测试的站点，请先添加或启用站点。"));
    return;
  }
  const payload = {
    prompt,
    temperature: $("temperature").value === "" ? null : Number($("temperature").value),
    max_tokens: $("maxTokens").value === "" ? null : Number($("maxTokens").value),
    reasoning_effort: $("reasoningEffort").value === "inherit" ? null : $("reasoningEffort").value,
    timeout_seconds: $("requestTimeout").value === "" ? null : Number($("requestTimeout").value),
    stream: $("streamMode").value === "true" ? true : $("streamMode").value === "false" ? false : null,
  };

  state.testRun = { running: true, expanded: false, filter: "all", items: targets.map(ep => ({
    id: ep.id, name: ep.name, model: ep.model, base_url: ep.base_url,
    pending: true, result: null, error: null,
  })) };
  $("testHistoryWarning").classList.add("hidden");
  $("testAllBtn").disabled = true;
  $("testSelectedBtn").disabled = true;
  $("testAllBtn").innerHTML = icon("refresh") + t("测试中…");
  renderTestProgress();
  renderEndpoints();
  $("testProgress").scrollIntoView({ block: "start" });
  try {
    await Promise.all(state.testRun.items.map(async item => {
      try {
        item.result = await api(`/api/test/${item.id}`, {
          method: "POST", body: JSON.stringify(payload),
        });
        state.latest.set(item.id, item.result);
      } catch (err) {
        item.error = err.message;
      } finally {
        item.pending = false;
        renderTestProgress();
        renderEndpoints();
      }
    }));
    try { await loadHistory(); }
    catch (err) {
      setMessage("testHistoryWarning", () => t("本轮结果已显示，但历史记录刷新失败：{error}。可点击右上角刷新重试。", {error: err.message}));
      $("testHistoryWarning").classList.remove("hidden");
    }
  } finally {
    state.testRun.running = false;
    renderTestProgress();
    renderEndpoints();
    $("testAllBtn").disabled = false;
    $("testSelectedBtn").disabled = false;
    $("testAllBtn").innerHTML = icon("play") + t("全部测试");
  }
}

function testSingle(id) {
  return runTests([id]);
}

function renderTestProgress() {
  const run = state.testRun;
  if (!run) return;
  const done = run.items.filter(item => !item.pending).length;
  const ok = run.items.filter(item => item.result?.ok).length;
  const failed = done - ok;
  const active = run.items.length - done;
  $("testProgress").classList.remove("hidden");
  $("testProgress").setAttribute("aria-busy", String(active > 0));
  $("testProgressTitle").textContent = active ? t("正在测试 {count} 个站点", {count: active}) : t("本轮测试完成");
  $("testProgressSummary").textContent = t("已完成 {done} / {total} · 可用 {ok} · 失败 {failed}", {done, total: run.items.length, ok, failed});
  $("testProgressCount").textContent = `${done} / ${run.items.length}`;
  $("testProgressBar").max = run.items.length;
  $("testProgressBar").value = done;
  $("testFailuresBtn").classList[failed ? "remove" : "add"]("hidden");
  $("testFailuresBtn").textContent = t("查看失败 {count}", {count: failed});
  $("testFailuresBtn").setAttribute("aria-pressed", String(run.expanded && run.filter === "failed"));
  $("testProgressToggle").textContent = run.expanded ? t("收起") : t("展开全部");
  $("testProgressToggle").setAttribute("aria-expanded", String(run.expanded));
  $("testProgressList").classList[run.expanded ? "remove" : "add"]("hidden");
  const pending = run.items.filter(item => item.pending);
  $("testActiveSummary").classList[active ? "remove" : "add"]("hidden");
  $("testActiveSummary").textContent = pending.slice(0, 2).map(item => `${item.name} · ${item.model}`).join(language === "en" ? "; " : "；") +
    (active > 2 ? t("；另有 {count} 个站点，可展开查看", {count: active - 2}) : "");
  $("testActiveSummary").title = pending.map(item => `${item.name} · ${item.model}`).join(language === "en" ? "; " : "；");
  setMessage("testStatus", () => active
    ? t("已完成 {done} / {total}，正在等待 {active} 个站点。", {done, total: run.items.length, active})
    : t("测试完成：{ok} 个可用，{failed} 个失败，可在下方查看结果。", {ok, failed}));
  $("testProgressList").innerHTML = run.items.map((item, index) => {
    if (run.filter === "failed" && (item.pending || item.result?.ok)) return "";
    const status = item.pending
      ? `<span class="badge testing"><span class="test-spinner" aria-hidden="true"></span>${t("测试中")}</span>`
      : item.error ? `<span class="badge bad">${t("请求失败")}</span>` : statusBadge(item.result);
    const detail = item.pending ? t("等待接口响应") : item.error || item.result.error ||
      (item.result.model_match === false ? t("返回模型：{model}", {model: item.result.returned_model}) : t("已收到模型回复"));
    return `<article class="progress-item" aria-label="${escapeHtml(item.name)} · ${escapeHtml(item.model)}">
      <strong class="progress-site" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</strong>
      <span class="progress-model" title="${escapeHtml(item.model)}">${escapeHtml(item.model)}</span>
      <span class="progress-result" title="${escapeHtml(detail)}">${status}${item.result?.http_status ? `<small>HTTP ${item.result.http_status}</small>` : ""}</span>
      <span class="progress-duration">${item.pending ? t("等待中") : durationText(item.result?.latency_ms)}</span>
      ${!item.pending ? `<button class="progress-detail-btn" onclick="showRunDetail(${index})" aria-label="${t('查看 {name} 的本轮测试详情', {name: escapeHtml(item.name)})}">${t("详情")} ${icon("arrow")}</button>` : `<span></span>`}
    </article>`;
  }).join("");
}

function showRunDetail(index) {
  const item = state.testRun?.items[index];
  if (!item || item.pending) return;
  showTestResult(item.result || { endpoint_id: item.id, endpoint_name: item.name,
    base_url: item.base_url, requested_model: item.model, ok: false,
    transport_error: true, error: item.error });
}

function showTestResult(item, open = true) {
  state.detailResult = item;
  const explanation = resultExplanation(item);
  $("detailTitle").textContent = t("{name} · 测试详情", {name: item.endpoint_name});
  $("testResultSummary").classList.remove("hidden");
  $("detailOutcome").textContent = explanation.title;
  $("detailOutcome").className = hasReasoningWithoutReply(item) || item.finish_reason === "length" ? "warn" : item.ok ? (item.model_match === false ? "warn" : "good") : "bad";
  $("detailAdvice").textContent = explanation.advice;
  const facts = [[t("请求模型"), item.requested_model || "—"], [t("返回模型"), item.returned_model || t("未提供")],
    ["HTTP", item.http_status ?? t("未收到响应")], [t("耗时"), durationText(item.latency_ms)],
    [t("请求地址"), item.request_url || item.base_url || t("未记录")]];
  if (item.finish_reason) facts.push([t("结束原因"), item.finish_reason]);
  if (item.usage?.completion_tokens != null) facts.push([t("输出 Token"), item.usage.completion_tokens]);
  if (item.usage?.completion_tokens_details?.reasoning_tokens != null) facts.push([t("思考 Token"), item.usage.completion_tokens_details.reasoning_tokens]);
  const generation = item.generation_parameters;
  if (generation) facts.push([t("实际请求参数"), JSON.stringify(generation)]);
  $("detailFacts").innerHTML = facts.map(([key, value]) => `<div><dt>${key}</dt><dd>${escapeHtml(value)}</dd></div>`).join("");
  $("detailMessageLabel").textContent = item.ok ? t("模型回复") : t("服务端报错 / 原始提示");
  $("detailMessage").textContent = item.ok ? item.content || t("未提供文本回复") : item.error || t("未提供具体错误");
  $("detailCopyBtn").textContent = item.ok ? t("复制回复") : t("复制报错");
  $("detailPreviewBtn").classList[extractPreviewHtml(item.content) ? "remove" : "add"]("hidden");
  $("detailReasoning").classList[item.reasoning_content ? "remove" : "add"]("hidden");
  $("detailReasoningContent").textContent = typeof item.reasoning_content === "string"
    ? item.reasoning_content : item.reasoning_content ? JSON.stringify(item.reasoning_content, null, 2) : "";
  if (open) $("detailReasoning").open = false;
  $("detailPartial").classList[!item.ok && item.content ? "remove" : "add"]("hidden");
  $("detailPartialContent").textContent = !item.ok ? item.content || "" : "";
  if (open) $("detailPartial").open = false;
  if (open) setMessage("detailCopyStatus", () => "");
  $("detailEditBtn").classList[!item.ok && state.endpoints.some(ep => ep.id === item.endpoint_id) ? "remove" : "add"]("hidden");
  if (open) $("rawDetails").open = false;
  $("detailContent").textContent = JSON.stringify(item, null, 2);
  if (open) $("detailDialog").showModal();
}

function resetForm() {
  $("endpointForm").reset();
  $("endpointId").value = "";
  $("advancedSettings").open = false;
  setApiKeyVisible(false);
  $("apiKey").placeholder = t("sk-...；编辑时留空表示不修改");
  setMessage("apiKeyMessage", () => "");
  $("model").value = DEFAULT_TEST_MODEL;
  $("chatPath").value = "/v1/chat/completions";
  $("modelsPath").value = "/v1/models";
  $("timeoutSeconds").value = "30";
  $("endpointReasoningEffort").value = "";
  $("reasoningParameter").value = "auto";
  $("tokenParameter").value = "auto";
  $("endpointStreamMode").value = "auto";
  for (const option of $("endpointReasoningEffort").options || []) option.disabled = false;
  setMessage("endpointReasoningHint", () => "");
  $("extraHeaders").value = "{}";
  $("enabled").checked = true;
  $("modelSelect").classList.add("hidden");
  $("modelSelect").innerHTML = "";
  setMessage("dialogMessage", () => "");
}

function setApiKeyVisible(visible) {
  $("apiKey").type = visible ? "text" : "password";
  $("toggleApiKeyBtn").textContent = visible ? t("隐藏") : t("显示");
  $("toggleApiKeyBtn").setAttribute("aria-pressed", String(visible));
}

async function useApiKey(action) {
  setMessage("apiKeyMessage", () => "");
  if (action === "toggle" && $("apiKey").type === "text") {
    setApiKeyVisible(false);
    return;
  }

  $("toggleApiKeyBtn").disabled = true;
  $("copyApiKeyBtn").disabled = true;
  try {
    const id = $("endpointId").value;
    let key = $("apiKey").value;
    if (!key && id) {
      setMessage("apiKeyMessage", () => t("正在读取已保存的 API Key…"));
      const data = await api(`/api/endpoints/${id}/api-key`, { cache: "no-store" });
      if (!$("endpointDialog").open || $("endpointId").value !== id) return;
      key = $("apiKey").value || data.api_key;
      $("apiKey").value = key;
    }
    if (!key) {
      setMessage("apiKeyMessage", () => t("当前没有 API Key，请先填写。"));
      return;
    }

    if (action === "toggle") {
      setApiKeyVisible(true);
      setMessage("apiKeyMessage", () => t("已显示完整 API Key。"));
    } else {
      try {
        await navigator.clipboard.writeText(key);
        setMessage("apiKeyMessage", () => t("API Key 已复制。"));
      } catch {
        setMessage("apiKeyMessage", () => t("复制失败，请点击“显示”后手动复制。"));
      }
    }
  } catch (err) {
    setMessage("apiKeyMessage", () => t("读取 API Key 失败：{error}。请确认 Python 服务仍在运行；更新代码后请重启 Python 服务。", {error: err.message}));
  } finally {
    $("toggleApiKeyBtn").disabled = false;
    $("copyApiKeyBtn").disabled = false;
  }
}

async function refreshGenerationCapabilities() {
  const selection = {
    model: $("model").value, base_url: $("baseUrl").value,
    reasoning_parameter: $("reasoningParameter").value || "auto",
  };
  try {
    const capabilities = await api("/api/generation-capabilities", {method: "POST", body: JSON.stringify(selection)});
    if ($("model").value !== selection.model || $("baseUrl").value !== selection.base_url ||
        ($("reasoningParameter").value || "auto") !== selection.reasoning_parameter) return;
    if (!Array.isArray(capabilities?.allowed_efforts)) return;
    for (const option of $("endpointReasoningEffort").options || []) {
      option.disabled = !capabilities.allowed_efforts.includes(option.value);
    }
    setMessage("endpointReasoningHint", () => capabilities.always_thinking
      ? t("该模型不能关闭思考；标准格式可使用 low/high/max。")
      : capabilities.switch_only
        ? t("此格式仅支持服务商默认、开启、关闭，不支持强度档位。")
        : t("档位支持情况由上游模型决定；请求被接受不等于强度已被证明生效。"));
  } catch (err) {
    setMessage("endpointReasoningHint", () => t("读取参数说明失败：{error}", {error: err.message}));
  }
}

function openAdd() {
  resetForm();
  setMessage("dialogTitle", () => t("新增站点"));
  $("endpointDialog").showModal();
  refreshGenerationCapabilities();
}
window.openAdd = openAdd;

function openEdit(id) {
  const ep = state.endpoints.find(x => x.id === id);
  if (!ep) return;
  resetForm();
  setMessage("dialogTitle", () => t("编辑：{name}", {name: ep.name}));
  $("endpointId").value = ep.id;
  $("name").value = ep.name;
  $("baseUrl").value = ep.base_url;
  $("apiKey").value = "";
  $("apiKey").placeholder = t("当前 {hint}；留空不修改", {hint: ep.api_key_hint || t("(无)")});
  $("model").value = ep.model;
  $("chatPath").value = ep.chat_path || "/v1/chat/completions";
  $("modelsPath").value = ep.models_path || "/v1/models";
  $("timeoutSeconds").value = ep.timeout_seconds ?? 0;
  $("endpointReasoningEffort").value = ep.reasoning_effort || "";
  $("reasoningParameter").value = ep.reasoning_parameter || "auto";
  $("tokenParameter").value = ep.token_parameter || "auto";
  $("endpointStreamMode").value = ep.stream == null ? "auto" : String(ep.stream);
  $("enabled").checked = ep.enabled !== false;
  $("extraHeaders").value = JSON.stringify(ep.extra_headers || {}, null, 2);
  $("endpointDialog").showModal();
  refreshGenerationCapabilities();
}

async function saveEndpoint(event) {
  event.preventDefault();
  setMessage("dialogMessage", () => "");
  let extraHeaders = {};
  try {
    extraHeaders = JSON.parse($("extraHeaders").value || "{}");
    if (Array.isArray(extraHeaders) || typeof extraHeaders !== "object" || extraHeaders === null) {
      throw new Error(t("必须是 JSON object"));
    }
  } catch (err) {
    setMessage("dialogMessage", () => t("额外 Headers 不是合法 JSON：{error}", {error: err.message}));
    return;
  }

  const selectedEffort = [...($("endpointReasoningEffort").options || [])].find(option => option.value === $("endpointReasoningEffort").value);
  if (selectedEffort?.disabled) {
    setMessage("dialogMessage", () => t("该模型不支持当前思考设置，请重新选择。"));
    return;
  }
  const id = $("endpointId").value;
  const payload = {
    name: $("name").value.trim(),
    base_url: $("baseUrl").value.trim(),
    api_key: $("apiKey").value,
    model: $("model").value.trim(),
    chat_path: $("chatPath").value.trim() || "/v1/chat/completions",
    models_path: $("modelsPath").value.trim() || "/v1/models",
    timeout_seconds: Number($("timeoutSeconds").value || 0),
    reasoning_effort: $("endpointReasoningEffort").value,
    reasoning_parameter: $("reasoningParameter").value,
    token_parameter: $("tokenParameter").value,
    stream: $("endpointStreamMode").value === "true" ? true : $("endpointStreamMode").value === "false" ? false : null,
    enabled: $("enabled").checked,
    extra_headers: extraHeaders,
  };

  $("saveEndpointBtn").disabled = true;
  $("saveEndpointBtn").textContent = t("正在保存…");
  try {
    if (id) {
      await api(`/api/endpoints/${id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
    } else {
      await api("/api/endpoints", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    }
    $("endpointDialog").close();
    await loadEndpoints();
  } catch (err) {
    setMessage("dialogMessage", () => err.message);
  } finally {
    $("saveEndpointBtn").disabled = false;
    $("saveEndpointBtn").textContent = t("保存站点");
  }
}

async function removeEndpoint(id) {
  const ep = state.endpoints.find(x => x.id === id);
  if (!confirm(t("确认删除站点「{name}」？", {name: ep?.name || id}))) return;
  try {
    await api(`/api/endpoints/${id}`, { method: "DELETE" });
    state.latest.delete(id);
    await loadEndpoints();
  } catch (err) {
    alert(err.message);
  }
}

async function probeModels(id) {
  const ep = state.endpoints.find(x => x.id === id);
  setMessage("testStatus", () => t("正在检测 {name} 的 Key 和模型列表…", {name: ep?.name || ""}));
  try {
    const data = await api(`/api/models/${id}`);
    showModelProbeResult(data, ep?.name || id);
    setMessage("testStatus", () => probeSummary(data));
  } catch (err) {
    setMessage("testStatus", () => t("模型检测失败：{error}", {error: err.message}));
  }
}

function parseExtraHeaders() {
  const headers = JSON.parse($("extraHeaders").value || "{}");
  if (Array.isArray(headers) || typeof headers !== "object" || headers === null) {
    throw new Error(t("额外 Headers 必须是 JSON object"));
  }
  return headers;
}

function authStatusText(status) {
  if (status === "accepted") return t("通过：模型接口接受了当前凭据");
  if (status === "rejected") return t("拒绝：HTTP 401/403，Key 无效或无权限");
  return t("无法判断：该响应不能证明 Key 有效或无效");
}

function probeSummary(data) {
  if (data.auth_status === "rejected") return t("Key 被拒绝（HTTP {status}）", {status: data.http_status});
  if (data.ok) return t("连接成功：检测到 {count} 个模型", {count: data.models?.length || 0});
  return t("检测失败：{error}", {error: data.error || t("未知错误")});
}

function showModelProbeResult(data, name, open = true) {
  state.modelProbe = {data, name};
  state.detailResult = null;
  $("testResultSummary").classList.add("hidden");
  if (open) $("rawDetails").open = true;
  const lines = [
    t("认证状态：{status}", {status: authStatusText(data.auth_status)}),
    t("请求地址：{url}", {url: data.request_url || "-"}),
    t("HTTP 状态：{status}", {status: data.http_status ?? t("未收到响应")}),
    t("耗时：{ms} ms", {ms: data.latency_ms ?? "-"}),
    t("识别模型：{count} 个", {count: data.models?.length || 0}),
  ];
  if (data.error) lines.push(``, t("错误 / 提示："), String(data.error));
  if (data.models?.length) lines.push(``, t("可访问模型："), ...data.models);
  if ((!data.ok || !data.models?.length) && data.raw_response != null) {
    lines.push(``, t("服务端原始返回："),
      typeof data.raw_response === "string"
        ? data.raw_response
        : JSON.stringify(data.raw_response, null, 2));
  }
  $("detailTitle").textContent = t("Key 与模型检测：{name}", {name: name || t("未保存站点")});
  $("detailContent").textContent = lines.join("\n");
  if (open) $("detailDialog").showModal();
}

async function fetchModelsForForm() {
  const id = $("endpointId").value;
  setMessage("dialogMessage", () => "");
  const baseUrl = $("baseUrl").value.trim();
  if (!baseUrl) {
    setMessage("dialogMessage", () => t("请先填写 Base URL。"));
    return;
  }

  let extraHeaders;
  try {
    extraHeaders = parseExtraHeaders();
  } catch (err) {
    setMessage("dialogMessage", () => err.message);
    return;
  }

  $("fetchModelsBtn").disabled = true;
  setMessage("dialogMessage", () => t("正在检测 Key 和模型列表…"));
  try {
    const data = await api("/api/probe-models", {
      method: "POST",
      body: JSON.stringify({
        base_url: baseUrl,
        api_key: $("apiKey").value,
        models_path: $("modelsPath").value.trim() || "/v1/models",
        timeout_seconds: Number($("timeoutSeconds").value || 0),
        extra_headers: extraHeaders,
        endpoint_id: id || null,
      }),
    });
    const sel = $("modelSelect");
    if (data.models?.length) {
      sel.innerHTML = `<option value="">${t("选择一个模型…")}</option>` +
        data.models.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join("");
      sel.classList.remove("hidden");
    } else {
      sel.innerHTML = "";
      sel.classList.add("hidden");
    }
    setMessage("dialogMessage", () => probeSummary(data));
    showModelProbeResult(data, $("name").value.trim() || null);
  } catch (err) {
    setMessage("dialogMessage", () => t("检测失败：{error}", {error: err.message}));
  } finally {
    $("fetchModelsBtn").disabled = false;
  }
}

function showDetail(id) {
  const item = state.history.find(x => x.id === id);
  if (!item) return;
  showTestResult(item);
}

window.testSingle = testSingle;
window.openEdit = openEdit;
window.probeModels = probeModels;
window.removeEndpoint = removeEndpoint;
window.showDetail = showDetail;
window.showRunDetail = showRunDetail;
window.showEndpointResult = showEndpointResult;

$("addEndpointBtn").addEventListener("click", openAdd);
$("quickProbeBtn").addEventListener("click", () => {
  openAdd();
  $("baseUrl").focus();
});
$("refreshBtn").addEventListener("click", () => loadAll().catch(err => {
  setMessage("testStatus", () => t("刷新失败：{error}", {error: err.message}));
}));
$("endpointSearch").addEventListener("input", renderEndpoints);
$("endpointFilter").addEventListener("change", renderEndpoints);
$("listViewBtn").addEventListener("click", () => setEndpointView("list"));
$("cardViewBtn").addEventListener("click", () => setEndpointView("cards"));
function changeEndpointSelection(event) {
  const id = event.target.dataset.id;
  if (!id) return;
  if (event.target.checked) state.selected.add(id);
  else state.selected.delete(id);
  updateSelection();
}
$("endpointBody").addEventListener("change", changeEndpointSelection);
$("endpointCards").addEventListener("change", changeEndpointSelection);
$("promptPresetBtn").addEventListener("click", () => {
  state.promptPreset = "不要联网搜索，你的模型知识库截止到什么时间？请只根据模型自身知识回答。";
  state.activeCustomPrompt = null;
  $("prompt").value = t(state.promptPreset);
  renderPromptPresets();
});
$("pelicanPromptBtn").addEventListener("click", () => {
  state.promptPreset = null;
  state.activeCustomPrompt = null;
  $("prompt").value = PELICAN_PROMPT;
  renderPromptPresets();
});
$("helpBtn").addEventListener("click", () => $("helpDialog").showModal());
$("closeHelpBtn").addEventListener("click", () => $("helpDialog").close());
$("helpAddBtn").addEventListener("click", () => {
  $("helpDialog").close();
  openAdd();
});
$("sidebarNav").addEventListener("click", event => {
  const link = event.target.closest(".nav-item");
  if (!link) return;
  for (const item of document.querySelectorAll(".nav-item")) {
    item.classList.remove("active");
    item.removeAttribute("aria-current");
  }
  link.classList.add("active");
  link.setAttribute("aria-current", "page");
});
$("closeDialogBtn").addEventListener("click", () => $("endpointDialog").close());
$("cancelBtn").addEventListener("click", () => $("endpointDialog").close());
$("endpointForm").addEventListener("submit", saveEndpoint);
$("endpointDialog").addEventListener("close", () => {
  $("apiKey").value = "";
  setApiKeyVisible(false);
});
$("toggleApiKeyBtn").addEventListener("click", () => useApiKey("toggle"));
$("copyApiKeyBtn").addEventListener("click", () => useApiKey("copy"));
$("fetchModelsBtn").addEventListener("click", fetchModelsForForm);
for (const id of ["model", "baseUrl", "reasoningParameter"]) $(id).addEventListener("change", refreshGenerationCapabilities);
$("modelSelect").addEventListener("change", e => {
  if (e.target.value) $("model").value = e.target.value;
});
$("testAllBtn").addEventListener("click", () => runTests(null));
$("testProgressToggle").addEventListener("click", () => {
  if (!state.testRun) return;
  state.testRun.expanded = !state.testRun.expanded;
  if (state.testRun.expanded) state.testRun.filter = "all";
  renderTestProgress();
});
$("testFailuresBtn").addEventListener("click", () => {
  if (!state.testRun) return;
  state.testRun.filter = "failed";
  state.testRun.expanded = true;
  renderTestProgress();
});
$("testSelectedBtn").addEventListener("click", () => {
  const ids = selectedIds();
  if (!ids.length) return alert(t("请至少选择一个站点。"));
  return runTests(ids);
});
function selectVisibleEndpoints(e) {
  for (const ep of visibleEndpoints()) {
    if (e.target.checked) state.selected.add(ep.id);
    else state.selected.delete(ep.id);
  }
  renderEndpoints();
}
$("selectAll").addEventListener("change", selectVisibleEndpoints);
$("cardSelectAll").addEventListener("change", selectVisibleEndpoints);
$("clearHistoryBtn").addEventListener("click", async () => {
  if (!confirm(t("确认清空测试历史？"))) return;
  await api("/api/history", { method: "DELETE" });
  await loadHistory();
});
$("closeDetailBtn").addEventListener("click", () => $("detailDialog").close());
$("detailCopyBtn").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("detailMessage").textContent);
    setMessage("detailCopyStatus", () => t("已复制到剪贴板"));
  } catch (err) {
    setMessage("detailCopyStatus", () => t("复制失败，请手动选取上方文本：{error}", {error: err.message}));
  }
});
$("detailEditBtn").addEventListener("click", () => {
  const id = state.detailResult?.endpoint_id;
  if (!id || !state.endpoints.some(ep => ep.id === id)) return;
  $("detailDialog").close();
  openEdit(id);
});

applyStaticLanguage();
$("prompt").value = t(state.promptPreset);
setMessage("testStatus", () => t("准备就绪，选择站点后即可开始测试。"));
$("languageSelect").addEventListener("change", event => changeLanguage(event.target.value));
$("prompt").addEventListener("input", () => {
  state.promptPreset = null;
  state.activeCustomPrompt = null;
  renderPromptPresets();
});
$("customPromptButtons").addEventListener("click", event => {
  const button = event.target.closest("[data-prompt-id]");
  if (button) applyPrompt(button.dataset.promptId);
});
$("managePromptsBtn").addEventListener("click", openPromptEditor);
$("promptEditorSelect").addEventListener("change", selectPromptForEditing);
$("promptForm").addEventListener("submit", saveCustomPrompt);
$("deletePromptBtn").addEventListener("click", deleteCustomPrompt);
$("closePromptBtn").addEventListener("click", () => $("promptDialog").close());
$("cancelPromptBtn").addEventListener("click", () => $("promptDialog").close());
$("detailPreviewBtn").addEventListener("click", openResultPreview);
$("previewRenderBtn").addEventListener("click", () => setPreviewMode(false));
$("previewSourceBtn").addEventListener("click", () => setPreviewMode(true));
$("downloadHtmlBtn").addEventListener("click", downloadResultHtml);
$("closePreviewBtn").addEventListener("click", () => $("previewDialog").close());
$("previewDialog").addEventListener("close", () => {
  $("previewFrame").srcdoc = "";
  $("previewSource").textContent = "";
  state.previewHtml = "";
});
renderPromptPresets();

loadAll().catch(err => {
  console.error(err);
  state.loadError = err.message;
  renderEndpoints();
});

function changeLanguage(next) {
  if (state.promptPreset && $("prompt").value !== t(state.promptPreset)) state.promptPreset = null;
  language = next === "en" ? "en" : "zh-CN";
  try { localStorage.setItem("relay.language", language); } catch { /* Switching still works. */ }
  applyStaticLanguage();
  renderPromptPresets();
  if ($("promptDialog").open) renderPromptEditorOptions();
  if (state.promptPreset) $("prompt").value = t(state.promptPreset);
  setConnection(state.connection);
  renderEndpoints();
  renderHistory();
  renderTestProgress();
  $("testAllBtn").innerHTML = icon(state.testRun?.running ? "refresh" : "play") +
    t(state.testRun?.running ? "测试中…" : "全部测试");
  $("saveEndpointBtn").textContent = t($("saveEndpointBtn").disabled ? "正在保存…" : "保存站点");
  setApiKeyVisible($("apiKey").type === "text");
  const ep = state.endpoints.find(item => item.id === $("endpointId").value);
  $("apiKey").placeholder = ep
    ? t("当前 {hint}；留空不修改", {hint: ep.api_key_hint || t("(无)")})
    : t("sk-...；编辑时留空表示不修改");
  const firstModel = $("modelSelect").querySelector('option[value=""]');
  if (firstModel) firstModel.textContent = t("选择一个模型…");
  if ($("detailDialog").open) {
    if (state.detailResult) showTestResult(state.detailResult, false);
    else if (state.modelProbe) showModelProbeResult(state.modelProbe.data, state.modelProbe.name, false);
  }
  for (const [id, render] of messages) $(id).textContent = render();
}
