// Tela Solicitações: pedidos de desbloqueio de pacientes antes do fim do prazo.
// Todos abrem e veem; só o admin aprova ou recusa; Editor e Admin liberam no CNN uma solicitação aprovada.
import { DECISAO_SOLICITACAO, dataBr, dataHoraBr, escapeHtml, numero, prazoTexto, seloSolicitacao } from "./formato.js";
import { atualizadoAs, atualizarContador, avisar, iniciarPagina, ocupado, usarCache } from "./pagina.js";
import { CACHE, comCache, getAuth, getUsuario, lerFiltros, pode, prefetchCache, request, salvarFiltros, writeCache } from "./session.js";
import { criarSolicitacao, decidirSolicitacao, liberarSolicitacao, limparDepoisDeSolicitacao } from "./solicitacao.js";

const $ = (selector) => document.querySelector(selector);

const ABERTAS = ["PENDENTE", "APROVADA"];
const FECHADAS = ["RECUSADA", "CANCELADA", "ENCERRADA"];

const state = {
  dados: null,
  status: "ABERTAS",
  busca: "",
  minhas: false,
  destaque: null,
  novaPaciente: null,
  pacientes: [],
  decisao: null,
};

const els = {
  kpiPendentes: $("#kpi-pendentes"),
  kpiAprovadas: $("#kpi-aprovadas"),
  kpiLiberadas: $("#kpi-liberadas"),
  kpiFechadas: $("#kpi-fechadas"),
  kpiEncerradas: $("#kpi-encerradas"),
  busca: $("#busca"),
  minhas: $("#minhas"),
  filtroStatus: $("#filtro-status"),
  linhas: $("#linhas"),
  vazio: $("#vazio"),
  resumo: $("#lista-resumo"),
  nova: $("#nova"),
  novaDialog: $("#nova-dialog"),
  novaForm: $("#nova-form"),
  novaBusca: $("#nova-busca"),
  novaOpcoes: $("#nova-opcoes"),
  novaEscolhido: $("#nova-escolhido"),
  novaMotivo: $("#nova-motivo"),
  novaContador: $("#nova-contador"),
  novaErro: $("#nova-erro"),
  novaCancelar: $("#nova-cancelar"),
  novaEnviar: $("#nova-enviar"),
  decisao: $("#decisao"),
  decisaoForm: $("#decisao-form"),
  decisaoKicker: $("#decisao-kicker"),
  decisaoTitulo: $("#decisao-titulo"),
  decisaoContexto: $("#decisao-contexto"),
  decisaoRotulo: $("#decisao-rotulo"),
  decisaoMotivo: $("#decisao-motivo"),
  decisaoContador: $("#decisao-contador"),
  decisaoErro: $("#decisao-erro"),
  decisaoCancelar: $("#decisao-cancelar"),
  decisaoConfirmar: $("#decisao-confirmar"),
};

