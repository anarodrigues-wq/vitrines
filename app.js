/* =========================================================================
   NG.cash · Dashboard de Demandas
   Dados em tempo real via Google Sheets (gviz CSV endpoint, com suporte a CORS)
   ========================================================================= */

// ---- Configuração da planilha -------------------------------------------
const SHEET_ID = "1gbpFMNy8M_ju895hMa8NnFexKNFxwYH3";
const SHEET_GID = "1416232087";

// ---- Tags automáticas do sistema a IGNORAR (somente estas) --------------
// (o comentário NÃO é descartado — apenas a tag deixa de contar como demanda)
const EXCLUDED_TAGS = new Set([
  "comentário duplicado",
  "comentário não encontrado",
  "dúvida",
  "hater hidden",
  "problema",
  "publicação não encontrada",
  "redes",
  "removed_from_social_network",
  "sentiment_edited",
  "waiting_opinion",
  "answered_with_text",
  "replied",
  "lojas",
].map((t) => t.trim().toLowerCase()));

// ---- Tags que NÃO são problema (excluídas só do ranking "crítico") -------
const NON_CRITICAL = new Set(
  ["elogio", "liked", "feedback", "sem demanda", "demanda não especificada"].map((t) => t.toLowerCase())
);

// ---- Canais -------------------------------------------------------------
const CHANNELS = [
  { key: "play_store", label: "Play Store", color: "#70ff00" },
  { key: "instagram", label: "Instagram", color: "#7c2cff" },
  { key: "tiktok", label: "TikTok", color: "#2fa59e" },
  { key: "app_store", label: "App Store", color: "#ffb020" },
];
const CH_BY_KEY = Object.fromEntries(CHANNELS.map((c) => [c.key, c]));

const SENTIMENTS = [
  { key: "Positivo", color: "#70ff00" },
  { key: "Neutro", color: "#8f8f8f", cls: "sent-neu" },
  { key: "Negativo", color: "#ff5470", cls: "sent-neg" },
];

// ---- Cores / fonte dos gráficos -----------------------------------------
const C = {
  green: "#70ff00", purple: "#7c2cff", teal: "#2fa59e", amber: "#ffb020",
  red: "#ff5470", text: "#f2f4f0", muted: "#8f8f8f", grid: "rgba(255,255,255,.06)",
};
Chart.defaults.font.family = "'IBM Plex Sans', sans-serif";
Chart.defaults.color = C.muted;
// rótulos de dados sempre visíveis: registra o plugin e desliga por padrão (ligado por gráfico)
if (window.ChartDataLabels) {
  Chart.register(window.ChartDataLabels);
  Chart.defaults.set("plugins.datalabels", { display: false });
}

