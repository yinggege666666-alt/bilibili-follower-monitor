const state = {
  accounts: [],
  selectedUid: null,
  account: null,
  history: [],
  dailyHistory: [],
  requestId: 0,
};

const elements = {
  connectionStatus: document.getElementById("connectionStatus"),
  collectAllBtn: document.getElementById("collectAllBtn"),
  uidInput: document.getElementById("uidInput"),
  nameInput: document.getElementById("nameInput"),
  addAccountBtn: document.getElementById("addAccountBtn"),
  accountBand: document.getElementById("accountBand"),
  metricCurrent: document.getElementById("metricCurrent"),
  metricLatestTime: document.getElementById("metricLatestTime"),
  metricHour: document.getElementById("metricHour"),
  metricDay: document.getElementById("metricDay"),
  metricCount: document.getElementById("metricCount"),
  hourlyChartTitle: document.getElementById("hourlyChartTitle"),
  dailyChartTitle: document.getElementById("dailyChartTitle"),
  collectSelectedBtn: document.getElementById("collectSelectedBtn"),
  deleteAccountBtn: document.getElementById("deleteAccountBtn"),
  hourlyChart: document.getElementById("hourlyChart"),
  hourlyChartEmpty: document.getElementById("hourlyChartEmpty"),
  dailyChart: document.getElementById("dailyChart"),
  dailyChartEmpty: document.getElementById("dailyChartEmpty"),
  historyBody: document.getElementById("historyBody"),
  toast: document.getElementById("toast"),
};

const numberFormat = new Intl.NumberFormat("zh-CN");

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

function showToast(message, type = "success") {
  elements.toast.textContent = message;
  elements.toast.classList.toggle("error", type === "error");
  elements.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    elements.toast.classList.remove("show");
  }, 3200);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `请求失败（${response.status}）`);
  }
  return data;
}

function setConnection(status) {
  if (status === "loading") {
    elements.connectionStatus.textContent = "连接中";
    elements.connectionStatus.classList.remove("error");
    return;
  }
  elements.connectionStatus.textContent = "运行中";
  elements.connectionStatus.classList.remove("error");
}

function setConnectionError() {
  elements.connectionStatus.textContent = "连接异常";
  elements.connectionStatus.classList.add("error");
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

function renderAccountChips() {
  elements.accountBand.replaceChildren();
  if (!state.accounts.length) {
    elements.accountBand.hidden = false;
    elements.accountBand.style.minHeight = "0";
    return;
  }
  elements.accountBand.style.minHeight = "";

  for (const account of state.accounts) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "account-chip";
    if (account.uid === state.selectedUid) button.classList.add("active");

    const name = document.createElement("span");
    name.textContent = displayName(account);

    const count = document.createElement("span");
    count.className = "count";
    count.textContent = account.latest_count == null
      ? "待记录"
      : formatNumber(account.latest_count);

    button.append(name, count);
    button.addEventListener("click", () => selectAccount(account.uid));
    elements.accountBand.append(button);
  }
}

function selectAccount(uid) {
  state.selectedUid = uid;
  renderAccountChips();
  loadSelectedAccount();
}

function computeDeltas() {
  const history = state.history;
  if (!history.length) {
    return { hour: null, day: null };
  }
  const latest = history[history.length - 1];
  const previous = history.length > 1 ? history[history.length - 2] : null;
  const hourDelta = previous
    ? latest.follower_count - previous.follower_count
    : null;

  const latestDate = parseHour(latest.collected_hour);
  const dayTarget = new Date(latestDate.getTime() - 24 * 60 * 60 * 1000);
  let dayBase = null;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (parseHour(history[index].collected_hour) <= dayTarget) {
      dayBase = history[index];
      break;
    }
  }
  const dayDelta = dayBase
    ? latest.follower_count - dayBase.follower_count
    : null;
  return { hour: hourDelta, day: dayDelta };
}

function setDeltaClass(element, delta) {
  element.classList.remove("positive", "negative");
  if (delta == null) return;
  if (delta > 0) element.classList.add("positive");
  if (delta < 0) element.classList.add("negative");
}

