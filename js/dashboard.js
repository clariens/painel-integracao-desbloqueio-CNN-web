// Dashboard: situação de hoje, faltas, bloqueios e liberações e solicitações, com gráficos Chart.js (js/graficos.js).
// Reaproveita o que outras telas já guardam na aba (pacientes, solicitações, faltas do período) e busca só o
// que falta em /api/dashboard. O período vale para Faltas, Bloqueios e Solicitações; "Hoje" é a foto atual.
import { SOLICITACAO, dataBr, escapeHtml, numero, periodoDoAtalho, somarDiasIso } from "./formato.js";
import { aoTrocarTema, barras, linha, radar, rosca, serie, token } from "./graficos.js";
import { iniciarPagina, usarCache } from "./pagina.js";
import { CACHE, lerFiltros, prefetchCache, salvarFiltros } from "./session.js";

const $ = (selector) => document.querySelector(selector);
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const DIAS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

const state = { atalho: "ciclo", pacientes: null, solicitacoes: null, faltas: null, dashboard: null };

const els = {
  form: $("#filtros"),
  atalhos: $("#atalhos"),
  de: $("#de"),
  ate: $("#ate"),
  periodo: $("#periodo-texto"),
};
const texto = (id, valor) => {
  const alvo = document.getElementById(id);
  if (alvo) alvo.textContent = valor;
};

const rotuloMes = (mes) => `${MESES[Number(mes.slice(5, 7)) - 1]}/${mes.slice(2, 4)}`;
const rotuloDia = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const decimal = (valor, casas = 1) =>
  valor === null || valor === undefined ? "—" : Number(valor).toLocaleString("pt-BR", { maximumFractionDigits: casas });
const porcento = (parte, total) => (total ? `${Math.round((parte / total) * 100)}%` : "—");

