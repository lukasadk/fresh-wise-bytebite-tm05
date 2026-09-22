const units = ["piece", "pack", "bag", "box", "bottle", "can", "jar", "bunch", "tray", "carton", "kg", "g", "L", "mL", "unknown"];

const state = {
  photoFile: null,
  previewUrl: null,
  analysis: null,
  review: null,
  apiRecognition: null,
  busy: false,
  dirty: false,
};

const $ = (id) => document.getElementById(id);
const photoInput = $("photo-input");
const dropZone = $("drop-zone");
const analyzeButton = $("analyze-button");
const reviewSection = $("review-section");
const finalAck = $("final-ack");
const recognitionEngine = $("recognition-engine");

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function errorText(payload, fallback) {
  if (!payload) return fallback;
  if (typeof payload.detail === "string") return payload.detail;
  if (Array.isArray(payload.detail)) {
    return payload.detail.map((entry) => entry.msg || JSON.stringify(entry)).join("；");
  }
  return fallback;
}

const jobPhaseLabels = {
  queued: "任务已进入队列",
  preparing_inference: "正在准备图片和模型",
  model_inference: "模型正在识别商品、数量和包装文字",
  validating_and_saving_review: "正在校验 JSON 并建立复核草稿",
  completed: "识别完成",
  failed: "识别失败",
};

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForRecognitionJob(jobId) {
  const deadline = Date.now() + 20 * 60 * 1000;
  while (Date.now() < deadline) {
    const job = await api(`/v1/recognition-jobs/${jobId}`);
    const percent = Math.round(job.progress * 100);
    $("progress-hint").textContent = `${jobPhaseLabels[job.phase] || job.phase}（${percent}%）`;
    if (job.state === "succeeded") return job;
    if (job.state === "failed") throw new Error(job.error || "识别任务失败。");
    await delay(750);
  }
  throw new Error("页面等待识别结果超时；任务可能仍在服务器运行，请稍后检查。 ");
}

async function api(path, options = {}, retriedAfterAuth = false) {
  const headers = new Headers(options.headers || {});
  const storedKey = sessionStorage.getItem("wastewiseApiKey");
  if (storedKey) headers.set("X-WasteWise-API-Key", storedKey);
  const response = await fetch(path, { ...options, headers });
  if (response.status === 401 && !retriedAfterAuth) {
    const suppliedKey = window.prompt("此 WasteWise 服务已启用访问保护，请输入 API 访问密钥：");
    if (suppliedKey) {
      sessionStorage.setItem("wastewiseApiKey", suppliedKey);
      return api(path, options, true);
    }
  }
  if (!response.ok) {
    let payload = null;
    try { payload = await response.json(); } catch (_) { /* response was not JSON */ }
    throw new Error(errorText(payload, `请求失败（HTTP ${response.status}）`));
  }
  if (response.status === 204) return null;
  return response.json();
}

function setBusy(value) {
  state.busy = value;
  analyzeButton.disabled = value;
  $("save-review").disabled = value || state.review?.status === "confirmed";
  updateConfirmState();
}

function showNotice(message, kind = "success") {
  const notice = $("notice");
  notice.textContent = message;
  notice.className = `notice ${kind}`;
}

function hideNotice() {
  $("notice").className = "notice hidden";
}

function selectPhoto(file) {
  hideNotice();
  if (!file) return;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    showNotice("请选择 JPEG、PNG 或 WebP 图片。", "error");
    return;
  }
  if (file.size > 12 * 1024 * 1024) {
    showNotice("图片超过 12 MB，请压缩后重试。", "error");
    return;
  }
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.photoFile = file;
  state.previewUrl = URL.createObjectURL(file);
  $("preview-image").src = state.previewUrl;
  $("preview-name").textContent = file.name;
  $("preview-size").textContent = formatBytes(file.size);
  $("upload-preview").classList.remove("hidden");
  dropZone.classList.add("hidden");
  analyzeButton.classList.remove("hidden");
}

function showStoredReviewImage(analysis) {
  if (!analysis?.review_image_url) return;
  $("preview-image").src = analysis.review_image_url;
  $("preview-name").textContent = "本次核对照片";
  $("preview-size").textContent = "已安全保存为去除元数据的本地复核图";
  $("upload-preview").classList.remove("hidden");
  dropZone.classList.add("hidden");
  analyzeButton.classList.add("hidden");
}

