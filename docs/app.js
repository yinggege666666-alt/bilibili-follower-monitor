const state = {
  updatedAt: null,
  accounts: [],
  selectedUid: null,
  hourlyHistory: [],
  dailyHistory: [],
  days: 30,
  pendingAdd: null,
  summarySort: {
    key: "hour",
    direction: "desc",
  },
};

const elements = {
  connectionStatus: document.getElementById("connectionStatus"),
  statusLine: document.getElementById("statusLine"),
  refreshBtn: document.getElementById("refreshBtn"),
  addForm: document.getElementById("addForm"),
  addUidInput: document.getElementById("addUidInput"),
  addNameInput: document.getElementById("addNameInput"),
  message: document.getElementById("message"),
  periodButtons: document.querySelectorAll("#periodButtons button"),
  accountBand: document.getElementById("accountBand"),
  metricCurrent: document.getElementById("metricCurrent"),
  metricLatestTime: document.getElementById("metricLatestTime"),
  metricHour: document.getElementById("metricHour"),
  metricDay: document.getElementById("metricDay"),
  metricCount: document.getElementById("metricCount"),
  hourlyChartTitle: document.getElementById("hourlyChartTitle"),
  dailyChartTitle: document.getElementById("dailyChartTitle"),
  hourlyChart: document.getElementById("hourlyChart"),
  hourlyChartEmpty: document.getElementById("hourlyChartEmpty"),
  dailyChart: document.getElementById("dailyChart"),
  dailyChartEmpty: document.getElementById("dailyChartEmpty"),
  accountSummaryBody: document.getElementById("accountSummaryBody"),
  summarySortButtons: document.querySelectorAll("[data-sort]"),
  historyBody: document.getElementById("historyBody"),
  openManageBtn: document.getElementById("openManageBtn"),
  closeManageBtn: document.getElementById("closeManageBtn"),
  manageModal: document.getElementById("manageModal"),
  tokenInput: document.getElementById("tokenInput"),
  saveTokenBtn: document.getElementById("saveTokenBtn"),
  manageUidInput: document.getElementById("manageUidInput"),
  manageNameInput: document.getElementById("manageNameInput"),
  addManagedAccountBtn: document.getElementById("addManagedAccountBtn"),
  manageAccountList: document.getElementById("manageAccountList"),
  toast: document.getElementById("toast"),
};

const numberFormat = new Intl.NumberFormat("zh-CN");
const GITHUB_REPO = "yinggege666666-alt/bilibili-follower-monitor";
const TOKEN_KEY = "bili-monitor-github-token";

function formatNumber(value) {
  return numberFormat.format(value);
}

function displayName(account) {
  if (!account) return "";
  if (account.name && account.name !== `UID ${account.uid}`) {
    return account.name;
  }
  return `UID ${account.uid}`;
}

function parseHour(value) {
  const [datePart, hourPart] = String(value).split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const hour = Number(hourPart || 0);
  return new Date(year, month - 1, day, hour, 0, 0);
}

function formatHour(value) {
  const date = parseHour(value);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  return `${month}-${day} ${hour}:00`;
}

function formatDate(value) {
  const [, month, day] = String(value).split("-");
  return `${month}-${day}`;
}

function dateKeyFromDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function hourKeyFromDate(date) {
  const hour = String(date.getHours()).padStart(2, "0");
  return `${dateKeyFromDate(date)}T${hour}`;
}

function dateDeltaForHour(history, dateKey) {
  const points = history.filter((point) => String(point.hour).startsWith(dateKey));
  if (points.length < 2) return null;
  return points[points.length - 1].count - points[0].count;
}

function dateDeltaFromDaily(dailyHistory, dateKey) {
  const index = dailyHistory.findIndex((point) => point.date === dateKey);
  if (index <= 0) return null;
  return dailyHistory[index].count - dailyHistory[index - 1].count;
}