const normalizar = (texto) =>
  String(texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const meuLogin = () => getUsuario()?.login || "";
const hoje = () => state.dados?.hoje || "";

// ---------- lista ----------
const noFiltro = (item) => {
  if (state.status === "ABERTAS") return ABERTAS.includes(item.status);
  if (state.status === "FECHADAS") return FECHADAS.includes(item.status);
  return !state.status || item.status === state.status;
};

const filtrar = () => {
  const busca = normalizar(state.busca.trim()).replace(/^#/, "");
  return (state.dados?.itens || []).filter((item) => {
    if (state.destaque && item.id === state.destaque) return true;
    if (!noFiltro(item)) return false;
    if (state.minhas && item.solicitadoPor !== meuLogin()) return false;
    if (!busca) return true;
    return [item.nomePaciente, item.idPaciente, item.id, item.motivo, item.solicitadoPor].some((campo) => normalizar(campo).includes(busca));
  });
};

const aviso = (item) => {
  if (item.desatualizada) return '<span class="sol-aviso">O paciente teve uma falta nova: esta solicitação não vale mais.</span>';
  if (item.prazoCumprido) return '<span class="sol-aviso">O prazo já terminou: a rotina das 02:00 libera o paciente.</span>';
  return "";
};

const botoes = (item) => {
  const lista = [];
  const valida = !item.desatualizada && !item.prazoCumprido;

  if (item.status === "PENDENTE" && pode("ADMIN") && valida) {
    lista.push(`<button class="btn btn--sm" type="button" data-decidir="aprovar" data-sol="${item.id}">Aprovar</button>`);
    lista.push(`<button class="btn btn--sm btn--liberar" type="button" data-liberar="${item.id}" data-aprovar="1">Aprovar e liberar</button>`);
  }
  if (item.status === "APROVADA" && pode("EDITOR") && valida) {
    lista.push(`<button class="btn btn--sm btn--liberar" type="button" data-liberar="${item.id}">Liberar no CNN</button>`);
  }
  if (ABERTAS.includes(item.status) && pode("ADMIN")) {
    lista.push(`<button class="btn btn--sm btn--bloquear" type="button" data-decidir="recusar" data-sol="${item.id}">Recusar</button>`);
  }
  if (ABERTAS.includes(item.status) && (item.solicitadoPor === meuLogin() || pode("ADMIN"))) {
    lista.push(`<button class="btn btn--sm ghost" type="button" data-decidir="cancelar" data-sol="${item.id}">Cancelar</button>`);
  }
  return lista.join("");
};

const decisaoHtml = (item) => {
  const partes = [];
  if (item.decididoPor || item.decididoEm) {
    partes.push(`${escapeHtml(DECISAO_SOLICITACAO[item.status] || item.status)}${item.decididoPor ? ` por ${escapeHtml(item.decididoPor)}` : ""}${item.decididoEm ? ` em ${escapeHtml(dataHoraBr(item.decididoEm))}` : ""}`);
  }
  if (item.liberadoPor) partes.push(`Liberado no CNN por ${escapeHtml(item.liberadoPor)} em ${escapeHtml(dataHoraBr(item.liberadoEm))}`);
  if (item.motivoDecisao) partes.push(`<em>${escapeHtml(item.motivoDecisao)}</em>`);
  return partes.map((parte) => `<span class="sub">${parte}</span>`).join("");
};

const linhaHtml = (item) => `
  <tr class="${FECHADAS.includes(item.status) ? "linha--inativa" : ""}${state.destaque === item.id ? " linha--destaque" : ""}" id="sol-${item.id}">
    <td>
      <a class="link-paciente" href="/pacientes?paciente=${item.idPaciente}">${escapeHtml(item.nomePaciente || "(sem nome)")}</a>
      <span class="sub">ID ${item.idPaciente} · solicitação #${item.id}</span>
    </td>
    <td class="mono">${item.numeroFalta ? `${item.numeroFalta}ª · ` : ""}${dataBr(item.dataFalta)}<span class="sub">prazo até ${dataBr(item.dataFimBloqueio)}${ABERTAS.includes(item.status) ? ` · ${escapeHtml(prazoTexto(item.dataFimBloqueio, hoje()))}` : ""}</span></td>
    <td class="motivo-cel">${escapeHtml(item.motivo)}</td>
    <td>${escapeHtml(item.solicitadoPor || "—")}<span class="sub">${escapeHtml(dataHoraBr(item.solicitadoEm))}</span></td>
    <td>${seloSolicitacao(item.status)}${decisaoHtml(item)}${aviso(item)}</td>
    <td class="acoes-cel">${botoes(item)}</td>
  </tr>`;

const renderResumo = () => {
  const contagem = state.dados?.contagem || {};
  const itens = state.dados?.itens || [];
  els.kpiPendentes.textContent = numero(contagem.PENDENTE);
  els.kpiAprovadas.textContent = numero(contagem.APROVADA);
  els.kpiLiberadas.textContent = numero(contagem.LIBERADA);
  els.kpiFechadas.textContent = numero((contagem.RECUSADA || 0) + (contagem.CANCELADA || 0));
  els.kpiEncerradas.textContent = `${numero(contagem.ENCERRADA)} encerrada(s) pelo sistema`;

  const contar = (filtro) => numero(itens.filter(filtro).length);
  const conts = {
    ABERTAS: contar((item) => ABERTAS.includes(item.status)),
    PENDENTE: contar((item) => item.status === "PENDENTE"),
    APROVADA: contar((item) => item.status === "APROVADA"),
    LIBERADA: contar((item) => item.status === "LIBERADA"),
    FECHADAS: contar((item) => FECHADAS.includes(item.status)),
    TODAS: numero(itens.length),
  };
  Object.entries(conts).forEach(([chave, valor]) => {
    const alvo = document.getElementById(`cont-${chave}`);
    if (alvo) alvo.textContent = valor;
  });
};

const renderLista = () => {
  const filtrados = filtrar();
  els.linhas.innerHTML = filtrados.map(linhaHtml).join("");
  els.vazio.hidden = filtrados.length > 0 || !state.dados;
  els.resumo.textContent = state.dados
    ? `${numero(filtrados.length)} solicitação(ões) · a lista mostra todas as abertas e as 300 fechadas mais recentes`
    : "—";
  els.filtroStatus.querySelectorAll("button").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.status === state.status));
  });
  salvarFiltros("solicitacoes", { status: state.status, busca: state.busca, minhas: state.minhas ? "1" : "" });
};