photoInput.addEventListener("change", () => selectPhoto(photoInput.files[0]));
["dragenter", "dragover"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("dragover");
  });
});
["dragleave", "drop"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragover");
  });
});
dropZone.addEventListener("drop", (event) => selectPhoto(event.dataTransfer.files[0]));

analyzeButton.addEventListener("click", async () => {
  if (!state.photoFile || state.busy) return;
  setBusy(true);
  hideNotice();
  $("upload-preview").classList.add("hidden");
  $("progress").classList.remove("hidden");
  const form = new FormData();
  form.append("file", state.photoFile, state.photoFile.name);
  const useAPI = recognitionEngine.value === "api";
  $("progress-hint").textContent = useAPI
    ? `正在调用 ${state.apiRecognition?.model || "已配置的外部模型"}。`
    : "本地 4B 模型首次识别可能需要较长时间。";
  try {
    const engine = useAPI ? "api" : "local";
    const submitted = await api(`/v1/recognition-jobs?engine=${engine}`, {
      method: "POST",
      body: form,
    });
    const completed = await waitForRecognitionJob(submitted.job_id);
    state.analysis = await api(`/v1/photo-entries/${completed.analysis_id}`);
    state.review = await api(`/v1/photo-entries/${state.analysis.analysis_id}/review`);
    state.dirty = false;
    localStorage.setItem("wastewiseCurrentAnalysis", state.analysis.analysis_id);
    history.replaceState(null, "", `/?analysis_id=${state.analysis.analysis_id}`);
    showStoredReviewImage(state.analysis);
    renderReview();
    showNotice(`识别完成：生成 ${state.review.items.length} 个候选项。请逐项核对。`);
    $("new-analysis").classList.remove("hidden");
    reviewSection.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    showNotice(error.message, "error");
    $("upload-preview").classList.remove("hidden");
  } finally {
    $("progress").classList.add("hidden");
    setBusy(false);
  }
});

async function loadRecognitionConfig() {
  const apiOption = recognitionEngine.querySelector('option[value="api"]');
  try {
    const config = await api("/v1/api-recognition/config");
    state.apiRecognition = config;
    apiOption.disabled = !config.enabled;
    apiOption.textContent = config.enabled
      ? `外部多模态 API（${config.model}）`
      : "外部多模态 API（尚未配置）";
    $("recognition-engine-hint").textContent = config.enabled
      ? `可选择外部 API 模型 ${config.model}；识别结果仍需逐项确认。`
      : "当前使用本地模型；在服务器 .env 中设置 WW_API_BASE_URL 和 WW_API_MODEL 后重启即可启用外部 API。";
  } catch (_) {
    apiOption.disabled = true;
    $("recognition-engine-hint").textContent = "无法读取外部 API 配置，继续使用本地模型。";
  }
}

recognitionEngine.addEventListener("change", () => {
  $("recognition-engine-hint").textContent = recognitionEngine.value === "api"
    ? `将使用外部 API 模型 ${state.apiRecognition?.model || ""}；结果仍需逐项确认。`
    : "当前使用本地 Qwen3-VL-4B 与已训练适配器。";
});

function currentSummary() {
  const items = state.review?.items || [];
  const pending = items.filter((item) => item.decision === "pending").length;
  const accepted = items.filter((item) => item.decision === "accepted").length;
  const rejected = items.filter((item) => item.decision === "rejected").length;
  const unresolved = items.filter((item) => item.decision === "accepted" && (!item.quantity || item.unit === "unknown")).length;
  const unconfirmedExpiry = items.filter((item) => item.decision === "accepted" && item.expiry_date && !item.expiry_confirmed).length;
  return {
    pending,
    accepted,
    rejected,
    unresolved,
    unconfirmedExpiry,
    ready: pending === 0 && unresolved === 0 && unconfirmedExpiry === 0,
  };
}

function summaryCard(value, label, className = "") {
  const card = document.createElement("div");
  card.className = `summary-card ${className}`.trim();
  const strong = document.createElement("strong");
  strong.textContent = value;
  const span = document.createElement("span");
  span.textContent = label;
  card.append(strong, span);
  return card;
}