function renderOverview() {
  const account = state.account;
  const deltas = computeDeltas();

  elements.metricCurrent.textContent = account?.latest_count == null
    ? "--"
    : formatNumber(account.latest_count);
  elements.metricLatestTime.textContent = account?.latest_hour
    ? `更新于 ${formatHour(account.latest_hour)}`
    : "尚未记录";
  elements.metricCount.textContent = String(state.history.length);

  elements.metricHour.textContent = deltas.hour == null
    ? "--"
    : `${deltas.hour > 0 ? "+" : ""}${formatNumber(deltas.hour)}`;
  setDeltaClass(elements.metricHour, deltas.hour);

  elements.metricDay.textContent = deltas.day == null
    ? "--"
    : `${deltas.day > 0 ? "+" : ""}${formatNumber(deltas.day)}`;
  setDeltaClass(elements.metricDay, deltas.day);

  const hasAccount = Boolean(state.selectedUid);
  elements.collectSelectedBtn.disabled = !hasAccount;
  elements.deleteAccountBtn.disabled = !hasAccount;
  elements.hourlyChartTitle.textContent = hasAccount
    ? `${displayName(account)}·小时新增`
    : "请先添加账号";
  elements.dailyChartTitle.textContent = hasAccount
    ? `${displayName(account)}·总粉丝（天）`
    : "请先添加账号";
}

