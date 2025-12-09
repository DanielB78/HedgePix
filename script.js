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
    document.getElementById(t).classList.toggle("hidden", t !== id);
  });
}

// ---------------- Helpers ----------------
function parseISO(s){return new Date(s+"T00:00:00Z");}
function formatISO(d){
  return d.getUTCFullYear()+"-"+String(d.getUTCMonth()+1).padStart(2,"0")+"-"+String(d.getUTCDate()).padStart(2,"0");
}
function addDays(s,n){
  const d=parseISO(s); d.setUTCDate(d.getUTCDate()+n); return formatISO(d);
}

function getPointOnOrBefore(hist, target){
  let cand=null;
  for(const pt of hist){
    if(pt.date<=target && (!cand || pt.date>cand.date)) cand=pt;
  }
  return cand;
}

function getPointInRange(hist,start,end,fromPast){
  const pts=hist.filter(pt=>pt.date>=start && pt.date<=end);
  if(!pts.length) return null;
  return fromPast? pts[0]: pts[pts.length-1];
}

function formatDelta(d){
  if(d==null) return {text:"—", className:"text-slate-500"};
  if(d===0) return {text:"0", className:"text-slate-400"};
  const up = d<0;
  return {
    text:(d>0?"+":"−")+Math.abs(d),
    className: up? "text-green-300":"text-red-300"
  };
}

// ---------------- Load Data ----------------
async function loadData(){
  const res = await fetch("rankings.json");
  const raw = await res.json();

  data = raw.map(item => {
    const h = [...item.history].sort((a,b)=>a.date.localeCompare(b.date));
    const map = {};
    h.forEach(x=>map[x.date]=x.rank);
    return { ticker:item.ticker, name:item.ticker, history:h, rankByDate:map };
  });

  const dateSet = new Set();
  data.forEach(t => t.history.forEach(pt => dateSet.add(pt.date)));
  allDates = [...dateSet].sort();
  if(!allDates.length) return;

  todayStr = allDates[allDates.length - 1];
  chartDates = allDates.slice(-90);

  renderTable();
  initChart();
}

// ---------------- Table ----------------
function renderTable(){
  const tbody = document.getElementById("tableBody");
  tbody.innerHTML="";
  if(!data.length) return;

  const limit = parseInt(document.getElementById("rankLimit").value);

  const pastStart = addDays(todayStr, -7);
  const futureEnd = addDays(todayStr, +7);

  let rows = data.map(t=>{
    const hist=t.history;
    const today = hist.find(pt=>pt.date===todayStr);
    if(!today) return null;

    const past = getPointInRange(hist,pastStart,todayStr,true);
    const fut  = getPointInRange(hist,todayStr,futureEnd,false);

    return {
      ticker:t.ticker,
      todayRank:today.rank,
      pastDelta: past? today.rank - past.rank : null,
      futureDelta: fut? fut.rank - today.rank : null
    };
  }).filter(Boolean)
    .sort((a,b)=>a.todayRank-b.todayRank);

  rows = rows.slice(0,limit);

  rows.forEach(r=>{
    const p = formatDelta(r.pastDelta);
    const f = formatDelta(r.futureDelta);

    const tr=document.createElement("tr");
    tr.className="hover:bg-slate-700/30 cursor-pointer";
    tr.innerHTML=`
      <td class="px-3 py-2">${r.todayRank}</td>
      <td class="px-3 py-2 text-emerald-300">${r.ticker}</td>
      <td class="px-3 py-2 ${p.className}">${p.text}</td>
      <td class="px-3 py-2 ${f.className}">${f.text}</td>
    `;
    tr.onclick=()=>toggleTickerOnChart(r.ticker);
    tbody.appendChild(tr);
  });
}

// ---------------- Chart ----------------
function initChart(){
  const ctx=document.getElementById("rankChart");
  rankChart = new Chart(ctx,{
    type:"line",
    data:{ labels:chartDates, datasets:[] },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      scales:{
        y:{
          reverse:true,
          ticks:{
            stepSize:1,
            callback:(v)=>Number.isInteger(v)?v:""
          },
          grid:{color:"rgba(255,255,255,0.08)"}
        },
        x:{
          ticks:{maxTicksLimit:6},
          grid:{display:false}
        }
      }
    }
  });
}

function toggleTickerOnChart(ticker){
  if(selectedTickers.has(ticker)) selectedTickers.delete(ticker);
  else selectedTickers.add(ticker);
  updateChart();
}

function updateChart(){
  const sets=[];
  selectedTickers.forEach(t=>{
    const item=data.find(x=>x.ticker===t);
    const vals=chartDates.map(d=>item.rankByDate[d]??null);
    sets.push({ label:t, data:vals, borderWidth:2, tension:0.25, pointRadius:0 });
  });
  rankChart.data.datasets=sets;
  rankChart.update();
}

// ---------------- Init ----------------
document.addEventListener("DOMContentLoaded",()=>{
  showTab("home");
  document.getElementById("rankLimit").onchange=renderTable;
  loadData();
});