function renderSummary() {
  if (!state.review) return;
  const summary = currentSummary();
  const root = $("review-summary");
  root.replaceChildren(
    summaryCard(state.review.items.length, "全部候选"),
    summaryCard(summary.accepted, "接受"),
    summaryCard(summary.rejected, "排除"),
    summaryCard(summary.pending, "待确认", summary.pending ? "blocked" : ""),
    summaryCard(
      state.review.status === "confirmed"
        ? "已确认"
        : summary.ready
          ? "可以提交"
          : summary.unconfirmedExpiry
            ? `${summary.unconfirmedExpiry} 个日期待确认`
            : `${summary.unresolved} 项未完整`,
      "最终状态",
      summary.ready || state.review.status === "confirmed" ? "ready" : "blocked",
    ),
  );
  updateConfirmState();
}

function makeBadge(text, className = "") {
  const badge = document.createElement("span");
  badge.className = `badge ${className}`.trim();
  badge.textContent = text;
  return badge;
}

function setItemField(item, field, input) {
  if (field === "quantity") {
    item.quantity = input.value === "" ? null : Number(input.value);
  } else if (field === "expiry_confirmed") {
    item.expiry_confirmed = input.checked;
  } else {
    item[field] = input.value === "" ? null : input.value;
    if (field === "expiry_date") item.expiry_confirmed = false;
  }
  state.dirty = true;
  renderSummary();
  if (field === "expiry_date") renderReview();
}

function renderCard(item, index) {
  const fragment = $("review-card-template").content.cloneNode(true);
  const card = fragment.querySelector(".review-card");
  card.classList.add(item.decision);
  card.dataset.index = index;

  const badges = fragment.querySelector(".badges");
  badges.append(makeBadge(item.origin === "model" ? "模型候选" : "手动添加", item.origin));
  if (item.model_confidence !== null && item.model_confidence !== undefined) {
    const percent = Math.round(item.model_confidence * 100);
    badges.append(makeBadge(`置信提示 ${percent}%`, percent < 72 ? "warn" : ""));
  }
  if (item.model_review_required) badges.append(makeBadge("模型标记需复核", "warn"));
  if (item.model_expiry_date_candidate) badges.append(makeBadge("日期 OCR 候选", "warn"));

  const evidence = fragment.querySelector(".evidence");
  const evidenceParts = [];
  if (item.packaging_text_evidence?.length) evidenceParts.push(`包装文字：${item.packaging_text_evidence.join(" · ")}`);
  if (item.expiry_text_evidence) evidenceParts.push(`日期原文：${item.expiry_text_evidence}`);
  if (item.model_review_reasons?.length) evidenceParts.push(`复核原因：${item.model_review_reasons.join("、")}`);
  if (evidenceParts.length) {
    evidence.textContent = evidenceParts.join(" ｜ ");
    evidence.classList.remove("hidden");
  }

  fragment.querySelectorAll("[data-field]").forEach((input) => {
    const field = input.dataset.field;
    if (input.tagName === "SELECT") {
      units.forEach((unit) => {
        const option = document.createElement("option");
        option.value = unit;
        option.textContent = unit;
        input.append(option);
      });
    }
    if (input.type === "checkbox") input.checked = Boolean(item[field]);
    else input.value = item[field] ?? "";
    input.disabled = state.review.status === "confirmed" || item.decision === "rejected";
    input.addEventListener("input", () => setItemField(item, field, input));
    input.addEventListener("change", () => setItemField(item, field, input));
  });

  const expiryAck = fragment.querySelector(".expiry-ack");
  if (item.expiry_date && item.decision !== "rejected") expiryAck.classList.remove("hidden");

  fragment.querySelectorAll("[data-decision]").forEach((button) => {
    const decision = button.dataset.decision;
    if (item.decision === decision) button.classList.add("active");
    button.disabled = state.review.status === "confirmed";
    button.addEventListener("click", () => {
      item.decision = decision;
      if (decision === "rejected") item.expiry_confirmed = false;
      state.dirty = true;
      finalAck.checked = false;
      renderReview();
    });
  });

  if (item.origin === "manual") {
    const remove = fragment.querySelector(".remove-manual");
    remove.classList.remove("hidden");
    remove.disabled = state.review.status === "confirmed";
    remove.addEventListener("click", () => {
      state.review.items.splice(index, 1);
      state.dirty = true;
      finalAck.checked = false;
      renderReview();
    });
  }
  return fragment;
}

