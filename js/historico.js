import { ACAO, ORIGEM, dataBr, dataHoraBr, escapeHtml, numero, selo } from "./formato.js";
import { iniciarPagina, usarCache } from "./pagina.js";
import { CACHE, lerFiltros, prefetchCache, salvarFiltros } from "./session.js";

const $ = (selector) => document.querySelector(selector);
const CAMPOS = ["de", "ate", "acao", "origem", "usuario", "resultado", "paciente"];

const state = { page: 1, dados: null };

const els = {
  form: $("#filtros"),
  limpar: $("#limpar"),
  linhas: $("#linhas"),
  vazio: $("#vazio"),
  info: $("#pagina-info"),
  anterior: $("#anterior"),
  proxima: $("#proxima"),
  usuario: $("#usuario"),
  kpiBloqueios: $("#kpi-bloqueios"),
  kpiLiberacoes: $("#kpi-liberacoes"),
  kpiAntecipadas: $("#kpi-antecipadas"),
  kpiFalhas: $("#kpi-falhas"),
  kpiTotal: $("#kpi-total"),
};

const filtros = () => {
  const params = new URLSearchParams();
  CAMPOS.forEach((campo) => {
    const valor = document.getElementById(campo).value.trim();
    if (valor) params.set(campo, valor);
  });
  params.set("page", String(state.page));
  return params;
};

// Registro sem PATCH: o CNN já estava no estado pedido (HttpStatus NULL, texto em RespostaApi).
const soRegistro = (item) => !item.httpStatus && String(item.respostaApi || "").startsWith("Sem PATCH");

const quem = (item) => (item.origem === "PAINEL" ? item.usuario : ORIGEM[item.origem] || item.origem);

const linhaHtml = (item) => `
  <tr>
    <td class="mono">${escapeHtml(dataHoraBr(item.em))}</td>
    <td>
      <a class="link-paciente" href="/pacientes?paciente=${item.idPaciente}">${escapeHtml(item.nome || "(sem nome)")}</a>
      <span class="sub">ID ${item.idPaciente}</span>
    </td>
    <td>${escapeHtml(ACAO[item.acao] || item.acao)}${item.antecipada ? '<span class="sub">antes do prazo</span>' : ""}</td>
    <td>${escapeHtml(quem(item) || "—")}</td>
    <td>${escapeHtml(item.motivo || "—")}</td>
    <td class="mono">${item.numeroFalta ? `${item.numeroFalta}ª falta` : "—"}<span class="sub">${item.dataFimBloqueio ? `prazo ${dataBr(item.dataFimBloqueio)}` : ""}</span></td>
    <td>${
      item.sucesso && soRegistro(item)
        ? `${selo("liberado_antecipado", "Só registro")}<span class="sub">${escapeHtml(String(item.respostaApi).replace(/^Sem PATCH:\s*/, ""))}</span>`
        : item.sucesso
        ? selo("ok", "Deu certo")
        : `${selo("falha", `Falhou${item.httpStatus ? ` · HTTP ${item.httpStatus}` : ""}`)}<span class="sub">${escapeHtml(item.respostaApi || "")}</span>`
    }${item.execucao ? `<span class="sub">execução n8n ${escapeHtml(item.execucao)}</span>` : ""}</td>
  </tr>`;

const preencherUsuarios = (usuarios) => {
  const atual = els.usuario.value;
  els.usuario.innerHTML = '<option value="">Todos</option>' +
    usuarios.map((usuario) => `<option value="${escapeHtml(usuario)}">${escapeHtml(usuario)}</option>`).join("");
  els.usuario.value = usuarios.includes(atual) ? atual : "";
};

const render = () => {
  const dados = state.dados;
  els.linhas.innerHTML = dados.items.map(linhaHtml).join("");
  els.vazio.hidden = dados.items.length > 0;

  const paginas = Math.max(1, Math.ceil(dados.total / dados.pageSize));
  els.info.textContent = `Página ${dados.page} de ${paginas} · ${numero(dados.total)} ações`;
  els.anterior.disabled = dados.page <= 1;
  els.proxima.disabled = dados.page >= paginas;

  els.kpiBloqueios.textContent = numero(dados.contagem.bloqueios);
  els.kpiLiberacoes.textContent = numero(dados.contagem.liberacoes);
  els.kpiAntecipadas.textContent = `${numero(dados.contagem.antecipadas)} antes do prazo`;
  els.kpiFalhas.textContent = numero(dados.contagem.falhas);
  els.kpiTotal.textContent = numero(dados.total);
  preencherUsuarios(dados.usuarios || []);
};

// Um cache por combinação de filtros e página.
const carregar = async ({ forcar }) => {
  const params = filtros();
  history.replaceState(null, "", `?${params}`);
  const chave = `acoes:${params}`;
  const entrada = await usarCache(chave, `/api/acoes?${params}`, CACHE.acoes, { forcar }, (dados) => {
    // Um dado que chega por trás de outro filtro ou página não sobrescreve a tela.
    if (chave !== `acoes:${filtros()}`) return;
    state.dados = dados;
    render();
  });
  salvarFiltros("historico", { busca: params.toString() });
  prefetchCache("pacientes", "/api/pacientes", CACHE.pacientes);
  return entrada;
};

// Filtros vindos da URL (ex.: link do detalhe do paciente); sem eles, os últimos usados nesta aba.
const daUrl = new URLSearchParams(window.location.search.length > 1 ? window.location.search : lerFiltros("historico").busca || "");
CAMPOS.forEach((campo) => {
  const valor = daUrl.get(campo);
  if (!valor) return;
  const campoEl = document.getElementById(campo);
  if (campoEl.tagName === "SELECT" && ![...campoEl.options].some((opcao) => opcao.value === valor)) {
    campoEl.add(new Option(valor, valor));
  }
  campoEl.value = valor;
});
state.page = Math.max(1, Number.parseInt(daUrl.get("page") || "1", 10) || 1);

const recarregar = iniciarPagina(carregar, { prazoMs: CACHE.acoes });

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  state.page = 1;
  void recarregar(false).catch(() => {});
});

els.limpar.addEventListener("click", () => {
  CAMPOS.forEach((campo) => {
    document.getElementById(campo).value = "";
  });
  state.page = 1;
  void recarregar(false).catch(() => {});
});

els.anterior.addEventListener("click", () => {
  state.page = Math.max(1, state.page - 1);
  void recarregar(false).catch(() => {});
});

els.proxima.addEventListener("click", () => {
  state.page += 1;
  void recarregar(false).catch(() => {});
});