function hexLum(c) {
  let r, g, b;
  if (c[0] === "#") { const n = parseInt(c.slice(1), 16); r = (n >> 16) & 255; g = (n >> 8) & 255; b = n & 255; }
  else { const m = (c.match(/\d+/g) || [0, 0, 0]).map(Number); [r, g, b] = m; }
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
// a barra é larga o bastante para caber o número dentro?
const barFits = (ctx) => {
  const x = ctx.chart.scales.x;
  if (!x) return true;
  const v = ctx.dataset.data[ctx.dataIndex] || 0;
  return Math.abs(x.getPixelForValue(v) - x.getPixelForValue(0)) >= 42;
};
// rótulo DENTRO da barra quando cabe (texto escuro/claro por contraste); nas barras muito curtas, logo à direita
const barDL = {
  display: true,
  anchor: "end",
  align: (ctx) => (barFits(ctx) ? "start" : "end"),
  offset: 6, clamp: true,
  color: (ctx) => (barFits(ctx) ? (hexLum(ctx.dataset.backgroundColor) > 0.5 ? "#0a0a0a" : "#ffffff") : C.text),
  font: { family: "Sora", weight: 700, size: 11 },
  formatter: (v) => fmtNum(v),
};
// fatia pequena (<6%) -> rótulo vai para fora
const sliceSmall = (ctx) => { const d = ctx.dataset.data; const tot = d.reduce((a, b) => a + b, 0) || 1; return d[ctx.dataIndex] / tot < 0.06; };
// rótulo (valor + %): dentro das fatias grandes, fora das pequenas
const doughnutDL = {
  display: true, textAlign: "center",
  anchor: (ctx) => (sliceSmall(ctx) ? "end" : "center"),
  align: (ctx) => (sliceSmall(ctx) ? "end" : "center"),
  offset: (ctx) => (sliceSmall(ctx) ? 6 : 0),
  color: (ctx) => (sliceSmall(ctx) ? C.text : (hexLum(ctx.dataset.backgroundColor[ctx.dataIndex]) > 0.5 ? "#0a0a0a" : "#ffffff")),
  font: { family: "Sora", weight: 700, size: 10 },
  formatter: (v, ctx) => { const tot = ctx.dataset.data.reduce((a, b) => a + b, 0) || 1; const p = (v / tot) * 100; return `${fmtNum(v)}\n${p < 1 ? "<1%" : Math.round(p) + "%"}`; },
};

// ---- Estado -------------------------------------------------------------
let RAW = [];          // [{date:Date, dateStr, service, sentiment, tags:[]}]
let charts = {};       // instâncias Chart.js
const filters = { channels: new Set(), sentiments: new Set(), from: null, to: null, tags: new Set() };
let TAG_LIST = []; // todas as demandas distintas

// =========================================================================
// Utils
// =========================================================================
function parseDate(str) {
  // "DD/MM/YYYY"
  const m = (str || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return new Date(+m[3], +m[2] - 1, +m[1]);
}
function fmtDate(d) {
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}
function fmtNum(n) { return n.toLocaleString("pt-BR"); }
function toInputVal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// =========================================================================
// Carregamento dos dados
// =========================================================================
async function loadData() {
  const btn = document.getElementById("refreshBtn");
  const status = document.getElementById("statusMsg");
  btn.classList.add("loading");
  status.className = "status-msg";
  status.textContent = "Carregando dados da planilha…";

  try {
    const res = await fetch(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${SHEET_GID}&_=${Date.now()}`);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });

    RAW = parsed.data
      .map((r) => {
        const d = parseDate(r["Data"]);
        // A coluna Tags vem em 2 formatos: "tag1,tag2" ou ["tag1", "tag2"].
        // Removemos colchetes e aspas para normalizar antes de filtrar.
        const tagsRaw = (r["Tags"] || "")
          .replace(/[\[\]]/g, "")
          .split(",")
          .map((t) => t.trim().replace(/^["']+|["']+$/g, "").trim())
          .filter(Boolean);
        const tags = tagsRaw.filter((t) => !EXCLUDED_TAGS.has(t.toLowerCase()));
        return {
          date: d,
          service: (r["Serviço"] || "").trim(),
          sentiment: (r["Sentimento"] || "").trim(),
          tags,
        };
      })
      .filter((r) => r.date && r.service);

    status.textContent = "";
    document.getElementById("lastUpdate").textContent =
      "Atualizado " + new Date().toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

    initFilters();
    render();
  } catch (err) {
    status.className = "status-msg error";
    status.innerHTML = `Não foi possível carregar a planilha (${err.message}).<br>Verifique se ela está compartilhada como <b>“qualquer pessoa com o link · leitor”</b>.`;
  } finally {
    btn.classList.remove("loading");
  }
}

// =========================================================================
// Filtros (UI + estado)
// =========================================================================
function initFilters() {
  // Canais presentes nos dados, na ordem definida
  const present = CHANNELS.filter((c) => RAW.some((r) => r.service === c.key));

  const chCont = document.getElementById("channelChips");
  if (!chCont.dataset.built) {
    chCont.innerHTML = "";
    const all = mkChip("Todos", true, () => toggleAll("channels", present.map((c) => c.key)));
    all.dataset.role = "all-channels";
    chCont.appendChild(all);
    present.forEach((c) => {
      const chip = mkChip(c.label, false, () => toggleOne("channels", c.key));
      chip.dataset.val = c.key;
      chCont.appendChild(chip);
    });

    const seCont = document.getElementById("sentimentChips");
    seCont.innerHTML = "";
    const allS = mkChip("Todos", true, () => toggleAll("sentiments", SENTIMENTS.map((s) => s.key)));
    allS.dataset.role = "all-sentiments";
    seCont.appendChild(allS);
    SENTIMENTS.forEach((s) => {
      const chip = mkChip(s.key, false, () => toggleOne("sentiments", s.key));
      chip.dataset.val = s.key;
      if (s.cls) chip.dataset.cls = s.cls;
      seCont.appendChild(chip);
    });

    // datas
    const dates = RAW.map((r) => r.date).sort((a, b) => a - b);
    const minD = dates[0], maxD = dates[dates.length - 1];
    const fromEl = document.getElementById("dateFrom");
    const toEl = document.getElementById("dateTo");
    fromEl.min = toEl.min = toInputVal(minD);
    fromEl.max = toEl.max = toInputVal(maxD);
    fromEl.value = toInputVal(minD);
    toEl.value = toInputVal(maxD);
    filters.from = minD; filters.to = maxD;
    fromEl.onchange = () => { filters.from = fromEl.value ? new Date(fromEl.value + "T00:00:00") : null; render(); };
    toEl.onchange = () => { filters.to = toEl.value ? new Date(toEl.value + "T23:59:59") : null; render(); };
    document.getElementById("resetDates").onclick = () => {
      fromEl.value = toInputVal(minD); toEl.value = toInputVal(maxD);
      filters.from = minD; filters.to = maxD; render();
    };

    buildTagFilter();

    chCont.dataset.built = "1";
  }
  syncChipClasses();
}

function mkChip(label, active, onClick) {
  const b = document.createElement("button");
  b.className = "chip" + (active ? " active" : "");
  b.textContent = label;
  b.onclick = onClick;
  return b;
}

function toggleOne(group, val) {
  const set = filters[group];
  if (set.has(val)) set.delete(val); else set.add(val);
  syncChipClasses(); render();
}
function toggleAll(group, all) {
  filters[group].clear(); // vazio = todos
  syncChipClasses(); render();
}
function syncChipClasses() {
  document.querySelectorAll("#channelChips .chip").forEach((chip) => {
    if (chip.dataset.role === "all-channels") chip.classList.toggle("active", filters.channels.size === 0);
    else chip.classList.toggle("active", filters.channels.has(chip.dataset.val));
  });
  document.querySelectorAll("#sentimentChips .chip").forEach((chip) => {
    let on;
    if (chip.dataset.role === "all-sentiments") on = filters.sentiments.size === 0;
    else on = filters.sentiments.has(chip.dataset.val);
    chip.classList.toggle("active", on);
    if (chip.dataset.cls) chip.classList.toggle(chip.dataset.cls, on);
  });
}

// --- multi-select de demandas (checkboxes) ---
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function buildTagFilter() {
  TAG_LIST = [...new Set(RAW.flatMap((r) => r.tags))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  filters.tags = new Set(TAG_LIST); // começa com todas marcadas

  const wrap = document.getElementById("tagMulti");
  const btn = document.getElementById("tagMultiBtn");
  const panel = document.getElementById("tagMultiPanel");
  const list = document.getElementById("tagList");
  const allCb = document.getElementById("tagAll");
  const search = document.getElementById("tagSearch");

  list.innerHTML = TAG_LIST.map((t, i) =>
    `<label class="ms-opt"><input type="checkbox" class="ms-cb" data-i="${i}" checked /><span>${escapeHtml(t)}</span></label>`
  ).join("");

  const closePanel = () => { panel.setAttribute("hidden", ""); btn.setAttribute("aria-expanded", "false"); };
  const openPanel = () => { panel.removeAttribute("hidden"); btn.setAttribute("aria-expanded", "true"); search.focus(); };
  btn.onclick = (e) => { e.stopPropagation(); panel.hasAttribute("hidden") ? openPanel() : closePanel(); };
  document.addEventListener("click", (e) => { if (!wrap.contains(e.target)) closePanel(); });
  panel.addEventListener("click", (e) => e.stopPropagation());

  list.addEventListener("change", (e) => {
    if (!e.target.classList.contains("ms-cb")) return;
    const t = TAG_LIST[+e.target.dataset.i];
    if (e.target.checked) filters.tags.add(t); else filters.tags.delete(t);
    updateTagUI(); render();
  });
  allCb.onchange = () => {
    filters.tags = allCb.checked ? new Set(TAG_LIST) : new Set();
    updateTagUI(); render();
  };
  search.oninput = () => {
    const q = search.value.trim().toLowerCase();
    list.querySelectorAll(".ms-opt").forEach((opt) => {
      opt.style.display = opt.textContent.trim().toLowerCase().includes(q) ? "" : "none";
    });
  };
  updateTagUI();
}
function updateTagUI() {
  const total = TAG_LIST.length, n = filters.tags.size;
  const allCb = document.getElementById("tagAll");
  allCb.checked = n === total;
  allCb.indeterminate = n > 0 && n < total;
  document.querySelectorAll("#tagList .ms-cb").forEach((cb) => { cb.checked = filters.tags.has(TAG_LIST[+cb.dataset.i]); });
  const label = document.getElementById("tagMultiLabel");
  const btn = document.getElementById("tagMultiBtn");
  label.textContent = n === total ? "Todas as demandas"
    : n === 0 ? "Nenhuma demanda"
    : n === 1 ? [...filters.tags][0]
    : `${n} demandas selecionadas`;
  btn.classList.toggle("ms-active", n !== total);
}

// rows que passam por todos os filtros
function applyFilters(rows, { ignoreChannel = false } = {}) {
  return rows.filter((r) => {
    if (!ignoreChannel && filters.channels.size && !filters.channels.has(r.service)) return false;
    if (filters.sentiments.size && !filters.sentiments.has(r.sentiment)) return false;
    if (filters.from && r.date < filters.from) return false;
    if (filters.to && r.date > filters.to) return false;
    // demandas: se todas selecionadas => sem filtro; senão exige >=1 tag marcada
    if (TAG_LIST.length && filters.tags.size !== TAG_LIST.length) {
      if (!r.tags.some((t) => filters.tags.has(t))) return false;
    }
    return true;
  });
}

// conta tags de demanda numa lista de rows
function tagCounts(rows) {
  const all = !TAG_LIST.length || filters.tags.size === TAG_LIST.length; // todas marcadas
  const m = new Map();
  rows.forEach((r) => r.tags.forEach((t) => {
    if (!all && !filters.tags.has(t)) return; // ignora demandas desmarcadas
    m.set(t, (m.get(t) || 0) + 1);
  }));
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

// =========================================================================
// Render
// =========================================================================
function render() {
  const rows = applyFilters(RAW);
  renderKPIs(rows);
  renderTopDemands(rows);
  renderSentiment(rows);
  renderChannel(rows);
  renderTimeline(rows);
  renderMonthly(rows);   // top 5 demandas empilhadas por mes
  renderHeatmap();       // top 3 demandas x canais
  renderChannelGrid();   // usa filtro de período/sentimento, todos os canais
  renderActionPlan(rows);
}

// desenha o total no topo de cada barra empilhada
const stackTotalPlugin = {
  id: "stackTotal",
  afterDatasetsDraw(chart) {
    const { ctx, scales: { y } } = chart;
    const meta0 = chart.getDatasetMeta(0);
    if (!meta0 || !meta0.data.length) return;
    for (let i = 0; i < meta0.data.length; i++) {
      let sum = 0;
      chart.data.datasets.forEach((ds, di) => { if (chart.isDatasetVisible(di)) sum += ds.data[i] || 0; });
      if (!sum) continue;
      ctx.save();
      ctx.fillStyle = C.text;
      ctx.font = "700 12px Sora";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(fmtNum(sum), meta0.data[i].x, y.getPixelForValue(sum) - 5);
      ctx.restore();
    }
  },
};

// rótulos dos segmentos: dentro quando cabe; fora (com linha-guia) quando o segmento é fino
const monthlySegLabels = {
  id: "monthlySegLabels",
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    ctx.save();
    ctx.font = "700 10.5px Sora";
    ctx.textBaseline = "middle";
    const n = chart.getDatasetMeta(0).data.length;
    for (let i = 0; i < n; i++) {
      const segs = [];
      let cx = 0, bw = 0;
      chart.data.datasets.forEach((ds, di) => {
        if (!chart.isDatasetVisible(di)) return;
        const v = ds.data[i] || 0; if (!v) return;
        const el = chart.getDatasetMeta(di).data[i];
        const p = el.getProps(["x", "y", "base", "width"], true);
        cx = p.x; bw = p.width;
        segs.push({ v, yc: (p.y + p.base) / 2, h: Math.abs(p.base - p.y), color: ds.backgroundColor });
      });
      const outside = [];
      segs.forEach((s) => {
        if (s.h >= 16) {
          ctx.fillStyle = hexLum(s.color) > 0.5 ? "#0a0a0a" : "#ffffff";
          ctx.textAlign = "center";
          ctx.fillText(fmtNum(s.v), cx, s.yc);
        } else outside.push(s);
      });
      if (outside.length) {
        const rightX = cx + bw / 2 + 9;
        outside.sort((a, b) => a.yc - b.yc);
        let prev = -Infinity;
        outside.forEach((s) => { s.ty = Math.max(s.yc, prev + 13); prev = s.ty; });
        outside.forEach((s) => {
          ctx.strokeStyle = "rgba(255,255,255,.28)"; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(cx + bw / 2, s.yc); ctx.lineTo(rightX - 3, s.ty); ctx.stroke();
          ctx.fillStyle = s.color;
          ctx.beginPath(); ctx.arc(cx + bw / 2, s.yc, 2.4, 0, 6.2832); ctx.fill();
          ctx.fillStyle = C.text; ctx.textAlign = "left";
          ctx.fillText(fmtNum(s.v), rightX, s.ty);
        });
      }
    }
    ctx.restore();
  },
};

// top 5 demandas empilhadas por mes
function renderMonthly(rows) {
  const monthDate = new Map(); // 'YYYY-MM' -> Date (para rotulo)
  rows.forEach((r) => { const k = `${r.date.getFullYear()}-${String(r.date.getMonth() + 1).padStart(2, "0")}`; if (!monthDate.has(k)) monthDate.set(k, r.date); });
  const monthKeys = [...monthDate.keys()].sort();
  const labels = monthKeys.map((k) => { const d = monthDate.get(k); return d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "") + "/" + String(d.getFullYear()).slice(2); });
  const idx = Object.fromEntries(monthKeys.map((k, i) => [k, i]));

  const top5 = tagCounts(rows).slice(0, 5).map((t) => t[0]);
  const top5set = new Set(top5);
  const all = !TAG_LIST.length || filters.tags.size === TAG_LIST.length;
  const series = {}; top5.forEach((t) => (series[t] = new Array(monthKeys.length).fill(0)));
  const outros = new Array(monthKeys.length).fill(0);
  rows.forEach((r) => {
    const i = idx[`${r.date.getFullYear()}-${String(r.date.getMonth() + 1).padStart(2, "0")}`];
    r.tags.forEach((t) => {
      if (!all && !filters.tags.has(t)) return;
      if (top5set.has(t)) series[t][i]++; else outros[i]++;
    });
  });

  const palette = [C.green, C.purple, C.teal, C.amber, C.red];
  const datasets = top5.map((t, i) => ({ label: t, data: series[t], backgroundColor: palette[i % palette.length], borderWidth: 0, stack: "s", maxBarThickness: 90 }));
  datasets.push({ label: "Outros", data: outros, backgroundColor: "#6a6a6a", borderWidth: 0, stack: "s", maxBarThickness: 90 });

  destroy("monthly");
  charts.monthly = new Chart(document.getElementById("chartMonthly"), {
    type: "bar",
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 22 } },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom", labels: { color: C.text, usePointStyle: true, pointStyle: "circle", padding: 14, font: { size: 12 } } },
        tooltip: { ...tt(), callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${fmtNum(ctx.parsed.y)}` } },
        datalabels: { display: false },
      },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { color: C.muted } },
        y: { stacked: true, grid: { color: C.grid }, ticks: { precision: 0 }, beginAtZero: true },
      },
    },
    plugins: [stackTotalPlugin, monthlySegLabels],
  });
}