// Tempo em minutos, por extenso curto: "35 min", "2 h 10 min", "1,5 dia".
const duracao = (minutos) => {
  if (minutos === null || minutos === undefined) return "—";
  if (minutos < 60) return `${Math.round(minutos)} min`;
  if (minutos < 48 * 60) {
    const h = Math.floor(minutos / 60);
    const m = Math.round(minutos % 60);
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  return `${decimal(minutos / 1440)} dias`;
};

// Variação contra o período anterior: "▲ 12% vs. período anterior". Para faltas, subir é ruim (vermelho).
const variacao = (id, atual, anterior) => {
  const alvo = document.getElementById(id);
  if (!alvo) return;
  if (!anterior) {
    alvo.className = "var--igual";
    alvo.textContent = atual ? "sem dados no período anterior" : "—";
    return;
  }
  const pct = Math.round(((atual - anterior) / anterior) * 100);
  alvo.className = pct > 0 ? "var--sobe" : pct < 0 ? "var--desce" : "var--igual";
  alvo.textContent = `${pct > 0 ? "▲" : pct < 0 ? "▼" : "="} ${Math.abs(pct)}% vs. período anterior (${numero(anterior)})`;
};

// Série diária completa (dias sem falta = 0), para a linha não pular dias.
const diasDoPeriodo = (de, ate) => {
  const dias = [];
  for (let dia = de; dia <= ate && dias.length < 800; dia = somarDiasIso(dia, 1)) dias.push(dia);
  return dias;
};
const preencher = (dias, lista, campo) => {
  const mapa = new Map(lista.map((item) => [item.dia, item[campo]]));
  return dias.map((dia) => mapa.get(dia) || 0);
};
const mediaMovel = (valores, janela = 7) =>
  valores.map((_, i) => {
    const trecho = valores.slice(Math.max(0, i - janela + 1), i + 1);
    return Math.round((trecho.reduce((s, v) => s + v, 0) / trecho.length) * 10) / 10;
  });

// Os N maiores e o resto somado em "Outros".
const topComOutros = (itens, n = 6) => {
  const ordenados = [...itens].sort((a, b) => b.valor - a.valor);
  const topo = ordenados.slice(0, n);
  const resto = ordenados.slice(n).reduce((s, i) => s + i.valor, 0);
  return resto ? [...topo, { rotulo: "Outros", valor: resto, cor: token("--muted") }] : topo;
};

// ---------- Hoje (cache de Pacientes e Solicitações) ----------
const renderHoje = () => {
  const p = state.pacientes;
  if (!p) return;
  const r = p.resumo || {};
  const hoje = p.ciclo?.hoje;
  texto("hoje-pendentes", numero(r.pendentes));
  texto("hoje-bloqueados", numero(r.bloqueados));
  texto("hoje-aptos", numero(r.aptos));
  texto("hoje-antecipados", numero(r.liberadosAntecipados));

  const contagem = state.solicitacoes?.contagem;
  texto("hoje-solicitacoes", numero(contagem ? contagem.PENDENTE : r.solicitacoesPendentes));
  texto("hoje-aprovadas", `${numero(contagem ? contagem.APROVADA : r.solicitacoesAprovadas)} aprovada(s) aguardando liberar`);

  rosca("g-situacao", "Situação dos pacientes", [
    { rotulo: "Aguardando bloqueio", valor: r.pendentes || 0, cor: token("--pendente") },
    { rotulo: "Bloqueados", valor: r.bloqueados || 0, cor: token("--bloq") },
    { rotulo: "Aptos a liberar", valor: r.aptos || 0, cor: token("--apto") },
    { rotulo: "Liberados antes do prazo", valor: r.liberadosAntecipados || 0, cor: token("--antecipado") },
    { rotulo: "Liberados", valor: r.liberados || 0, cor: token("--ok-strong") },
  ]);

  // Bloqueados no prazo que saem nos próximos 30 dias, por semana (o fim do prazo é o último dia bloqueado).
  const semanas = [0, 7, 14, 21, 28].map((ini) => ({ de: somarDiasIso(hoje, ini), ate: somarDiasIso(hoje, Math.min(ini + 6, 30)) }));
  const saem = semanas.map(
    (s) => (p.items || []).filter((i) => i.status === "bloqueado" && i.dataFimBloqueio >= s.de && i.dataFimBloqueio <= s.ate).length,
  );
  const totalSaem = saem.reduce((a, b) => a + b, 0);
  texto("hoje-saem", `${numero(totalSaem)} saem nos próximos 30 dias`);
  barras(
    "g-saem",
    "Saem do bloqueio nos próximos 30 dias",
    semanas.map((s, i) => (i === 0 ? `Até ${dataBr(s.ate).slice(0, 5)}` : `${dataBr(s.de).slice(0, 5)}–${dataBr(s.ate).slice(0, 5)}`)),
    [{ rotulo: "Pacientes", valores: saem, cor: token("--apto") }],
  );

  const pf = r.porFaltas || {};
  rosca("g-faltas-ciclo", "Pacientes por faltas no ciclo", [
    { rotulo: "1 falta (60 dias)", valor: pf[1] || 0, cor: serie(1) },
    { rotulo: "2 faltas (90 dias)", valor: pf[2] || 0, cor: serie(3) },
    { rotulo: "3 ou mais (180 dias)", valor: pf[3] || 0, cor: serie(5) },
  ]);
};

// ---------- Faltas (cache de Relatórios + /api/dashboard) ----------
const renderFaltas = () => {
  const f = state.faltas;
  const d = state.dashboard;
  if (!f || !d) return;
  const ant = d.faltas.anterior;
  const reincidentes = (f.reincidencia || []).filter((r) => r.quantidade >= 2).reduce((s, r) => s + r.pacientes, 0);
  texto("f-faltas", numero(f.total.faltas));
  texto("f-pacientes", numero(f.total.pacientes));
  texto("f-media", f.total.pacientes ? decimal(f.total.faltas / f.total.pacientes, 2) : "—");
  texto("f-reincidentes", numero(reincidentes));
  variacao("f-faltas-var", f.total.faltas, ant.faltas);
  variacao("f-pacientes-var", f.total.pacientes, ant.pacientes);
  variacao("f-reincidentes-var", reincidentes, ant.reincidentes);
  const mediaAnt = ant.pacientes ? ant.faltas / ant.pacientes : 0;
  const mediaAtual = f.total.pacientes ? f.total.faltas / f.total.pacientes : 0;
  const alvoMedia = document.getElementById("f-media-var");
  if (alvoMedia) {
    alvoMedia.className = "var--igual";
    alvoMedia.textContent = mediaAnt ? `antes: ${decimal(mediaAnt, 2)} ${mediaAtual > mediaAnt ? "▲" : mediaAtual < mediaAnt ? "▼" : "="}` : "—";
  }

  const dias = diasDoPeriodo(d.periodo.de, d.periodo.ate);
  const porDia = preencher(dias, d.faltas.porDia, "faltas");
  linha("g-dia", "Faltas por dia", dias.map(rotuloDia), [
    { rotulo: "Faltas no dia", valores: porDia, cor: serie(0), area: true },
    { rotulo: "Média de 7 dias", valores: mediaMovel(porDia), cor: serie(3), tracejado: true },
  ]);

  // Com poucos meses, uma linha de um ou dois pontos não diz nada: vira colunas.
  const meses = f.porMes.map((m) => rotuloMes(m.mes));
  const seriesMes = [
    { rotulo: "Faltas", valores: f.porMes.map((m) => m.faltas), cor: serie(0), area: true },
    { rotulo: "Pacientes", valores: f.porMes.map((m) => m.pacientes), cor: serie(2) },
  ];
  if (meses.length >= 3) linha("g-mes", "Faltas por mês", meses, seriesMes);
  else barras("g-mes", "Faltas por mês", meses, seriesMes);

  radar("g-semana", "Faltas por dia da semana", DIAS, DIAS.map((_, i) => f.porDiaSemana.find((x) => x.dia === i)?.faltas || 0));
  renderCalor(d.faltas.calor);

  rosca(
    "g-periodo",
    "Faltas por período do dia",
    f.porPeriodo.map((p, i) => ({ rotulo: p.periodo, valor: p.faltas, cor: p.periodo === "Sem horário" ? token("--muted") : serie(i + 1) })),
  );
  rosca("g-tipo", "Faltas por tipo de consulta", topComOutros(f.porTipoConsulta.map((t) => ({ rotulo: t.nome, valor: t.faltas }))));
  const maior = d.faltas.maiorFaltaRegra || 3;
  rosca(
    "g-numero",
    "Faltas por número no ciclo",
    d.faltas.porNumero.map((n, i) => ({ rotulo: n.numero >= maior ? `${maior}ª ou mais` : `${n.numero}ª falta`, valor: n.faltas, cor: serie(i * 2) })),
  );

  const horizontais = (id, titulo, lista, campoNome, cor) => {
    const top = lista.slice(0, 10);
    barras(id, titulo, top.map((x) => x[campoNome]), [{ rotulo: "Faltas", valores: top.map((x) => x.faltas), cor }], { horizontal: true });
  };
  horizontais("g-prof", "Profissionais com mais faltas", f.porProfissional, "profissional", serie(0));
  horizontais("g-proc", "Procedimentos com mais faltas", f.porProcedimento, "nome", token("--proc"));
  horizontais("g-local", "Faltas por local", d.faltas.porLocal, "nome", serie(2));
  horizontais("g-espec", "Faltas por especialidade", d.faltas.porEspecialidade, "nome", serie(1));
};

// Mapa de calor em HTML: linhas = dias da semana, colunas = horas com falta (de 6h a 21h, ou o que houver).
const renderCalor = (celulas) => {
  const alvo = document.getElementById("g-calor");
  if (!alvo) return;
  if (!celulas.length) {
    alvo.innerHTML = '<p class="painel-card__vazio">Sem horários marcados no período.</p>';
    alvo.setAttribute("aria-label", "Mapa de calor: sem dados no período.");
    return;
  }
  const horasComDados = celulas.map((c) => c.hora);
  const primeira = Math.min(6, ...horasComDados);
  const ultima = Math.max(21, ...horasComDados);
  const horas = Array.from({ length: ultima - primeira + 1 }, (_, i) => primeira + i);
  const mapa = new Map(celulas.map((c) => [`${c.dia}:${c.hora}`, c.faltas]));
  const max = Math.max(...celulas.map((c) => c.faltas));
  const pico = celulas.reduce((a, b) => (b.faltas > a.faltas ? b : a));
  alvo.style.setProperty("--horas", String(horas.length));
  alvo.innerHTML = [
    '<span></span>',
    ...horas.map((h) => `<span class="calor__hora">${h}h</span>`),
    ...DIAS.flatMap((nomeDia, d) => [
      `<span class="calor__rotulo">${nomeDia}</span>`,
      ...horas.map((h) => {
        const n = mapa.get(`${d}:${h}`) || 0;
        const nivel = n ? Math.round(18 + (n / max) * 82) : 0;
        const dica = `${nomeDia}, ${h}h: ${numero(n)} falta(s)`;
        return `<span class="calor__celula" style="--nivel:${nivel}%" title="${escapeHtml(dica)}" aria-label="${escapeHtml(dica)}" tabindex="-1"></span>`;
      }),
    ]),
  ].join("");
  alvo.setAttribute("aria-label", `Mapa de calor: mais faltas ${DIAS[pico.dia]} às ${pico.hora}h (${numero(pico.faltas)}).`);
};

// ---------- Bloqueios e liberações ----------
const TIPOS_ACAO = {
  BLOQUEIO_AUTO: { rotulo: "Bloqueio automático (01:00)", cor: () => token("--bloq") },
  BLOQUEIO_PAINEL: { rotulo: "Bloqueio pelo painel", cor: () => serie(5) },
  LIBERACAO_AUTO: { rotulo: "Liberação automática (02:00)", cor: () => token("--ok-strong") },
  LIBERACAO_SOLICITACAO: { rotulo: "Liberação por solicitação", cor: () => token("--antecipado") },
  LIBERACAO_PAINEL: { rotulo: "Liberação após o prazo (painel)", cor: () => token("--apto") },
};

const renderAcoes = () => {
  const d = state.dashboard;
  if (!d) return;
  const r = d.acoes.resumo;
  texto("a-bloqueios", numero(r.bloqueios));
  texto("a-liberacoes", numero(r.liberacoes));
  texto("a-antecipadas", `${numero(r.antecipadas)} antes do prazo`);
  texto("a-falhas", numero(r.falhas));
  texto("a-taxa-falha", `${porcento(r.falhas, r.bloqueios + r.liberacoes + r.falhas)} das tentativas`);
  texto("a-dias", r.diasBloqueado === null ? "—" : `${decimal(r.diasBloqueado)} dias`);
  texto("a-poupados", r.diasPoupados === null ? "—" : `${decimal(r.diasPoupados)} dias`);

  const meses = [...new Set(d.acoes.porMes.map((m) => m.mes))].sort();
  barras(
    "g-acao-mes",
    "Bloqueios e liberações por mês",
    meses.map(rotuloMes),
    Object.entries(TIPOS_ACAO).map(([tipo, info]) => ({
      rotulo: info.rotulo,
      cor: info.cor(),
      valores: meses.map((mes) => d.acoes.porMes.find((m) => m.mes === mes && m.tipo === tipo)?.quantidade || 0),
    })),
    { empilhado: true },
  );

  const somaTipo = (tipo) => d.acoes.porMes.filter((m) => m.tipo === tipo).reduce((s, m) => s + m.quantidade, 0);
  rosca(
    "g-liberacoes",
    "Como os pacientes foram liberados",
    ["LIBERACAO_AUTO", "LIBERACAO_SOLICITACAO", "LIBERACAO_PAINEL"].map((tipo) => ({
      rotulo: TIPOS_ACAO[tipo].rotulo,
      valor: somaTipo(tipo),
      cor: TIPOS_ACAO[tipo].cor(),
    })),
  );

  const usuarios = d.acoes.porUsuario;
  barras(
    "g-usuarios",
    "Ações pelo painel, por usuário",
    usuarios.map((u) => u.usuario),
    [
      { rotulo: "Bloqueios", valores: usuarios.map((u) => u.bloqueios), cor: token("--bloq") },
      { rotulo: "Liberações", valores: usuarios.map((u) => u.liberacoes), cor: token("--ok-strong") },
    ],
    { horizontal: true, empilhado: true },
  );
};

// ---------- Solicitações ----------
const CORES_SOL = {
  PENDENTE: "--pendente",
  APROVADA: "--apto",
  LIBERADA: "--ok-strong",
  RECUSADA: "--alert-strong",
  CANCELADA: "--muted",
  ENCERRADA: "--steel",
};

const renderSolicitacoes = () => {
  const d = state.dashboard;
  if (!d) return;
  const s = d.solicitacoes;
  const t = s.tempo;
  const abertas = (s.porStatus.PENDENTE || 0) + (s.porStatus.APROVADA || 0);
  texto("s-total", numero(t.total));
  texto("s-abertas", `${numero(abertas)} ainda aberta(s)`);
  texto("s-taxa", porcento(t.aprovadas, t.aprovadas + t.recusadas));
  texto("s-decididas", `${numero(t.aprovadas)} aprovada(s) · ${numero(t.recusadas)} recusada(s)`);
  texto("s-resposta", duracao(t.minutosResposta));
  texto("s-liberar", duracao(t.minutosLiberar));

  rosca(
    "g-sol-status",
    "Pedidos por situação",
    Object.keys(CORES_SOL).map((status) => ({ rotulo: SOLICITACAO[status], valor: s.porStatus[status] || 0, cor: token(CORES_SOL[status]) })),
  );

  const dias = diasDoPeriodo(d.periodo.de, d.periodo.ate);
  barras("g-sol-dia", "Pedidos por dia", dias.map(rotuloDia), [
    { rotulo: "Pedidos", valores: preencher(dias, s.porDia, "quantidade"), cor: serie(2) },
  ]);

  barras(
    "g-sol-quem",
    "Quem mais pede",
    s.porSolicitante.map((p) => p.usuario),
    [
      { rotulo: "Aprovados", valores: s.porSolicitante.map((p) => p.aprovadas), cor: token("--ok-strong") },
      { rotulo: "Demais", valores: s.porSolicitante.map((p) => p.quantidade - p.aprovadas), cor: token("--muted") },
    ],
    { horizontal: true, empilhado: true },
  );
};

// ---------- carregamento ----------
const aplicarAtalho = (atalho) => {
  [els.de.value, els.ate.value] = periodoDoAtalho(atalho);
  state.atalho = atalho;
  els.atalhos.querySelectorAll("button").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.atalho === atalho));
  });
};

