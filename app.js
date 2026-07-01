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

// ---- Estado -------------------------------------------------------------
let RAW = [];          // [{date:Date, dateStr, service, sentiment, tags:[]}]
let charts = {};       // instâncias Chart.js
const filters = { channels: new Set(), sentiments: new Set(), from: null, to: null };

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
        const tagsRaw = (r["Tags"] || "").split(",").map((t) => t.trim()).filter(Boolean);
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

// rows que passam por todos os filtros
function applyFilters(rows, { ignoreChannel = false } = {}) {
  return rows.filter((r) => {
    if (!ignoreChannel && filters.channels.size && !filters.channels.has(r.service)) return false;
    if (filters.sentiments.size && !filters.sentiments.has(r.sentiment)) return false;
    if (filters.from && r.date < filters.from) return false;
    if (filters.to && r.date > filters.to) return false;
    return true;
  });
}

// conta tags de demanda numa lista de rows
function tagCounts(rows) {
  const m = new Map();
  rows.forEach((r) => r.tags.forEach((t) => m.set(t, (m.get(t) || 0) + 1)));
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
  renderChannelGrid();   // usa filtro de período/sentimento, todos os canais
  renderActionPlan(rows);
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
        backgroundColor: top.map((_, i) => (i === 0 ? C.green : i === 1 ? C.purple : "rgba(112,255,0,.55)")),
        borderRadius: 6, borderSkipped: false, barThickness: "flex", maxBarThickness: 22,
      }],
    },
    options: {
      indexAxis: "y", responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: tt() },
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
    options: { responsive: true, maintainAspectRatio: false, cutout: "62%", plugins: { legend: legendBottom(), tooltip: tt(true) } },
  });
}

function renderChannel(rows) {
  const counts = CHANNELS.map((c) => ({ c, n: rows.filter((r) => r.service === c.key).length })).filter((x) => x.n > 0);
  destroy("channel");
  charts.channel = new Chart(document.getElementById("chartChannel"), {
    type: "doughnut",
    data: { labels: counts.map((x) => x.c.label), datasets: [{ data: counts.map((x) => x.n), backgroundColor: counts.map((x) => x.c.color), borderColor: "#181818", borderWidth: 3, hoverOffset: 6 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: "62%", plugins: { legend: legendBottom(), tooltip: tt(true) } },
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
        plugins: { legend: { display: false }, tooltip: tt() },
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