// heatmap: top 3 demandas (linhas) x canais (colunas), cor = volume
function renderHeatmap() {
  const base = applyFilters(RAW, { ignoreChannel: true });
  const present = CHANNELS.filter((c) => base.some((r) => r.service === c.key));
  const top3 = tagCounts(base).slice(0, 3);
  const cont = document.getElementById("heatmap");
  if (!top3.length || !present.length) { cont.innerHTML = `<p class="status-msg">Sem dados no recorte atual.</p>`; return; }

  const matrix = top3.map(([tag]) => present.map((c) => base.filter((r) => r.service === c.key && r.tags.includes(tag)).length));
  const max = Math.max(...matrix.flat(), 1);

  cont.style.gridTemplateColumns = `minmax(120px,1.5fr) repeat(${present.length},1fr)`;
  let html = `<div class="hm-corner"></div>`;
  present.forEach((c) => { html += `<div class="hm-head">${c.label}</div>`; });
  top3.forEach(([tag], i) => {
    html += `<div class="hm-rowlabel">${tag}</div>`;
    present.forEach((c, j) => {
      const v = matrix[i][j];
      const t = v / max;
      html += `<div class="hm-cell" style="background:${heatColor(t)};color:${t > 0.5 ? "#0a0a0a" : "#c7d4b8"}" title="${tag} · ${c.label}: ${fmtNum(v)}">${fmtNum(v)}</div>`;
    });
  });
  cont.innerHTML = html;
}
function heatColor(t) {
  const l = 9 + t * 46;   // lightness 9%..55%
  const s = 65 + t * 35;  // saturation 65%..100%
  return `hsl(84, ${s}%, ${l}%)`;
}