const aplicar = (dados) => {
  state.dados = dados;
  renderResumo();
  renderLista();
  if (state.destaque) document.getElementById(`sol-${state.destaque}`)?.scrollIntoView({ block: "center" });
};

// Quem abre esta tela quer ver o pedido que acabou de chegar: mostra o que está na aba e, se tiver mais de
// alguns segundos, busca de novo por trás (sem esperar o prazo do cache).
const NOVO_MS = 5000;
let buscandoNovo = false;
const atualizarPorTras = async () => {
  if (buscandoNovo) return;
  buscandoNovo = true;
  try {
    const nova = writeCache("solicitacoes", await request("/api/solicitacoes"));
    aplicar(nova.data);
    atualizadoAs(nova.savedAt);
    atualizarContador();
  } catch {
    // Fica com o que já está na tela; o botão "Atualizar agora" tenta de novo.
  } finally {
    buscandoNovo = false;
  }
};

const carregar = async ({ forcar }) => {
  const entrada = await usarCache("solicitacoes", "/api/solicitacoes", CACHE.solicitacoes, { forcar }, aplicar);
  if (!forcar && !entrada.velho && Date.now() - entrada.savedAt > NOVO_MS) void atualizarPorTras();
  // A lista de pacientes alimenta a busca da "Nova solicitação".
  prefetchCache("pacientes", "/api/pacientes", CACHE.pacientes);
  return entrada;
};

// ---------- nova solicitação ----------
// Pode receber solicitação: bloqueado ou aguardando bloqueio, com o prazo correndo e sem solicitação aberta.
const elegivel = (item) => ["bloqueado", "pendente"].includes(item.status) && !item.solicitacao?.valida;

const renderOpcoes = () => {
  const busca = normalizar(els.novaBusca.value.trim());
  const opcoes = state.pacientes
    .filter(elegivel)
    .filter((item) => !busca || normalizar(item.nome).includes(busca) || String(item.idPaciente).includes(busca))
    .slice(0, 8);
  els.novaOpcoes.innerHTML = opcoes.length
    ? opcoes
        .map(
          (item) => `<li><button type="button" role="option" data-escolher="${item.idPaciente}" aria-selected="${state.novaPaciente?.idPaciente === item.idPaciente}">
            <strong>${escapeHtml(item.nome || "(sem nome)")}</strong>
            <span class="sub">ID ${item.idPaciente} · ${item.numeroFalta}ª falta em ${dataBr(item.dataFalta)} · prazo até ${dataBr(item.dataFimBloqueio)} · ${item.status === "pendente" ? "aguardando bloqueio" : "bloqueado"}</span>
          </button></li>`,
        )
        .join("")
    : `<li class="escolha__vazio">${busca ? "Nenhum paciente com esse nome pode receber solicitação." : "Nenhum paciente pode receber solicitação agora."}</li>`;
};

