// ---------------- Global state ----------------
let data = [];              // [{ ticker, name, rank, history, rankByDate }]
let allDates = [];          // all dates seen in history
let chartDates = [];        // last ~3 months of dates
let todayStr = "";          // the "as-of" date we treat as "today"
let rankChart = null;       // Chart.js instance for the combined chart
let selectedTickers = new Set(); // tickers currently plotted

// (kept for compatibility with existing HTML, but no longer really used)
let dateList = [];
let currentDateIndex = 0;

// ---------------- Tab handling ----------------
function showTab(tabId) {
  const ids = ["home", "rankings", "news", "info"];
  ids.forEach(id => {
    const section = document.getElementById(id);
    if (section) {
      section.classList.toggle("hidden", id !== tabId);
    }
    const btn = document.getElementById("tab-" + id);
    if (btn) {
      if (id === tabId) {
        btn.classList.add("bg-slate-800/80", "text-slate-50");
        btn.classList.remove("text-slate-300");
      } else {
        btn.classList.remove("bg-slate-800/80", "text-slate-50");
        btn.classList.add("text-slate-300");
      }
    }
  });
}

// ---------------- Helpers ----------------
function parseISO(dateStr) {
  return new Date(dateStr + "T00:00:00Z");
}

function formatISO(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(dateStr, delta) {
  const d = parseISO(dateStr);
  d.setUTCDate(d.getUTCDate() + delta);
  return formatISO(d);
}

// Get last point with date <= target
function getPointOnOrBefore(history, targetDate) {
  let candidate = null;
  for (const pt of history) {
    if (pt.date <= targetDate) {
      if (!candidate || pt.date > candidate.date) {
        candidate = pt;
      }
    }
  }
  return candidate;
}

// Get a point in a window (inclusive). If fromPast = true, prefer earliest;
// otherwise prefer latest.
function getPointInRange(history, startDate, endDate, fromPast) {
  const pts = history.filter(
    pt => pt.date >= startDate && pt.date <= endDate
  );
  if (!pts.length) return null;
  return fromPast ? pts[0] : pts[pts.length - 1];
}

// Format a rank change number into text + CSS class
function formatDelta(delta) {
  if (delta == null || isNaN(delta)) {
    return { text: "—", className: "text-slate-500" };
  }
  if (delta === 0) {
    return { text: "0", className: "text-slate-400" };
  }

  const sign = delta > 0 ? "+" : "−";
  const absVal = Math.abs(delta);
  // Remember: smaller rank number is *better*
  const improved = delta < 0; // negative change = improved rank
  return {
    text: `${sign}${absVal}`,
    className: improved ? "text-emerald-300" : "text-rose-300"
  };
}

function updateSelectedDateLabel() {
  const label = document.getElementById("selectedDate");
  if (!label || !todayStr) return;
  label.textContent = todayStr;
}

// ---------------- Data loading ----------------
async function loadData() {
  try {
    const response = await fetch("rankings.json");
    if (!response.ok) {
      throw new Error("Failed to load rankings.json");
    }
    const raw = await response.json();

    // Normalise into a clean structure:
    // data = [{ ticker, name, rank, history: [{date, rank}], rankByDate: {date -> rank} }]
    data = raw.map(item => {
      const ticker = item.ticker || item.Ticker;
      const name = item.name || ticker;
      const history = Array.isArray(item.history)
        ? [...item.history].sort((a, b) => a.date.localeCompare(b.date))
        : [];

      const rankByDate = {};
      history.forEach(pt => {
        rankByDate[pt.date] = pt.rank;
      });

      // Fallback rank if not present: use latest history point
      const latest = history[history.length - 1] || {};
      const rank = item.rank ?? item.Rank ?? latest.rank ?? null;

      return { ticker, name, rank, history, rankByDate };
    });

    // Build universe of dates from all histories
    const dateSet = new Set();
    data.forEach(t => {
      t.history.forEach(pt => dateSet.add(pt.date));
    });
    allDates = Array.from(dateSet).sort();
    if (!allDates.length) return;

    // Decide what "today" means:
    // Use the latest date <= actual system date if possible, otherwise just use the last date in the file.
    const actualTodayStr = "2025-12-03"; // adjust if you re-run model in future
    let best = null;
    for (const d of allDates) {
      if (d <= actualTodayStr && (!best || d > best)) {
        best = d;
      }
    }
    todayStr = best || allDates[allDates.length - 1];

    // Limit chart to last ~3 months before todayStr
    const cutoffStr = addDays(todayStr, -90);
    chartDates = allDates.filter(d => d >= cutoffStr && d <= todayStr);

    // Hook up the date slider just to show the as-of date (no real interaction now)
    const slider = document.getElementById("dateSlider");
    if (slider) {
      dateList = [todayStr];
      currentDateIndex = 0;
      slider.min = 0;
      slider.max = 0;
      slider.value = 0;
      slider.disabled = true;
    }

    updateSelectedDateLabel();
    renderTable();
    initChart();
  } catch (err) {
    console.error(err);
    const tbody = document.getElementById("tableBody");
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="4" class="px-3 py-4 text-xs text-red-300">
            Failed to load rankings.json
          </td>
        </tr>`;
    }
  }
}

// ---------------- Rankings table ----------------
function renderTable() {
  const tbody = document.getElementById("tableBody");
  if (!tbody || !data.length || !todayStr) return;

  const limitSelect = document.getElementById("rankLimit");
  let limit = parseInt(limitSelect?.value ?? "5", 10);
  if (!isFinite(limit) || limit < 1) limit = 5;

  const pastStart = addDays(todayStr, -7);
  const futureEnd = addDays(todayStr, +7);

  // Build enriched rows with today rank and deltas
  let rows = data
    .map(t => {
      const hist = t.history;
      if (!hist.length) return null;

      const todayPoint = getPointOnOrBefore(hist, todayStr);
      if (!todayPoint) return null;

      // Only keep tickers that have an explicit point ON todayStr
      const hasExactToday = hist.some(pt => pt.date === todayStr);
      if (!hasExactToday) return null;

      const pastPoint = getPointInRange(hist, pastStart, todayStr, true);
      const futurePoint = getPointInRange(hist, todayStr, futureEnd, false);

      const todayRank = todayPoint.rank;
      const pastRank = pastPoint ? pastPoint.rank : null;
      const futureRank = futurePoint ? futurePoint.rank : null;

      const pastDelta =
        pastRank != null ? todayRank - pastRank : null; // today vs 1w ago
      const futureDelta =
        futureRank != null ? futureRank - todayRank : null; // 1w ahead vs today

      return {
        ticker: t.ticker,
        name: t.name,
        todayRank,
        pastDelta,
        futureDelta
      };
    })
    .filter(r => r && r.todayRank != null)
    .sort((a, b) => a.todayRank - b.todayRank); // 1 = best

  const slice = limit >= rows.length || limit > 9000 ? rows : rows.slice(0, limit);

  tbody.innerHTML = "";

  slice.forEach(row => {
    const tr = document.createElement("tr");
    tr.className = "hover:bg-slate-800/60 cursor-pointer transition";

    const pastMeta = formatDelta(row.pastDelta);
    const futureMeta = formatDelta(row.futureDelta);

    tr.innerHTML = `
      <td class="px-3 py-2 text-xs text-slate-300">${row.todayRank}</td>
      <td class="px-3 py-2 text-xs font-semibold text-emerald-300">${row.ticker}</td>
      <td class="px-3 py-2 text-xs ${pastMeta.className}">${pastMeta.text}</td>
      <td class="px-3 py-2 text-xs ${futureMeta.className}">${futureMeta.text}</td>
    `;

    tr.addEventListener("click", () => toggleTickerOnChart(row.ticker));
    tbody.appendChild(tr);
  });

  if (!slice.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" class="px-3 py-4 text-xs text-slate-400">
          No rankings available for today.
        </td>
      </tr>`;
  }
}

// ---------------- Combined chart (last 3 months) ----------------
function initChart() {
  const canvas = document.getElementById("rankChart");
  if (!canvas || !chartDates.length) return;

  const ctx = canvas.getContext("2d");
  rankChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: chartDates,
      datasets: []
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      aspectRatio: 2,
      scales: {
        y: {
          reverse: true, // rank 1 at the top
          ticks: { color: "#94a3b8", font: { size: 8 } },
          grid: { color: "rgba(148,163,184,0.1)" }
        },
        x: {
          ticks: { color: "#64748b", maxTicksLimit: 6, font: { size: 7 } },
          grid: { display: false }
        }
      },
      plugins: {
        legend: {
          labels: { color: "#e2e8f0", font: { size: 9 } }
        },
        tooltip: {
          callbacks: {
            label: ctx => `Rank: ${ctx.parsed.y}`
          }
        }
      }
    }
  });
}