function renderKPIs(rows) {
  const total = rows.length;
  const withDemand = rows.filter((r) => r.tags.length).length;
  const distinctTags = tagCounts(rows).length;
  const channelsActive = new Set(rows.map((r) => r.service)).size;

  const kpis = [
    { val: fmtNum(total), label: "Comentários no filtro", foot: "registros classificados", cls: "" },
    { val: fmtNum(withDemand), label: "Com demanda identificada", foot: `${total ? Math.round((withDemand / total) * 100) : 0}% do total`, cls: "k-teal" },
    { val: fmtNum(distinctTags), label: "Tags de demanda", foot: "demandas distintas mapeadas", cls: "k-red" },
    { val: channelsActive, label: "Canais ativos", foot: "no recorte atual", cls: "k-purple" },
  ];
  document.getElementById("kpis").innerHTML = kpis
    .map((k) => `<div class="kpi ${k.cls}"><div class="kpi-val">${k.val}</div><div class="kpi-label">${k.label}</div><div class="kpi-foot">${k.foot}</div></div>`)
    .join("");
}

function destroy(id) { if (charts[id]) { charts[id].destroy(); delete charts[id]; } }

function renderTopDemands(rows) {
  const top = tagCounts(rows).slice(0, 15);
  destroy("topDemands");
  charts.topDemands = new Chart(document.getElementById("chartTopDemands"), {
    type: "bar",
    data: {
      labels: top.map((t) => t[0]),
      datasets: [{
        data: top.map((t) => t[1]),
        backgroundColor: C.green,
        borderRadius: 6, borderSkipped: false, barThickness: "flex", maxBarThickness: 22,
      }],
    },
    options: {
      indexAxis: "y", responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: tt(), datalabels: barDL },
      scales: {
        x: { grid: { color: C.grid }, ticks: { precision: 0 } },
        y: { grid: { display: false }, ticks: { color: C.text, font: { size: 12 } } },
      },
    },
  });
}