function downsampleSeries(data, maxPoints = 600) {
  if (!data.length || data.length <= maxPoints) return data;

  const bucketSize = Math.ceil(data.length / maxPoints);
  const result = [];
  for (let start = 0; start < data.length; start += bucketSize) {
    const chunk = data.slice(start, start + bucketSize);
    let minPoint = chunk[0];
    let maxPoint = chunk[0];
    for (let index = 1; index < chunk.length; index += 1) {
      if (chunk[index].value < minPoint.value) minPoint = chunk[index];
      if (chunk[index].value > maxPoint.value) maxPoint = chunk[index];
    }
    if (minPoint === maxPoint) {
      result.push(minPoint);
    } else if (data.indexOf(minPoint) < data.indexOf(maxPoint)) {
      result.push(minPoint, maxPoint);
    } else {
      result.push(maxPoint, minPoint);
    }
  }
  return result;
}

function showToast(message, type = "success") {
  elements.toast.textContent = message;
  elements.toast.classList.toggle("error", type === "error");
  elements.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    elements.toast.classList.remove("show");
  }, 3600);
}

function openManageModal() {
  elements.tokenInput.value = localStorage.getItem(TOKEN_KEY) || "";
  if (state.pendingAdd) {
    elements.manageUidInput.value = state.pendingAdd.uidText || "";
    elements.manageNameInput.value = state.pendingAdd.name || "";
  }
  elements.manageModal.hidden = false;
  renderManagedAccounts();
}

function closeManageModal() {
  elements.manageModal.hidden = true;
}

function saveToken() {
  const token = elements.tokenInput.value.trim();
  if (!token) {
    showToast("请先粘贴 GitHub 访问令牌", "error");
    return;
  }
  localStorage.setItem(TOKEN_KEY, token);
  elements.tokenInput.value = token;
  showToast("令牌已保存在当前浏览器");
  state.pendingAdd = null;
  renderManagedAccounts();
}

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

async function githubRequest(path, options = {}) {
  const token = getToken();
  if (!token) throw new Error("请先保存 GitHub 访问令牌");
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || `GitHub 请求失败（${response.status}）`);
  }
  return data;
}

