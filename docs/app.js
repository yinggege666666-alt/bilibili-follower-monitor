const state = {
  updatedAt: null,
  accounts: [],
  selectedUid: null,
  hourlyHistory: [],
  dailyHistory: [],
};

const elements = {
  connectionStatus: document.getElementById("connectionStatus"),
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
  historyBody: document.getElementById("historyBody"),
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

  const daily = state.dailyHistory;
  const latestDaily = daily.at(-1);
  const previousDaily = daily.length > 1 ? daily[daily.length - 2] : null;
  const dayDelta = latestDaily && previousDaily
    ? latestDaily.count - previousDaily.count
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
  const hourlyDelta = state.hourlyHistory
    .map((point, index) => {
      if (index === 0) return null;
      const previous = state.hourlyHistory[index - 1];
      const delta = point.count - previous.count;
      return {
        label: point.hour,
        value: delta,
        tooltip: `${delta > 0 ? "+" : ""}${formatNumber(delta)} 新增`,
      };
    })
    .filter(Boolean);

  const dailyTotal = state.dailyHistory.map((point) => ({
    label: point.date,
    value: point.count,
    tooltip: `${formatNumber(point.count)} 粉丝`,
  }));

  drawLineChart(elements.hourlyChart, elements.hourlyChartEmpty, hourlyDelta, {
    formatLabel: formatHour,
  });
  drawLineChart(elements.dailyChart, elements.dailyChartEmpty, dailyTotal, {
    formatLabel: formatDate,
  });
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
  renderOverview();
  renderCharts();
  renderTable();
}

async function loadData() {
  const response = await fetch(`data.json?t=${Date.now()}`, { cache: "no-store" });
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

refresh();
window.setInterval(() => {
  if (document.visibilityState === "visible") refresh();
}, 300000);