function toggleTickerOnChart(ticker) {
  if (!rankChart) return;

  if (selectedTickers.has(ticker)) {
    selectedTickers.delete(ticker);
  } else {
    selectedTickers.add(ticker);
  }
  updateChartDatasets();
}

function updateChartDatasets() {
  if (!rankChart) return;

  const datasets = [];
  selectedTickers.forEach(ticker => {
    const series = data.find(
      t => t.ticker === ticker || t.Ticker === ticker
    );
    if (!series) return;

    const values = chartDates.map(d => {
      const map = series.rankByDate || {};
      const v = map[d];
      return typeof v === "number" ? v : null;
    });

    datasets.push({
      label: ticker,
      data: values,
      borderWidth: 1.5,
      tension: 0.25,
      pointRadius: 0
      // Chart.js will auto-assign colours
    });
  });

  rankChart.data.labels = chartDates;
  rankChart.data.datasets = datasets;
  rankChart.update();
}

// ---------------- Event wiring ----------------
document.addEventListener("DOMContentLoaded", () => {
  // Default tab = home
  showTab("home");

  const slider = document.getElementById("dateSlider");
  if (slider) {
    // Slider is locked to "today" now, but keep handler in case you re-enable later
    slider.addEventListener("input", () => {
      updateSelectedDateLabel();
      renderTable();
    });
  }

  const limit = document.getElementById("rankLimit");
  if (limit) {
    limit.addEventListener("change", () => {
      renderTable();
    });
  }

  loadData();
});