const carregar = async ({ forcar }) => {
  const de = els.de.value;
  const ate = els.ate.value;
  if (de && ate && de > ate) throw new Error("A data inicial é depois da final.");
  els.periodo.textContent = `${dataBr(de)} a ${dataBr(ate)}`;
  const params = new URLSearchParams({ de, ate });
  const doPeriodo = (chave) => chave.endsWith(`:${els.de.value}:${els.ate.value}`);

  // Tudo ao mesmo tempo; cada parte desenha a sua seção quando chega (ou na hora, se estiver na aba).
  const [entrada] = await Promise.all([
    usarCache(`dashboard:${de}:${ate}`, `/api/dashboard?${params}`, CACHE.dashboard, { forcar }, (dados) => {
      if (!doPeriodo(`dashboard:${de}:${ate}`)) return;
      state.dashboard = dados;
      renderFaltas();
      renderAcoes();
      renderSolicitacoes();
    }),
    usarCache(`faltas:${de}:${ate}`, `/api/faltas?${params}`, CACHE.faltas, { forcar }, (dados) => {
      if (!doPeriodo(`faltas:${de}:${ate}`)) return;
      state.faltas = dados;
      renderFaltas();
    }),
    usarCache("pacientes", "/api/pacientes", CACHE.pacientes, { forcar }, (dados) => {
      state.pacientes = dados;
      renderHoje();
    }),
    usarCache("solicitacoes", "/api/solicitacoes", CACHE.solicitacoes, { forcar }, (dados) => {
      state.solicitacoes = dados;
      renderHoje();
    }).catch(() => null), // sem o workflow de Solicitações, o "Hoje" usa o resumo de Pacientes
  ]);
  salvarFiltros("dashboard", { atalho: state.atalho, de, ate });
  prefetchCache("parametros", "/api/parametros", CACHE.parametros);
  return entrada;
};

const salvos = lerFiltros("dashboard");
if (salvos.atalho || !salvos.de || !salvos.ate) {
  aplicarAtalho(salvos.atalho || "ciclo");
} else {
  els.de.value = salvos.de;
  els.ate.value = salvos.ate;
  state.atalho = "";
  els.atalhos.querySelectorAll("button").forEach((button) => button.setAttribute("aria-pressed", "false"));
}
const recarregar = iniciarPagina(carregar, { prazoMs: CACHE.dashboard });

// Tema novo: desenha tudo de novo, com as cores do tema.
aoTrocarTema(() => {
  renderHoje();
  renderFaltas();
  renderAcoes();
  renderSolicitacoes();
});

els.atalhos.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-atalho]");
  if (!button) return;
  aplicarAtalho(button.dataset.atalho);
  void recarregar(false).catch(() => {});
});

[els.de, els.ate].forEach((campo) =>
  campo.addEventListener("change", () => {
    state.atalho = "";
    els.atalhos.querySelectorAll("button").forEach((button) => button.setAttribute("aria-pressed", "false"));
  }),
);

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  void recarregar(false).catch(() => {});
});