function renderWarnings() {
  const warnings = [...(state.analysis?.warnings || [])];
  const barcodes = state.analysis?.barcode_candidates || [];
  if (barcodes.length) {
    warnings.unshift(`检测到可核对商品条码：${barcodes.map((item) => item.value).join("、")}。可通过 Open Food Facts 条码接口查询，但不会自动覆盖模型结果。`);
  }
  const box = $("analysis-warnings");
  if (!warnings.length) {
    box.classList.add("hidden");
    return;
  }
  box.textContent = warnings.join("；");
  box.classList.remove("hidden");
}

function renderReview() {
  if (!state.review) return;
  reviewSection.classList.remove("hidden");
  $("revision-badge").textContent = `草稿版本 ${state.review.revision}`;
  $("review-items").replaceChildren(...state.review.items.map(renderCard));
  renderWarnings();
  renderSummary();
  const confirmed = state.review.status === "confirmed";
  $("add-item").disabled = confirmed;
  $("save-review").disabled = confirmed;
  finalAck.disabled = confirmed;
  if (confirmed) {
    finalAck.checked = true;
    $("confirm-hint").textContent = "此照片已经确认，不能重复写入库存。";
  }
}

function reviewPayload() {
  return state.review.items.map((item) => ({
    review_item_id: item.review_item_id || null,
    source_item_id: item.source_item_id || null,
    decision: item.decision,
    food_name: item.food_name,
    brand: item.brand || null,
    product_variant: item.product_variant || null,
    net_content_text: item.net_content_text || null,
    category: item.category,
    quantity: item.quantity || null,
    unit: item.unit || "unknown",
    expiry_date: item.expiry_date || null,
    expiry_confirmed: Boolean(item.expiry_confirmed),
    notes: item.notes || null,
  }));
}

async function saveReview(showSuccess = true) {
  if (!state.review || state.review.status === "confirmed") return state.review;
  setBusy(true);
  try {
    state.review = await api(`/v1/photo-entries/${state.review.analysis_id}/review`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expected_revision: state.review.revision, items: reviewPayload() }),
    });
    state.dirty = false;
    renderReview();
    if (showSuccess) showNotice(`核对草稿已保存（版本 ${state.review.revision}），尚未写入库存。`);
    return state.review;
  } catch (error) {
    showNotice(error.message, "error");
    throw error;
  } finally {
    setBusy(false);
  }
}

$("save-review").addEventListener("click", () => saveReview(true));

$("add-item").addEventListener("click", () => {
  state.review.items.push({
    review_item_id: null,
    source_item_id: null,
    origin: "manual",
    decision: "pending",
    food_name: "未识别食品",
    brand: null,
    product_variant: null,
    net_content_text: null,
    category: "unknown",
    quantity: 1,
    unit: "piece",
    expiry_date: null,
    expiry_confirmed: false,
    notes: null,
    model_confidence: null,
    model_review_required: false,
    model_review_reasons: [],
    packaging_text_evidence: [],
    model_expiry_date_candidate: null,
    expiry_text_evidence: null,
    corrected_fields: [],
  });
  state.dirty = true;
  finalAck.checked = false;
  renderReview();
  $("review-items").lastElementChild?.scrollIntoView({ behavior: "smooth", block: "center" });
});

function updateConfirmState() {
  const summary = currentSummary();
  const confirmed = state.review?.status === "confirmed";
  $("confirm-button").disabled = state.busy || confirmed || !summary.ready || !finalAck.checked;
  if (confirmed) return;
  if (summary.pending) $("confirm-hint").textContent = `还有 ${summary.pending} 项尚未接受或排除。`;
  else if (summary.unresolved) $("confirm-hint").textContent = `有 ${summary.unresolved} 个接受项缺少数量或单位。`;
  else if (summary.unconfirmedExpiry) $("confirm-hint").textContent = `有 ${summary.unconfirmedExpiry} 个日期尚未单独确认。`;
  else if (!finalAck.checked) $("confirm-hint").textContent = "请勾选最终确认声明。";
  else $("confirm-hint").textContent = "已满足入库条件。";
}