const abrirNova = async (idPaciente = null) => {
  state.novaPaciente = null;
  els.novaForm.reset();
  els.novaErro.hidden = true;
  els.novaContador.textContent = "0/500";
  els.novaEnviar.disabled = false;
  els.novaEscolhido.textContent = "Só aparecem pacientes bloqueados (ou aguardando bloqueio) com o prazo ainda correndo e sem solicitação aberta.";
  els.novaOpcoes.innerHTML = '<li class="escolha__vazio">Carregando pacientes…</li>';
  els.novaDialog.showModal();
  els.novaBusca.focus();
  try {
    const entrada = await comCache("pacientes", "/api/pacientes", CACHE.pacientes);
    state.pacientes = entrada.data.items || [];
    if (idPaciente) {
      const item = state.pacientes.find((linha) => linha.idPaciente === idPaciente);
      if (item && elegivel(item)) escolher(item);
    }
    renderOpcoes();
    // Alguém pode ter liberado ou pedido por outro paciente há pouco: confere a lista por trás.
    if (Date.now() - entrada.savedAt > NOVO_MS) {
      const nova = writeCache("pacientes", await request("/api/pacientes"));
      state.pacientes = nova.data.items || [];
      if (state.novaPaciente && !state.pacientes.some((item) => item.idPaciente === state.novaPaciente.idPaciente && elegivel(item))) {
        state.novaPaciente = null;
        els.novaEscolhido.textContent = "O paciente escolhido não pode mais receber solicitação. Escolha outro.";
      }
      if (els.novaDialog.open) renderOpcoes();
    }
  } catch (error) {
    if (!state.pacientes.length) {
      els.novaOpcoes.innerHTML = `<li class="escolha__vazio">${escapeHtml(error.message || "Falha ao buscar os pacientes.")}</li>`;
    }
  }
};

const escolher = (item) => {
  state.novaPaciente = item;
  els.novaBusca.value = item.nome || String(item.idPaciente);
  els.novaEscolhido.innerHTML = `Paciente escolhido: <strong>${escapeHtml(item.nome || "(sem nome)")}</strong> · ID ${item.idPaciente} · prazo até ${dataBr(item.dataFimBloqueio)}.`;
  renderOpcoes();
  els.novaMotivo.focus();
};

const enviarNova = async (event) => {
  event.preventDefault();
  if (els.novaEnviar.disabled) return;
  const motivo = els.novaMotivo.value.replace(/\s+/g, " ").trim();
  const erro = (mensagem) => {
    els.novaErro.textContent = mensagem;
    els.novaErro.hidden = false;
  };
  if (!state.novaPaciente) return erro("Escolha o paciente na lista.");
  if (motivo.length < 5) return erro("Escreva o motivo (mínimo 5 caracteres).");

  const fim = ocupado(els.novaEnviar, "Enviando…", { outros: [els.novaCancelar] });
  try {
    const resultado = await criarSolicitacao(state.novaPaciente.idPaciente, motivo);
    els.novaDialog.close();
    avisar(`Solicitação #${resultado.id} enviada: aguarda a aprovação do administrador.`);
    limparDepoisDeSolicitacao(state.novaPaciente.idPaciente);
    state.status = "ABERTAS";
    await recarregar(true).catch(() => {});
  } catch (error) {
    if (error.message !== "unauthorized") erro(error.message || "Falha ao enviar.");
  } finally {
    fim();
  }
};

// ---------- aprovar, recusar, cancelar, liberar ----------
const itemPorId = (id) => (state.dados?.itens || []).find((item) => item.id === id);

const outrosDaLinha = (botao) => [...(botao.closest("td")?.querySelectorAll("button") || [])].filter((b) => b !== botao);

