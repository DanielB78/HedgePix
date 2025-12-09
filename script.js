// ---------------- Global State ----------------
let data = [];
let allDates = [];
let chartDates = [];
let todayStr = "";
let rankChart = null;
let selectedTickers = new Set();

// ---------------- Tab Switching ----------------
function showTab(id) {
  ["home", "rankings", "news", "info"].forEach(t => {
    const section = document.getElementById(t);
    if (section) {
      section.classList.toggle("hidden", t !== id);
    }
  });

  // Update sidebar active state
  ["home", "rankings", "news", "info"].forEach(t => {
    const btn = document.getElementById("tab-" + t);
    if (btn) {
      if (t === id) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    }
  });
}

// ---------------- Helpers ----------------
function parseISO(s) { return new Date(s + "T00:00:00Z"); }
function formatISO(d) {
  return d.getUTCFullYear() + "-" +
    String(d.getUTCMonth() + 1).padStart(2, "0") + "-" +
    String(d.getUTCDate()).padStart(2, "0");
}
function addDays(s, n) {
  const d = parseISO(s);
  d.setUTCDate(d.getUTCDate() + n);
  return formatISO(d);
}

function getPointOnOrBefore(hist, target) {
  let cand = null;
  for (const pt of hist) {
    if (pt.date <= target && (!cand || pt.date > cand.date)) cand = pt;
  }
  return cand;
}

function getPointInRange(hist, start, end, fromPast) {
  const pts = hist.filter(pt => pt.date >= start && pt.date <= end);
  if (!pts.length) return null;
  return fromPast ? pts[0] : pts[pts.length - 1];
}

function formatDelta(d) {
  if (d == null) return { text: "—", className: "text-purple-300/60" };
  if (d === 0) return { text: "0", className: "text-slate-300" };
  const up = d < 0; // rank improved if negative
  return {
    text: (d > 0 ? "+" : "−") + Math.abs(d),
    className: up ? "text-emerald-300" : "text-rose-300"
  };
}

// ---------------- Load Data ----------------
async function loadData() {
  const res = await fetch("rankings.json");
  if (!res.ok) {
    console.error("Failed to load rankings.json");
    return;
  }
  const raw = await res.json();

  data = raw.map(item => {
    const history = [...item.history].sort((a, b) => a.date.localeCompare(b.date));
    const map = {};
    history.forEach(pt => { map[pt.date] = pt.rank; });
    return {
      ticker: item.ticker,
      name: item.ticker,
      history,
      rankByDate: map
    };
  });

  const dateSet = new Set();
  data.forEach(t => t.history.forEach(pt => dateSet.add(pt.date)));
  allDates = [...dateSet].sort();
  if (!allDates.length) return;

  todayStr = allDates[allDates.length - 1];
  chartDates = allDates.slice(-90);

  renderTable();
  initChart();
}

// ---------------- Table ----------------
function renderTable() {
  const tbody = document.getElementById("tableBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!data.length) return;

  const limit = parseInt(document.getElementById("rankLimit").value || "5");

  const pastStart = addDays(todayStr, -7);
  const futureEnd = addDays(todayStr, +7);

  let rows = data.map(t => {
    const hist = t.history;
    const today = hist.find(pt => pt.date === todayStr);
    if (!today) return null;

    const past = getPointInRange(hist, pastStart, todayStr, true);
    const fut  = getPointInRange(hist, todayStr, futureEnd, false);

    return {
      ticker: t.ticker,
      todayRank: today.rank,
      pastDelta: past ? today.rank - past.rank : null,
      futureDelta: fut ? fut.rank - today.rank : null
    };
  }).filter(Boolean)
    .sort((a, b) => a.todayRank - b.todayRank);

  const sliced = rows.slice(0, limit);

  sliced.forEach(r => {
    const p = formatDelta(r.pastDelta);
    const f = formatDelta(r.futureDelta);

    const tr = document.createElement("tr");
    tr.className = "hover:bg-white/5 cursor-pointer transition";

    tr.innerHTML = `
      <td class="px-3 py-2">${r.todayRank}</td>
      <td class="px-3 py-2 text-purple-200 font-medium">${r.ticker}</td>
      <td class="px-3 py-2 ${p.className}">${p.text}</td>
      <td class="px-3 py-2 ${f.className}">${f.text}</td>
    `;

    tr.onclick = () => toggleTickerOnChart(r.ticker);
    tbody.appendChild(tr);
  });
}

// ---------------- Chart ----------------
function initChart() {
  const ctx = document.getElementById("rankChart");
  if (!ctx) return;

  rankChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: chartDates,
      datasets: []
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "nearest",
        intersect: false
      },
      scales: {
        y: {
          reverse: true,
          ticks: {
            color: "#e5e0f7",
            stepSize: 1,
            callback: v => Number.isInteger(v) ? v : ""
          },
          grid: {
            color: "rgba(201, 0, 255, 0.18)"
          }
        },
        x: {
          ticks: {
            color: "#b5b2d6",
            maxTicksLimit: 6
          },
          grid: {
            color: "rgba(255, 255, 255, 0.06)"
          }
        }
      },
      plugins: {
        legend: {
          labels: {
            color: "#f5f3ff",
            usePointStyle: true,
            boxWidth: 8
          }
        },
        tooltip: {
          backgroundColor: "#150035",
          titleColor: "#f9f5ff",
          bodyColor: "#e5e0f7",
          borderColor: "#c900ff",
          borderWidth: 1
        }
      },
      elements: {
        line: {
          borderWidth: 2,
          tension: 0.25
        },
        point: {
          radius: 0,
          hitRadius: 6
        }
      }
    }
  });
}

function randomCosmicColor(index) {
  const colors = [
    "#c900ff",
    "#00e5ff",
    "#ff6bcb",
    "#8aff80",
    "#ffd166"
  ];
  return colors[index % colors.length];
}

function toggleTickerOnChart(ticker) {
  if (selectedTickers.has(ticker)) selectedTickers.delete(ticker);
  else selectedTickers.add(ticker);
  updateChart();
}

function updateChart() {
  if (!rankChart) return;

  const datasets = [];
  let i = 0;

  selectedTickers.forEach(t => {
    const item = data.find(x => x.ticker === t);
    if (!item) return;

    const vals = chartDates.map(d => item.rankByDate[d] ?? null);
    const color = randomCosmicColor(i++);

    datasets.push({
      label: t,
      data: vals,
      borderColor: color,
      backgroundColor: "transparent"
    });
  });

  rankChart.data.datasets = datasets;
  rankChart.update();
}

// ---------------- Init ----------------
document.addEventListener("DOMContentLoaded", () => {
  showTab("home");
  const limit = document.getElementById("rankLimit");
  if (limit) {
    limit.onchange = renderTable;
  }
  loadData();
});