finalAck.addEventListener("change", updateConfirmState);

$("confirm-button").addEventListener("click", async () => {
  if (state.busy || !state.review) return;
  const summary = currentSummary();
  if (!summary.ready || !finalAck.checked) return;
  try {
    const draft = await saveReview(false);
    if (!draft.summary.ready_to_confirm) {
      showNotice("草稿仍有未解决字段，尚未写入库存。", "error");
      return;
    }
    setBusy(true);
    const result = await api(`/v1/photo-entries/${draft.analysis_id}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expected_revision: draft.revision,
        confirm_to_active_inventory: true,
      }),
    });
    state.review.status = "confirmed";
    state.dirty = false;
    localStorage.removeItem("wastewiseCurrentAnalysis");
    history.replaceState(null, "", "/");
    renderReview();
    showNotice(`确认完成：${result.inventory_entries.length} 项已写入 Active Inventory。`);
    await loadInventory();
  } catch (error) {
    showNotice(error.message, "error");
  } finally {
    setBusy(false);
  }
});

async function loadInventory() {
  try {
    const entries = await api("/v1/inventory");
    const body = $("inventory-body");
    body.replaceChildren();
    entries.forEach((entry) => {
      const row = document.createElement("tr");
      const name = document.createElement("td");
      name.textContent = entry.food_name;
      const identity = document.createElement("td");
      identity.textContent = [entry.brand, entry.product_variant, entry.net_content_text].filter(Boolean).join(" · ") || "—";
      const quantity = document.createElement("td");
      quantity.textContent = `${entry.quantity} ${entry.unit}`;
      const expiry = document.createElement("td");
      expiry.textContent = entry.expiry_date || "未填写";
      if (entry.expiry_source) {
        const source = document.createElement("span");
        source.className = "source-note";
        source.textContent = entry.expiry_source === "model_ocr_user_confirmed" ? "模型 OCR · 用户已确认" : "用户填写";
        expiry.append(source);
      }
      const origin = document.createElement("td");
      origin.textContent = entry.origin === "manual" ? "用户补充" : entry.corrected_by_user ? "模型候选 · 已修改" : "模型候选 · 已确认";
      row.append(name, identity, quantity, expiry, origin);
      body.append(row);
    });
    $("inventory-empty").classList.toggle("hidden", entries.length > 0);
    $("inventory-wrap").classList.toggle("hidden", entries.length === 0);
  } catch (error) {
    showNotice(`库存加载失败：${error.message}`, "error");
  }
}

$("refresh-inventory").addEventListener("click", loadInventory);

$("new-analysis").addEventListener("click", () => {
  state.photoFile = null;
  state.analysis = null;
  state.review = null;
  state.dirty = false;
  localStorage.removeItem("wastewiseCurrentAnalysis");
  history.replaceState(null, "", "/");
  photoInput.value = "";
  finalAck.checked = false;
  $("upload-preview").classList.add("hidden");
  dropZone.classList.remove("hidden");
  analyzeButton.classList.remove("hidden");
  reviewSection.classList.add("hidden");
  $("new-analysis").classList.add("hidden");
  hideNotice();
  window.scrollTo({ top: 0, behavior: "smooth" });
});

async function restoreDraft() {
  const analysisId = new URLSearchParams(window.location.search).get("analysis_id")
    || localStorage.getItem("wastewiseCurrentAnalysis");
  if (!analysisId) return;
  try {
    const [analysis, review] = await Promise.all([
      api(`/v1/photo-entries/${analysisId}`),
      api(`/v1/photo-entries/${analysisId}/review`),
    ]);
    state.analysis = analysis;
    state.review = review;
    showStoredReviewImage(analysis);
    renderReview();
    $("new-analysis").classList.remove("hidden");
    showNotice(review.status === "confirmed" ? "已恢复已确认记录。" : "已恢复未完成的核对草稿。");
  } catch (_) {
    localStorage.removeItem("wastewiseCurrentAnalysis");
  }
}

loadInventory();
loadRecognitionConfig();
restoreDraft();