const aprovar = async (botao, item) => {
  if (!window.confirm(`Aprovar a solicitação #${item.id} de ${item.nomePaciente || `paciente ${item.idPaciente}`}? Depois, um Editor ou Admin libera no CNN.`)) return;
  const fim = ocupado(botao, "Aprovando…", { outros: outrosDaLinha(botao) });
  try {
    await decidirSolicitacao(item.id, "aprovar");
    avisar(`Solicitação #${item.id} aprovada. Falta liberar no CNN.`);
  } catch (error) {
    if (error.message !== "unauthorized") avisar(error.message || "Falha ao aprovar.", { erro: true });
  } finally {
    fim();
  }
  limparDepoisDeSolicitacao(item.idPaciente);
  await recarregar(true).catch(() => {});
};

const liberar = async (botao, item, { aprovar: aprovarJunto }) => {
  const nome = item.nomePaciente || `paciente ${item.idPaciente}`;
  const pergunta = aprovarJunto
    ? `Aprovar a solicitação #${item.id} e liberar ${nome} no CNN agora?`
    : `Liberar ${nome} no CNN pela solicitação #${item.id}?`;
  if (!window.confirm(pergunta)) return;
  const fim = ocupado(botao, aprovarJunto ? "Aprovando e liberando…" : "Liberando…", { outros: outrosDaLinha(botao) });
  try {
    const resultado = await liberarSolicitacao(item.id, item.idPaciente, { aprovar: aprovarJunto });
    avisar(resultado.avisoAuditoria ? `${resultado.mensagem} ${resultado.avisoAuditoria}` : resultado.mensagem || "Paciente liberado.", {
      erro: Boolean(resultado.avisoAuditoria),
    });
    limparDepoisDeSolicitacao(item.idPaciente, { liberou: true });
  } catch (error) {
    if (error.message !== "unauthorized") avisar(error.message || "Falha ao liberar.", { erro: true });
    limparDepoisDeSolicitacao(item.idPaciente);
  } finally {
    fim();
  }
  await recarregar(true).catch(() => {});
};

const abrirDecisao = (acao, item) => {
  const recusar = acao === "recusar";
  state.decisao = { acao, item };
  els.decisaoForm.reset();
  els.decisaoKicker.textContent = recusar ? "Recusar solicitação" : "Cancelar solicitação";
  els.decisaoTitulo.textContent = `#${item.id} · ${item.nomePaciente || "(sem nome)"}`;
  els.decisaoContexto.textContent = `Pedido por ${item.solicitadoPor || "—"} em ${dataHoraBr(item.solicitadoEm)}: “${item.motivo}”`;
  els.decisaoRotulo.textContent = recusar ? "Motivo da recusa (obrigatório)" : "Motivo do cancelamento (opcional)";
  els.decisaoMotivo.required = recusar;
  els.decisaoContador.textContent = "0/500";
  els.decisaoErro.hidden = true;
  els.decisaoConfirmar.textContent = recusar ? "Recusar" : "Cancelar solicitação";
  els.decisaoConfirmar.disabled = false;
  els.decisao.showModal();
  els.decisaoMotivo.focus();
};

const confirmarDecisao = async (event) => {
  event.preventDefault();
  if (!state.decisao || els.decisaoConfirmar.disabled) return;
  const { acao, item } = state.decisao;
  const motivo = els.decisaoMotivo.value.replace(/\s+/g, " ").trim();
  if (acao === "recusar" && motivo.length < 5) {
    els.decisaoErro.textContent = "Escreva o motivo da recusa (mínimo 5 caracteres).";
    els.decisaoErro.hidden = false;
    return;
  }
  const fim = ocupado(els.decisaoConfirmar, acao === "recusar" ? "Recusando…" : "Cancelando…", { outros: [els.decisaoCancelar] });
  try {
    await decidirSolicitacao(item.id, acao, motivo);
    state.decisao = null;
    fim();
    els.decisao.close();
    avisar(acao === "recusar" ? `Solicitação #${item.id} recusada.` : `Solicitação #${item.id} cancelada.`);
    limparDepoisDeSolicitacao(item.idPaciente);
    await recarregar(true).catch(() => {});
  } catch (error) {
    fim();
    els.decisaoErro.textContent = error.message === "unauthorized" ? "Sessão expirada. Entre de novo." : error.message;
    els.decisaoErro.hidden = false;
  }
};