function buildLineData(history, valueKey, labelKey, unit = "") {
  return history
    .map((point, index) => {
      const value = Number(point[valueKey]);
      const previous = index > 0 ? Number(history[index - 1][valueKey]) : null;
      return {
        label: point[labelKey],
        value,
        delta: previous == null ? null : value - previous,
        tooltip: `${formatNumber(value)}${unit}`,
      };
    })
    .filter((point) => Number.isFinite(point.value));
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

  const tickCount = 4;
  for (let index = 0; index <= tickCount; index += 1) {
    const ratio = index / tickCount;
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

    const boxWidth = 130;
    const boxX = textX;
    const boxY = textY;
    tooltipBg.setAttribute("x", boxX);
    tooltipBg.setAttribute("y", boxY);
    tooltipBg.setAttribute("width", boxWidth);
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

  svg.addEventListener("mousemove", (event) => {
    showTooltip(getNearestIndex(event));
  });
  svg.addEventListener("mouseleave", hideTooltip);
}

function formatDateLabel(value) {
  const [, month, day] = String(value).split("-");
  return `${month}-${day}`;
}

function buildHourlyDeltaData(history) {
  return history
    .map((point, index) => {
      if (index === 0) return null;
      const previous = history[index - 1];
      const delta = point.follower_count - previous.follower_count;
      return {
        label: point.collected_hour,
        value: delta,
        tooltip: `${delta > 0 ? "+" : ""}${formatNumber(delta)} 新增`,
      };
    })
    .filter(Boolean);
}

function buildDailyData(dailyHistory) {
  return dailyHistory.map((point) => ({
    label: point.collected_date,
    value: point.follower_count,
    tooltip: `${formatNumber(point.follower_count)} 粉丝`,
  }));
}

function renderCharts() {
  const hourlyDelta = buildHourlyDeltaData(state.history);
  const dailyTotal = buildDailyData(state.dailyHistory || []);
  drawLineChart(
    elements.hourlyChart,
    elements.hourlyChartEmpty,
    hourlyDelta,
    { formatLabel: formatHour },
  );
  drawLineChart(
    elements.dailyChart,
    elements.dailyChartEmpty,
    dailyTotal,
    { formatLabel: formatDateLabel },
  );
}

function renderTable() {
  elements.historyBody.replaceChildren();
  const rows = state.history
    .slice(-24)
    .map((point, sliceIndex) => {
      const fullIndex = state.history.length - 24 + sliceIndex;
      const previous = fullIndex > 0 ? state.history[fullIndex - 1] : null;
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
    timeCell.textContent = formatHour(point.collected_hour);

    const countCell = document.createElement("td");
    countCell.textContent = formatNumber(point.follower_count);

    const deltaCell = document.createElement("td");
    if (!previous) {
      deltaCell.textContent = "--";
      deltaCell.className = "delta-flat";
    } else {
      const delta = point.follower_count - previous.follower_count;
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
  renderOverview();
  renderCharts();
  renderTable();
}

async function loadAccounts() {
  const data = await api("/api/accounts");
  state.accounts = data.accounts;
  if (state.selectedUid && !state.accounts.some((account) => account.uid === state.selectedUid)) {
    state.selectedUid = null;
    state.account = null;
    state.history = [];
    state.dailyHistory = [];
  }
  if (!state.selectedUid && state.accounts.length) {
    state.selectedUid = state.accounts[0].uid;
  }
}

async function loadSelectedAccount() {
  if (!state.selectedUid) {
    state.account = null;
    state.history = [];
    state.dailyHistory = [];
    render();
    return;
  }
  const data = await api(`/api/accounts/${state.selectedUid}/history?hours=168`);
  state.account = data.account;
  state.history = data.history;
  state.dailyHistory = data.dailyHistory || [];
  render();
}

async function refresh() {
  const requestId = ++state.requestId;
  setConnection("loading");
  try {
    await loadAccounts();
    if (requestId !== state.requestId) return;
    await loadSelectedAccount();
    if (requestId === state.requestId) setConnection();
  } catch (error) {
    if (requestId === state.requestId) {
      setConnectionError();
      showToast(error.message, "error");
    }
  }
}

function setBusy(button, busy, busyText) {
  if (busy) {
    button.dataset.originalHtml = button.innerHTML;
    button.innerHTML = busyText;
    button.disabled = true;
  } else {
    button.innerHTML = button.dataset.originalHtml || button.innerHTML;
    button.disabled = false;
  }
}

async function addAccount() {
  const uidText = elements.uidInput.value.trim();
  const uid = Number(uidText);
  if (!/^[1-9]\d{0,15}$/.test(uidText) || uid <= 0) {
    showToast("请输入有效的 B站 UID", "error");
    elements.uidInput.focus();
    return;
  }

  const name = elements.nameInput.value.trim();
  setBusy(elements.addAccountBtn, true, "记录中");
  try {
    const data = await api("/api/accounts", {
      method: "POST",
      body: JSON.stringify({ uid, name }),
    });
    state.selectedUid = uid;
    state.account = data.account;
    state.history = data.history;
    state.dailyHistory = data.dailyHistory || [];
    elements.uidInput.value = "";
    elements.nameInput.value = "";
    await loadAccounts();
    render();
    showToast(`已记录 UID ${uid} 的粉丝数`);
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    setBusy(elements.addAccountBtn, false);
  }
}

async function collectSelected() {
  if (!state.selectedUid) return;
  setBusy(elements.collectSelectedBtn, true, "记录中");
  try {
    const data = await api(`/api/accounts/${state.selectedUid}/collect`, {
      method: "POST",
      body: "{}",
    });
    state.account = data.account;
    state.history = data.history;
    state.dailyHistory = data.dailyHistory || [];
    await loadAccounts();
    render();
    showToast("已更新当前小时记录");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    setBusy(elements.collectSelectedBtn, false);
  }
}

async function collectAll() {
  setBusy(elements.collectAllBtn, true, "记录中");
  try {
    const data = await api("/api/collect-all", {
      method: "POST",
      body: "{}",
    });
    if (data.errors.length) {
      showToast(`部分账号记录失败：${data.errors.length} 个`, "error");
    } else {
      showToast("全部账号已更新");
    }
    await refresh();
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    setBusy(elements.collectAllBtn, false);
  }
}

async function deleteSelected() {
  if (!state.selectedUid) return;
  const name = displayName(state.account);
  const confirmed = window.confirm(`确定移除“${name}”及其全部历史记录吗？`);
  if (!confirmed) return;
  try {
    await api(`/api/accounts/${state.selectedUid}`, { method: "DELETE" });
    state.selectedUid = null;
    state.account = null;
    state.history = [];
    state.dailyHistory = [];
    showToast("账号已移除");
    await refresh();
  } catch (error) {
    showToast(error.message, "error");
  }
}

elements.addAccountBtn.addEventListener("click", addAccount);
elements.collectSelectedBtn.addEventListener("click", collectSelected);
elements.collectAllBtn.addEventListener("click", collectAll);
elements.deleteAccountBtn.addEventListener("click", deleteSelected);
elements.uidInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") addAccount();
});
elements.nameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") addAccount();
});

window.addEventListener("focus", () => {
  refresh();
});

refresh();
window.setInterval(() => {
  if (document.visibilityState === "visible") refresh();
}, 60000);