function renderSentiment(rows) {
  const data = SENTIMENTS.map((s) => rows.filter((r) => r.sentiment === s.key).length);
  destroy("sentiment");
  charts.sentiment = new Chart(document.getElementById("chartSentiment"), {
    type: "doughnut",
    data: { labels: SENTIMENTS.map((s) => s.key), datasets: [{ data, backgroundColor: SENTIMENTS.map((s) => s.color), borderColor: "#181818", borderWidth: 3, hoverOffset: 6 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: "58%", layout: { padding: 30 }, plugins: { legend: legendBottom(), tooltip: tt(true), datalabels: doughnutDL } },
  });
}

function renderChannel(rows) {
  const counts = CHANNELS.map((c) => ({ c, n: rows.filter((r) => r.service === c.key).length })).filter((x) => x.n > 0);
  destroy("channel");
  charts.channel = new Chart(document.getElementById("chartChannel"), {
    type: "doughnut",
    data: { labels: counts.map((x) => x.c.label), datasets: [{ data: counts.map((x) => x.n), backgroundColor: counts.map((x) => x.c.color), borderColor: "#181818", borderWidth: 3, hoverOffset: 6 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: "58%", layout: { padding: 30 }, plugins: { legend: legendBottom(), tooltip: tt(true), datalabels: doughnutDL } },
  });
}

function renderTimeline(rows) {
  const byDay = new Map();
  rows.forEach((r) => { const k = r.date.getTime(); byDay.set(k, (byDay.get(k) || 0) + 1); });
  const sorted = [...byDay.entries()].sort((a, b) => a[0] - b[0]);
  destroy("timeline");
  charts.timeline = new Chart(document.getElementById("chartTimeline"), {
    type: "line",
    data: {
      labels: sorted.map((s) => fmtDate(new Date(s[0]))),
      datasets: [{
        data: sorted.map((s) => s[1]),
        borderColor: C.green, borderWidth: 2, tension: .35, fill: true,
        pointRadius: 0, pointHoverRadius: 5, pointHoverBackgroundColor: C.green,
        backgroundColor: (ctx) => {
          const { ctx: c, chartArea } = ctx.chart; if (!chartArea) return "rgba(112,255,0,.08)";
          const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          g.addColorStop(0, "rgba(112,255,0,.28)"); g.addColorStop(1, "rgba(112,255,0,0)"); return g;
        },
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false, axis: "x" },
      hover: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...tt(),
          callbacks: { title: (items) => "Dia " + items[0].label, label: (ctx) => " " + fmtNum(ctx.parsed.y) + " comentário" + (ctx.parsed.y === 1 ? "" : "s") },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 12, color: C.muted } },
        y: { grid: { color: C.grid }, ticks: { precision: 0 }, beginAtZero: true },
      },
    },
  });
}

function renderChannelGrid() {
  const grid = document.getElementById("channelGrid");
  // base: respeita sentimento + período, ignora filtro de canal
  const base = applyFilters(RAW, { ignoreChannel: true });
  const present = CHANNELS.filter((c) => base.some((r) => r.service === c.key));

  grid.innerHTML = present.map((c) => `
    <div class="card channel-card">
      <div class="card-head">
        <h2>${c.label}</h2>
        <span class="channel-badge" style="background:${c.color}">${fmtNum(base.filter(r => r.service === c.key).length)}</span>
      </div>
      <div class="chart-box ch"><canvas id="ch_${c.key}"></canvas></div>
    </div>`).join("");

  present.forEach((c) => {
    const rows = base.filter((r) => r.service === c.key);
    const top = tagCounts(rows).slice(0, 10);
    destroy("ch_" + c.key);
    charts["ch_" + c.key] = new Chart(document.getElementById("ch_" + c.key), {
      type: "bar",
      data: {
        labels: top.map((t) => t[0]),
        datasets: [{ data: top.map((t) => t[1]), backgroundColor: hexA(c.color, .8), borderRadius: 5, borderSkipped: false, maxBarThickness: 20 }],
      },
      options: {
        indexAxis: "y", responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: tt(), datalabels: { ...barDL, font: { family: "Sora", weight: 700, size: 10.5 } } },
        scales: { x: { grid: { color: C.grid }, ticks: { precision: 0 } }, y: { grid: { display: false }, ticks: { color: C.text, font: { size: 11.5 } } } },
      },
    });
  });
}

// =========================================================================
// Plano de ação — top 3 demandas críticas + receituário
// =========================================================================
const PLAYBOOK = {
  "cobrança de assinatura mensal": {
    diag: "Maior gerador de comentários negativos nas lojas. A assinatura é aceita na abertura da conta e não pode ser cancelada — a dor real é falta de clareza sobre sua existência e desconhecimento das missões de isenção.",
    actions: [
      "Dar maior visibilidade às missões de isenção da mensalidade dentro do app, especialmente a Offerwall, incentivando o usuário a zerar a cobrança.",
      "Fixar a notificação de cobrança na central de notificações do app até que seja visualizada.",
      "Criar uma tela explicativa sobre a mensalidade, detalhando benefícios, valor e formas de obter isenção.",
      "Disponibilizar um histórico de cobranças mais acessível, facilitando a compreensão dos débitos.",
      "Acompanhar indicadores e recorrência das reclamações para evolução contínua.",
    ],
    kpi: "% de comentários sobre cobrança / mês · adesão às missões de isenção", owner: "Produto + CX",
  },
  "erro de acesso": {
    diag: "Falhas de login/entrada no app impedem o uso e geram frustração imediata, concentradas na Play Store.",
    actions: [
      "Cruzar picos de comentários com logs de incidentes.",
      "Resposta-padrão com passo a passo (atualizar app, limpar cache, recuperar senha).",
      "Encaminhar lote de relatos recorrentes para Engenharia priorizar.",
      "Incentivar a atualização do app.",
    ],
    kpi: "Tempo até resolução de erros de acesso", owner: "Engenharia + CX",
  },
  "dúvida sobre a conta": {
    diag: "Perguntas sobre funcionamento, status e dados da conta — alto volume e ótima oportunidade de conteúdo educativo (público adolescente).",
    actions: [
      "Desmembrar as dúvidas para identificar os principais temas.",
      "Padronizar respostas com tom didático adequado ao público menor de idade.",
      "Encaminhar dúvidas que viram solicitação para o canal de suporte certo.",
    ],
    kpi: "Redução de dúvidas repetidas após conteúdo", owner: "Social + CX + Conteúdo",
  },
  "erro de pix": {
    diag: "Problemas em transferências PIX (falha, atraso, não recebimento) — crítico por envolver dinheiro.",
    actions: [
      "Separar 'erro de PIX' de 'não recebimento de PIX' no atendimento.",
      "Resposta-padrão com prazo e canal oficial para abrir ocorrência.",
      "Alertar Engenharia/Operações em caso de pico anormal.",
    ],
    kpi: "Volume de erros de PIX por semana", owner: "Operações + Engenharia + CX",
  },
  "dúvidas klubi": {
    diag: "Dúvidas sobre o produto Klubi concentradas no Instagram — indica lacuna de comunicação do produto.",
    actions: [
      "Criar material explicativo do Klubi para social.",
      "Resposta-padrão e direcionamento para o suporte do produto.",
    ],
    kpi: "Dúvidas Klubi / semana", owner: "Social + Produto Klubi",
  },
  "bloqueio de conta": {
    diag: "Contas bloqueadas geram urgência e insatisfação alta.",
    actions: [
      "Resposta-padrão explicando motivos comuns e como regularizar.",
      "Fluxo rápido de encaminhamento para o time de prevenção/compliance.",
    ],
    kpi: "Tempo médio de desbloqueio", owner: "Prevenção + CX",
  },
  "abertura de conta": {
    diag: "Dificuldades no onboarding — público menor de idade exige fluxo claro (responsável/documentação).",
    actions: [
      "Conteúdo passo a passo de abertura para menores.",
      "Mapear pontos de travamento mais citados e levar ao Produto.",
    ],
    kpi: "Comentários sobre abertura / mês", owner: "Produto + Social",
  },
  "dúvidas sobre o cartão": {
    diag: "Dúvidas sobre cartão (uso, entrega, função) — recorrentes nas redes.",
    actions: [
      "FAQ visual de cartão para redes sociais.",
      "Resposta-padrão segmentada (entrega x uso x taxa).",
    ],
    kpi: "Dúvidas de cartão / mês", owner: "Social + Produto Cartão",
  },
};
const GENERIC_PLAN = {
  diag: "Demanda crítica de alto volume no período. Requer resposta-padrão e acompanhamento.",
  actions: ["Criar resposta-padrão para o time de atendimento.", "Monitorar evolução semanal.", "Encaminhar casos recorrentes para a área responsável."],
  kpi: "Volume da demanda / semana", owner: "CX + Social",
};

function renderActionPlan(rows) {
  const counts = tagCounts(rows).filter(([tag]) => !NON_CRITICAL.has(tag.toLowerCase()));
  const top3 = counts.slice(0, 3);
  const total = rows.length || 1;

  const el = document.getElementById("actionPlan");
  if (!top3.length) { el.innerHTML = `<p class="status-msg">Sem demandas críticas no recorte atual.</p>`; return; }

  el.innerHTML = top3.map(([tag, n], i) => {
    const p = PLAYBOOK[tag.toLowerCase()] || GENERIC_PLAN;
    return `
    <div class="ap-card">
      <span class="ap-rank">${i + 1}</span>
      <div class="ap-top"><span class="ap-tag">Motivo crítico #${i + 1}</span></div>
      <div class="ap-title">${tag}</div>
      <div class="ap-metric"><b>${fmtNum(n)}</b> menções · ${((n / total) * 100).toFixed(1)}% do recorte</div>
      <div class="ap-block"><h4>Diagnóstico</h4><p>${p.diag}</p></div>
      <div class="ap-block"><h4>Ações</h4><ul class="ap-actions">${p.actions.map((a) => `<li>${a}</li>`).join("")}</ul></div>
      <div class="ap-foot"><span class="ap-pill">📊 KPI: ${p.kpi}</span><span class="ap-pill">👥 ${p.owner}</span></div>
    </div>`;
  }).join("");
}

// =========================================================================
// Helpers de gráfico
// =========================================================================
function tt(pct = false) {
  return {
    backgroundColor: "#0e0e0e", borderColor: "#262626", borderWidth: 1,
    titleColor: C.text, bodyColor: C.text, padding: 12, cornerRadius: 10, displayColors: !pct ? false : true,
    callbacks: pct ? {
      label: (ctx) => {
        const tot = ctx.dataset.data.reduce((a, b) => a + b, 0) || 1;
        return ` ${ctx.label}: ${fmtNum(ctx.parsed)} (${((ctx.parsed / tot) * 100).toFixed(1)}%)`;
      },
    } : { label: (ctx) => " " + fmtNum(ctx.parsed.x ?? ctx.parsed.y ?? ctx.parsed) },
  };
}
function legendBottom() {
  return { position: "bottom", labels: { color: C.text, usePointStyle: true, pointStyle: "circle", padding: 16, font: { size: 12.5 } } };
}
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// =========================================================================
// Start
// =========================================================================
document.getElementById("refreshBtn").onclick = loadData;
loadData();