// ---------- eventos ----------
els.linhas.addEventListener("click", (event) => {
  const decidir = event.target.closest("[data-decidir]");
  const botaoLiberar = event.target.closest("[data-liberar]");
  const item = itemPorId(Number((decidir || botaoLiberar)?.dataset.sol ?? botaoLiberar?.dataset.liberar));
  if (!item) return;

  if (botaoLiberar) {
    void liberar(botaoLiberar, item, { aprovar: botaoLiberar.dataset.aprovar === "1" });
  } else if (decidir.dataset.decidir === "aprovar") {
    void aprovar(decidir, item);
  } else {
    abrirDecisao(decidir.dataset.decidir, item);
  }
});

document.querySelector(".stats").addEventListener("click", (event) => {
  const kpi = event.target.closest("[data-filtro-status]");
  if (!kpi) return;
  state.status = kpi.dataset.filtroStatus;
  state.destaque = null;
  renderLista();
});

els.filtroStatus.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-status]");
  if (!button) return;
  state.status = button.dataset.status;
  state.destaque = null;
  renderLista();
});

els.busca.addEventListener("input", () => {
  state.busca = els.busca.value;
  state.destaque = null;
  renderLista();
});

els.minhas.addEventListener("change", () => {
  state.minhas = els.minhas.checked;
  renderLista();
});

els.nova.addEventListener("click", () => void abrirNova());
els.novaBusca.addEventListener("input", () => {
  if (state.novaPaciente) {
    state.novaPaciente = null;
    els.novaEscolhido.textContent = "Escolha o paciente na lista.";
  }
  renderOpcoes();
});
els.novaOpcoes.addEventListener("click", (event) => {
  const opcao = event.target.closest("[data-escolher]");
  const item = opcao && state.pacientes.find((linha) => linha.idPaciente === Number(opcao.dataset.escolher));
  if (item) escolher(item);
});
els.novaMotivo.addEventListener("input", () => {
  els.novaContador.textContent = `${els.novaMotivo.value.length}/500`;
});
els.novaForm.addEventListener("submit", (event) => void enviarNova(event));
els.novaCancelar.addEventListener("click", () => els.novaDialog.close());
els.novaDialog.addEventListener("cancel", (event) => {
  if (els.novaEnviar.disabled) event.preventDefault();
});

els.decisaoMotivo.addEventListener("input", () => {
  els.decisaoContador.textContent = `${els.decisaoMotivo.value.length}/500`;
});
els.decisaoForm.addEventListener("submit", (event) => void confirmarDecisao(event));
els.decisaoCancelar.addEventListener("click", () => els.decisao.close());
els.decisao.addEventListener("cancel", (event) => {
  if (els.decisaoConfirmar.disabled) event.preventDefault();
});

// Filtros lembrados na aba; ?id=N (link do detalhe do paciente) destaca a solicitação.
const salvos = lerFiltros("solicitacoes");
if (typeof salvos.status === "string") state.status = salvos.status;
if (typeof salvos.busca === "string") state.busca = salvos.busca;
state.minhas = salvos.minhas === "1";
const parametros = new URLSearchParams(window.location.search);
const idUrl = Number(parametros.get("id"));
if (Number.isSafeInteger(idUrl) && idUrl > 0) state.destaque = idUrl;
els.busca.value = state.busca;
els.minhas.checked = state.minhas;

const recarregar = iniciarPagina(carregar, { prazoMs: CACHE.solicitacoes });

// ?paciente=N (botão "Solicitar desbloqueio" vindo de outra tela): já abre o pedido com o paciente escolhido.
const pacienteUrl = Number(parametros.get("paciente"));
if (getAuth() && Number.isSafeInteger(pacienteUrl) && pacienteUrl > 0) void abrirNova(pacienteUrl);