function decodeBase64(value) {
  return decodeURIComponent(
    atob(String(value).replace(/\s/g, ""))
      .split("")
      .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`)
      .join(""),
  );
}

function encodeBase64(value) {
  return btoa(unescape(encodeURIComponent(value)));
}

async function readConfig() {
  const data = await githubRequest(`/repos/${GITHUB_REPO}/contents/config.json`);
  if (!data.content) throw new Error("无法读取 config.json");
  return JSON.parse(decodeBase64(data.content));
}

async function writeConfig(config) {
  const file = await githubRequest(`/repos/${GITHUB_REPO}/contents/config.json`);
  const body = {
    message: "chore: update monitored accounts",
    content: encodeBase64(JSON.stringify(config, null, 2)),
    branch: "main",
  };
  if (file.sha) body.sha = file.sha;
  await githubRequest(`/repos/${GITHUB_REPO}/contents/config.json`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

function mergeConfiguredAccounts(configAccounts) {
  const existing = new Map(
    state.accounts.map((account) => [account.uid, account]),
  );
  state.accounts = configAccounts.map((account) => ({
    ...(existing.get(account.uid) || {}),
    ...account,
  }));
  if (
    state.selectedUid
    && !state.accounts.some((account) => account.uid === state.selectedUid)
  ) {
    state.selectedUid = state.accounts[0]?.uid ?? null;
  }
  if (!state.selectedUid && state.accounts.length) {
    state.selectedUid = state.accounts[0].uid;
  }
  const selected = state.accounts.find(
    (account) => account.uid === state.selectedUid,
  );
  state.hourlyHistory = selected?.hourlyHistory || [];
  state.dailyHistory = selected?.dailyHistory || [];
}

async function triggerCollectWorkflow() {
  await githubRequest(
    `/repos/${GITHUB_REPO}/actions/workflows/collect.yml/dispatches`,
    {
      method: "POST",
      body: JSON.stringify({ ref: "main" }),
    },
  );
}

async function submitAddAccount(uidText, name) {
  const uid = Number(uidText);
  if (!/^[1-9]\d{0,15}$/.test(uidText) || uid <= 0) {
    showToast("请输入有效的 B站 UID", "error");
    return false;
  }
  if (!getToken()) {
    openManageModal();
    showToast("请先保存 GitHub 访问令牌", "error");
    return false;
  }
  name = name.trim();
  try {
    const config = await readConfig();
    const accounts = config.accounts || [];
    const existing = accounts.find((account) => account.uid === uid);
    if (existing) {
      existing.name = name || existing.name || "";
    } else {
      accounts.push({ uid, name });
    }
    await writeConfig({ accounts });
    mergeConfiguredAccounts(accounts);
    await triggerCollectWorkflow();
    showToast(`已添加 UID ${uid}，正在更新数据`);
    render();
    renderManagedAccounts();
    window.setTimeout(refresh, 35000);
    return true;
  } catch (error) {
    showToast(error.message, "error");
    return false;
  }
}

async function addManagedAccount() {
  const uidText = elements.manageUidInput.value.trim();
  const name = elements.manageNameInput.value.trim();
  if (await submitAddAccount(uidText, name)) {
    elements.manageUidInput.value = "";
    elements.manageNameInput.value = "";
  }
}

async function addAccountFromTop(event) {
  event.preventDefault();
  const uidText = elements.addUidInput.value.trim();
  const name = elements.addNameInput.value.trim();
  if (!getToken()) {
    state.pendingAdd = { uidText, name };
    openManageModal();
    showToast("请先保存 GitHub 访问令牌", "error");
    return;
  }
  if (await submitAddAccount(uidText, name)) {
    elements.addUidInput.value = "";
    elements.addNameInput.value = "";
  }
}

async function deleteManagedAccount(uid) {
  const confirmed = window.confirm(`确定移除 UID ${uid} 吗？`);
  if (!confirmed) return;
  try {
    const config = await readConfig();
    config.accounts = (config.accounts || []).filter((account) => account.uid !== uid);
    await writeConfig(config);
    mergeConfiguredAccounts(config.accounts || []);
    await triggerCollectWorkflow();
    showToast(`已移除 UID ${uid}`);
    render();
    renderManagedAccounts();
    window.setTimeout(refresh, 35000);
  } catch (error) {
    showToast(error.message, "error");
  }
}

function renderManagedAccounts() {
  elements.manageAccountList.replaceChildren();
  const accounts = state.accounts;
  if (!accounts.length) {
    const empty = document.createElement("p");
    empty.className = "helper";
    empty.textContent = "还没有账号，输入 UID 后点击添加。";
    elements.manageAccountList.append(empty);
    return;
  }

  for (const account of accounts) {
    const row = document.createElement("div");
    row.className = "managed-account";
    const main = document.createElement("div");
    main.className = "managed-account-main";
    const name = document.createElement("strong");
    name.textContent = displayName(account);
    const uid = document.createElement("span");
    uid.textContent = `UID ${account.uid}`;
    main.append(name, uid);

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "button text-danger compact";
    deleteButton.textContent = "删除";
    deleteButton.addEventListener("click", () => deleteManagedAccount(account.uid));
    row.append(main, deleteButton);
    elements.manageAccountList.append(row);
  }
}

function computeAccountSummary(account) {
  const history = account.hourlyHistory || [];
  const dailyHistory = account.dailyHistory || [];
  const latest = history.at(-1);
  let hourDelta = null;
  if (latest) {
    const previousPoint = history.find(
      (point) => point.hour === hourKeyFromDate(
        new Date(parseHour(latest.hour).getTime() - 60 * 60 * 1000),
      ),
    );
    if (previousPoint) hourDelta = latest.count - previousPoint.count;
  }

  let todayDelta = null;
  let yesterdayDelta = null;
  if (latest) {
    const latestDate = parseHour(latest.hour);
    const todayKey = dateKeyFromDate(latestDate);
    todayDelta = dateDeltaForHour(history, todayKey);

    const yesterday = new Date(
      latestDate.getFullYear(),
      latestDate.getMonth(),
      latestDate.getDate() - 1,
    );
    const yesterdayKey = dateKeyFromDate(yesterday);
    yesterdayDelta = dateDeltaForHour(history, yesterdayKey);
    if (yesterdayDelta == null) {
      yesterdayDelta = dateDeltaFromDaily(dailyHistory, yesterdayKey);
    }
  }

  return {
    uid: account.uid,
    name: displayName(account),
    hour: hourDelta,
    today: todayDelta,
    yesterday: yesterdayDelta,
  };
}

function formatDelta(value) {
  if (value == null) return { text: "--", className: "delta-flat" };
  return {
    text: `${value > 0 ? "+" : ""}${formatNumber(value)}`,
    className: value > 0
      ? "delta-up"
      : value < 0
        ? "delta-down"
        : "delta-flat",
  };
}

function sortSummaryRows(rows) {
  const { key, direction } = state.summarySort;
  const factor = direction === "asc" ? 1 : -1;

  return rows.slice().sort((left, right) => {
    if (key === "name") {
      return left.name.localeCompare(right.name, "zh-CN") * factor;
    }
    const leftValue = key === "uid" ? left.uid : left[key];
    const rightValue = key === "uid" ? right.uid : right[key];
    const leftMissing = leftValue == null;
    const rightMissing = rightValue == null;
    if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;
    if (leftMissing && rightMissing) return 0;
    return (leftValue - rightValue) * factor;
  });
}

function renderAccountSummaryTable() {
  elements.accountSummaryBody.replaceChildren();
  const rows = sortSummaryRows(
    state.accounts.map((account) => computeAccountSummary(account)),
  );

  elements.summarySortButtons.forEach((button) => {
    const icon = button.querySelector(".sort-icon");
    button.classList.toggle("active", button.dataset.sort === state.summarySort.key);
    if (icon) {
      if (button.dataset.sort !== state.summarySort.key) {
        icon.textContent = "↕";
      } else {
        icon.textContent = state.summarySort.direction === "asc" ? "↑" : "↓";
      }
    }
  });

  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 5;
    td.textContent = "还没有监控账号";
    td.style.color = "var(--muted)";
    td.style.textAlign = "center";
    tr.append(td);
    elements.accountSummaryBody.append(tr);
    return;
  }

  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.dataset.uid = row.uid;
    tr.title = `查看 ${row.name}`;

    const nameCell = document.createElement("td");
    nameCell.textContent = row.name;

    const uidCell = document.createElement("td");
    uidCell.className = "uid-cell";
    uidCell.textContent = String(row.uid);

    const values = [
      row.hour,
      row.today,
      row.yesterday,
    ];
    const cells = [nameCell, uidCell];
    for (const value of values) {
      const cell = document.createElement("td");
      const delta = formatDelta(value);
      cell.textContent = delta.text;
      cell.className = delta.className;
      cells.push(cell);
    }

    tr.append(...cells);
    tr.addEventListener("click", () => {
      state.selectedUid = row.uid;
      const account = state.accounts.find((item) => item.uid === row.uid);
      state.hourlyHistory = account?.hourlyHistory || [];
      state.dailyHistory = account?.dailyHistory || [];
      render();
    });
    elements.accountSummaryBody.append(tr);
  }
}

function renderAccountChips() {
  elements.accountBand.replaceChildren();
  for (const account of state.accounts) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "account-chip";
    if (account.uid === state.selectedUid) button.classList.add("active");

    const name = document.createElement("span");
    name.textContent = displayName(account);

    const count = document.createElement("span");
    count.className = "count";
    const latest = account.hourlyHistory?.at(-1);
    count.textContent = latest ? formatNumber(latest.count) : "待记录";

    button.append(name, count);
    button.addEventListener("click", () => {
      state.selectedUid = account.uid;
      state.hourlyHistory = account.hourlyHistory || [];
      state.dailyHistory = account.dailyHistory || [];
      render();
    });
    elements.accountBand.append(button);
  }
}

function computeDeltas() {
  const history = state.hourlyHistory;
  if (!history.length) return { hour: null, day: null };
  const latest = history[history.length - 1];
  const previous = history.length > 1 ? history[history.length - 2] : null;
  const hourDelta = previous ? latest.count - previous.count : null;

  const latestDate = parseHour(latest.hour);
  const dayTarget = new Date(latestDate.getTime() - 24 * 60 * 60 * 1000);
  let dayBase = null;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (parseHour(history[index].hour) <= dayTarget) {
      dayBase = history[index];
      break;
    }
  }
  const dayDelta = dayBase ? latest.count - dayBase.count : null;
  return { hour: hourDelta, day: dayDelta };
}

function setDeltaClass(element, delta) {
  element.classList.remove("positive", "negative");
  if (delta == null) return;
  if (delta > 0) element.classList.add("positive");
  if (delta < 0) element.classList.add("negative");
}

function renderOverview() {
  const account = state.accounts.find((item) => item.uid === state.selectedUid);
  const latest = state.hourlyHistory.at(-1);
  const deltas = computeDeltas();

  elements.metricCurrent.textContent = latest
    ? formatNumber(latest.count)
    : "--";
  elements.metricLatestTime.textContent = latest
    ? `更新于 ${formatHour(latest.hour)}`
    : "尚未记录";
  elements.metricCount.textContent = String(state.hourlyHistory.length);

  elements.metricHour.textContent = deltas.hour == null
    ? "--"
    : `${deltas.hour > 0 ? "+" : ""}${formatNumber(deltas.hour)}`;
  setDeltaClass(elements.metricHour, deltas.hour);

  elements.metricDay.textContent = deltas.day == null
    ? "--"
    : `${deltas.day > 0 ? "+" : ""}${formatNumber(deltas.day)}`;
  setDeltaClass(elements.metricDay, deltas.day);

  elements.hourlyChartTitle.textContent = account
    ? `${displayName(account)}·小时新增`
    : "暂无监控账号";
  elements.dailyChartTitle.textContent = account
    ? `${displayName(account)}·总粉丝（天）`
    : "暂无监控账号";
}

function drawLineChart(svg, emptyElement, data, options = {}) {
  svg.replaceChildren();
  if (!data.length) {
    emptyElement.hidden = false;
    return;
  }
  emptyElement.hidden = true;

  const width = 900;
  const height = 320;
  const margin = { top: 30, right: 28, bottom: 50, left: 76 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const values = data.map((point) => point.value);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const spread = rawMax - rawMin || Math.max(rawMax, 1) * 0.02 || 1;
  const minValue = Math.max(0, rawMin - spread * 0.18);
  const maxValue = rawMax + spread * 0.18;

  const x = (index) => {
    if (data.length === 1) return margin.left + plotWidth / 2;
    return margin.left + (index / (data.length - 1)) * plotWidth;
  };
  const y = (value) => (
    margin.top + ((maxValue - value) / (maxValue - minValue)) * plotHeight
  );

  const svgNamespace = "http://www.w3.org/2000/svg";
  const make = (tag, attributes = {}) => {
    const node = document.createElementNS(svgNamespace, tag);
    for (const [key, value] of Object.entries(attributes)) {
      node.setAttribute(key, String(value));
    }
    return node;
  };

  for (let index = 0; index <= 4; index += 1) {
    const ratio = index / 4;
    const value = maxValue - ratio * (maxValue - minValue);
    const gridY = margin.top + ratio * plotHeight;
    svg.append(
      make("line", {
        x1: margin.left,
        x2: width - margin.right,
        y1: gridY,
        y2: gridY,
        class: "chart-grid",
      }),
      make("text", {
        x: margin.left - 10,
        y: gridY + 4,
        "text-anchor": "end",
        class: "chart-axis",
      }),
    );
    svg.lastChild.textContent = formatNumber(Math.round(value));
  }

  const labelCount = Math.min(6, data.length);
  const labelIndexes = new Set();
  if (labelCount > 1) {
    for (let index = 0; index < labelCount; index += 1) {
      labelIndexes.add(Math.round((index / (labelCount - 1)) * (data.length - 1)));
    }
  } else {
    labelIndexes.add(0);
  }

  for (const index of labelIndexes) {
    const label = make("text", {
      x: x(index),
      y: height - 18,
      "text-anchor": index === 0 ? "start" : index === data.length - 1 ? "end" : "middle",
      class: "chart-axis",
    });
    label.textContent = options.formatLabel
      ? options.formatLabel(data[index].label)
      : data[index].label;
    svg.append(label);
  }

  const linePath = [];
  const areaPath = [];
  data.forEach((point, index) => {
    const px = x(index);
    const py = y(point.value);
    if (index === 0) {
      linePath.push(`M ${px} ${py}`);
      areaPath.push(`M ${px} ${margin.top + plotHeight}`);
      areaPath.push(`L ${px} ${py}`);
    } else {
      linePath.push(`L ${px} ${py}`);
      areaPath.push(`L ${px} ${py}`);
    }
  });
  const lastX = x(data.length - 1);
  areaPath.push(`L ${lastX} ${margin.top + plotHeight}`);
  areaPath.push("Z");

  svg.append(
    make("path", { d: areaPath.join(" "), class: "chart-area" }),
    make("path", { d: linePath.join(" "), class: "chart-line" }),
  );

  const pointRadius = data.length > 60 ? 2.2 : 3.2;
  for (let index = 0; index < data.length; index += 1) {
    svg.append(
      make("circle", {
        cx: x(index),
        cy: y(data[index].value),
        r: pointRadius,
        class: "chart-point",
        "data-index": index,
      }),
    );
  }

  const crosshair = make("line", {
    x1: 0,
    x2: 0,
    y1: margin.top,
    y2: margin.top + plotHeight,
    class: "chart-crosshair",
    opacity: 0,
  });
  const highlight = make("circle", {
    r: 5,
    class: "chart-point",
    opacity: 0,
  });
  const tooltipBg = make("rect", {
    rx: 5,
    ry: 5,
    fill: "#22303f",
    opacity: 0,
  });
  const tooltipValue = make("text", {
    class: "chart-tooltip",
    fill: "#ffffff",
  });
  const tooltipTime = make("text", {
    class: "chart-tooltip-sub",
    fill: "#d8e0eb",
  });
  svg.append(crosshair, highlight, tooltipBg, tooltipValue, tooltipTime);

  function getNearestIndex(event) {
    const rect = svg.getBoundingClientRect();
    const scaleX = width / rect.width;
    const mouseX = (event.clientX - rect.left) * scaleX;
    let nearest = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < data.length; index += 1) {
      const distance = Math.abs(mouseX - x(index));
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = index;
      }
    }
    return nearest;
  }

  function showTooltip(index) {
    const px = x(index);
    const py = y(data[index].value);
    crosshair.setAttribute("x1", px);
    crosshair.setAttribute("x2", px);
    crosshair.setAttribute("opacity", 1);
    highlight.setAttribute("cx", px);
    highlight.setAttribute("cy", py);
    highlight.setAttribute("opacity", 1);

    const textX = px + 12;
    const textY = Math.max(margin.top + 6, py - 34);
    tooltipValue.textContent = data[index].tooltip || formatNumber(data[index].value);
    tooltipTime.textContent = options.formatLabel
      ? options.formatLabel(data[index].label)
      : data[index].label;
    tooltipValue.setAttribute("x", textX + 8);
    tooltipValue.setAttribute("y", textY + 17);
    tooltipTime.setAttribute("x", textX + 8);
    tooltipTime.setAttribute("y", textY + 34);

    tooltipBg.setAttribute("x", textX);
    tooltipBg.setAttribute("y", textY);
    tooltipBg.setAttribute("width", 130);
    tooltipBg.setAttribute("height", 48);
    tooltipBg.setAttribute("opacity", 0.94);
  }

  function hideTooltip() {
    crosshair.setAttribute("opacity", 0);
    highlight.setAttribute("opacity", 0);
    tooltipBg.setAttribute("opacity", 0);
    tooltipValue.textContent = "";
    tooltipTime.textContent = "";
  }

  svg.addEventListener("mousemove", (event) => showTooltip(getNearestIndex(event)));
  svg.addEventListener("mouseleave", hideTooltip);
}

function renderCharts() {
  const hourlyHistory = state.days
    ? state.hourlyHistory.slice(-state.days * 24)
    : state.hourlyHistory;
  const dailyHistory = state.days
    ? state.dailyHistory.slice(-state.days)
    : state.dailyHistory;

  const hourlyDelta = hourlyHistory
    .map((point, index) => {
      if (index === 0) return null;
      const previous = hourlyHistory[index - 1];
      const delta = point.count - previous.count;
      return {
        label: point.hour,
        value: delta,
        tooltip: `${delta > 0 ? "+" : ""}${formatNumber(delta)} 新增`,
      };
    })
    .filter(Boolean);

  const dailyTotal = dailyHistory.map((point) => ({
    label: point.date,
    value: point.count,
    tooltip: `${formatNumber(point.count)} 粉丝`,
  }));

  drawLineChart(
    elements.hourlyChart,
    elements.hourlyChartEmpty,
    downsampleSeries(hourlyDelta),
    {
    formatLabel: formatHour,
    },
  );
  drawLineChart(
    elements.dailyChart,
    elements.dailyChartEmpty,
    downsampleSeries(dailyTotal, 400),
    {
    formatLabel: formatDate,
    },
  );
}

function renderTable() {
  elements.historyBody.replaceChildren();
  const rows = state.hourlyHistory
    .slice(-24)
    .map((point, sliceIndex) => {
      const fullIndex = state.hourlyHistory.length - 24 + sliceIndex;
      const previous = fullIndex > 0 ? state.hourlyHistory[fullIndex - 1] : null;
      return { point, previous };
    })
    .reverse();

  if (!rows.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 3;
    cell.textContent = "暂无记录";
    cell.style.color = "var(--muted)";
    cell.style.textAlign = "center";
    row.append(cell);
    elements.historyBody.append(row);
    return;
  }

  for (const { point, previous } of rows) {
    const tr = document.createElement("tr");
    const timeCell = document.createElement("td");
    timeCell.textContent = formatHour(point.hour);
    const countCell = document.createElement("td");
    countCell.textContent = formatNumber(point.count);
    const deltaCell = document.createElement("td");
    if (!previous) {
      deltaCell.textContent = "--";
      deltaCell.className = "delta-flat";
    } else {
      const delta = point.count - previous.count;
      deltaCell.textContent = `${delta > 0 ? "+" : ""}${formatNumber(delta)}`;
      deltaCell.className = delta > 0
        ? "delta-up"
        : delta < 0
          ? "delta-down"
          : "delta-flat";
    }
    tr.append(timeCell, countCell, deltaCell);
    elements.historyBody.append(tr);
  }
}

function render() {
  renderAccountChips();
  renderAccountSummaryTable();
  renderOverview();
  renderCharts();
  renderTable();
  renderStatus();
}

function renderStatus() {
  const latest = state.hourlyHistory.at(-1);
  elements.statusLine.textContent = latest
    ? `上次更新：${formatHour(latest.hour)} · 云端每小时自动更新`
    : "正在等待首次采集 · 云端每小时自动更新";
}

async function loadData() {
  const response = await fetch(`./data.json?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error("读取 data.json 失败");
  const data = await response.json();
  state.updatedAt = data.updatedAt || null;
  state.accounts = data.accounts || [];
  if (!state.selectedUid || !state.accounts.some((account) => account.uid === state.selectedUid)) {
    state.selectedUid = state.accounts[0]?.uid ?? null;
  }
  const selected = state.accounts.find((account) => account.uid === state.selectedUid);
  state.hourlyHistory = selected?.hourlyHistory || [];
  state.dailyHistory = selected?.dailyHistory || [];
  elements.connectionStatus.textContent = "已连接 GitHub 数据";
  elements.connectionStatus.classList.remove("error");
  render();
}

async function refresh() {
  try {
    await loadData();
  } catch (error) {
    elements.connectionStatus.textContent = "数据加载失败";
    elements.connectionStatus.classList.add("error");
  }
}

elements.openManageBtn.addEventListener("click", openManageModal);
elements.closeManageBtn.addEventListener("click", closeManageModal);
elements.saveTokenBtn.addEventListener("click", saveToken);
elements.addManagedAccountBtn.addEventListener("click", addManagedAccount);
elements.manageModal.addEventListener("click", (event) => {
  if (event.target.closest("[data-close-modal]")) closeManageModal();
});
elements.manageUidInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") addManagedAccount();
});
elements.manageNameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") addManagedAccount();
});
elements.addForm.addEventListener("submit", addAccountFromTop);
elements.refreshBtn.addEventListener("click", refresh);
elements.periodButtons.forEach((button) => {
  button.addEventListener("click", () => {
    elements.periodButtons.forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.days = Number(button.dataset.days);
    renderCharts();
  });
});

elements.summarySortButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const key = button.dataset.sort;
    if (state.summarySort.key === key) {
      state.summarySort.direction = state.summarySort.direction === "asc"
        ? "desc"
        : "asc";
    } else {
      state.summarySort.key = key;
      state.summarySort.direction = key === "name" ? "asc" : "desc";
    }
    renderAccountSummaryTable();
  });
});

refresh();
window.setInterval(() => {
  if (document.visibilityState === "visible") refresh();
}, 300000);
