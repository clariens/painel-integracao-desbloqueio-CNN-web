import { ACAO, ORIGEM, STATUS, dataBr, dataHoraBr, escapeHtml, numero, prazoTexto, selo } from "./formato.js";
import { avisar, iniciarPagina } from "./pagina.js";
import { PACIENTES_CACHE_KEY, PACIENTES_TTL_MS, clearCaches, getAuth, readCache, request, writeCache } from "./session.js";

const PAGINA = 100;
const AUTO_REFRESH_MS = 5 * 60 * 1000;
const $ = (selector) => document.querySelector(selector);

const state = {
  dados: null,
  situacao: "",
  busca: "",
  faltas: "",
  ordem: "fim",
  limite: PAGINA,
  detalheId: null,
  acao: null,
};

const els = {
  ciclo: $("#ciclo"),
  avisoControle: $("#aviso-controle"),
  kpiPendentes: $("#kpi-pendentes"),
  kpiBloqueados: $("#kpi-bloqueados"),
  kpiAptos: $("#kpi-aptos"),
  kpiAntecipados: $("#kpi-antecipados"),
  kpiFaltasCiclo: $("#kpi-faltas-ciclo"),
  kpiPacientesCiclo: $("#kpi-pacientes-ciclo"),
  kpiFaltasMes: $("#kpi-faltas-mes"),
  kpiColeta: $("#kpi-coleta"),
  busca: $("#busca"),
  filtroSituacao: $("#filtro-situacao"),
  filtroFaltas: $("#filtro-faltas"),
  ordem: $("#ordem"),
  linhas: $("#linhas"),
  vazio: $("#vazio"),
  resumo: $("#lista-resumo"),
  mais: $("#mais"),
  detalhe: $("#detalhe"),
  detalheNome: $("#detalhe-nome"),
  detalheSub: $("#detalhe-sub"),
  detalheCorpo: $("#detalhe-corpo"),
  detalheFechar: $("#detalhe-fechar"),
  acao: $("#acao"),
  acaoForm: $("#acao-form"),
  acaoKicker: $("#acao-kicker"),
  acaoTitulo: $("#acao-titulo"),
  acaoContexto: $("#acao-contexto"),
  acaoAlerta: $("#acao-alerta"),
  acaoMotivo: $("#acao-motivo"),
  acaoContador: $("#acao-contador"),
  acaoErro: $("#acao-erro"),
  acaoCancelar: $("#acao-cancelar"),
  acaoConfirmar: $("#acao-confirmar"),
};

const normalizar = (texto) =>
  String(texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const hoje = () => state.dados?.ciclo?.hoje || "";

// ---------- lista ----------
const filtrar = () => {
  const items = state.dados?.items || [];
  const busca = normalizar(state.busca.trim());
  const faltas = Number(state.faltas) || 0;

  return items.filter((item) => {
    if (state.situacao && item.status !== state.situacao) return false;
    if (faltas && (faltas >= 3 ? item.faltasCiclo < 3 : item.faltasCiclo !== faltas)) return false;
    if (busca && !normalizar(item.nome).includes(busca) && !String(item.idPaciente).includes(busca)) return false;
    return true;
  });
};

const ordenar = (items) => {
  const porNome = (a, b) => String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR");
  const comparadores = {
    fim: (a, b) => String(a.dataFimBloqueio).localeCompare(String(b.dataFimBloqueio)) || porNome(a, b),
    falta: (a, b) => String(b.dataFalta).localeCompare(String(a.dataFalta)) || porNome(a, b),
    faltas: (a, b) => b.faltasCiclo - a.faltasCiclo || porNome(a, b),
    nome: porNome,
  };
  return [...items].sort(comparadores[state.ordem] || comparadores.fim);
};

const botaoAcao = (item) => {
  // Bloqueado (ou prazo vencido sem registro, que pode ter sido bloqueado pela automação antiga): Liberar.
  if (item.status === "bloqueado" || item.status === "apto") {
    return `<button class="btn btn--sm btn--liberar" type="button" data-acao="liberar" data-id="${item.idPaciente}">Liberar</button>`;
  }
  // Aguardando bloqueio ou liberado antes do prazo: Bloquear agora, sem esperar as 01:00.
  if ((item.status === "pendente" || item.status === "liberado_antecipado") && !item.foraDoCiclo) {
    return `<button class="btn btn--sm btn--bloquear" type="button" data-acao="bloquear" data-id="${item.idPaciente}">Bloquear</button>`;
  }
  return "";
};

const ultimaAcaoHtml = (ultima) => {
  if (!ultima) return '<span class="sub">—</span>';
  const quem = ultima.origem === "PAINEL" ? ultima.usuario : ORIGEM[ultima.origem] || ultima.origem;
  const antiga = ultima.vigente ? "" : " (falta anterior)";
  return `${escapeHtml(ACAO[ultima.acao] || ultima.acao)} · ${escapeHtml(quem || "—")}<span class="sub">${escapeHtml(dataHoraBr(ultima.em))}${antiga}</span>`;
};

const linhaHtml = (item) => `
  <tr>
    <td>
      <button class="link-paciente" type="button" data-detalhe="${item.idPaciente}">${escapeHtml(item.nome || "(sem nome)")}</button>
      <span class="sub">ID ${item.idPaciente}</span>
    </td>
    <td class="num">${item.faltasCiclo}</td>
    <td class="mono">${item.numeroFalta}ª · ${dataBr(item.dataFalta)}<span class="sub">${item.foraDoCiclo ? "ciclo anterior" : escapeHtml(item.profissional || "")}</span></td>
    <td class="mono">${dataBr(item.dataFimBloqueio)}<span class="sub">${item.diasBloqueio} dias · ${escapeHtml(prazoTexto(item.dataFimBloqueio, hoje()))}</span></td>
    <td>${selo(item.status)}</td>
    <td>${ultimaAcaoHtml(item.ultimaAcao)}</td>
    <td class="acoes-cel">${botaoAcao(item)}</td>
  </tr>`;

const renderResumo = () => {
  const { resumo, ciclo, items = [] } = state.dados || {};
  if (!resumo) return;

  els.ciclo.textContent = `Ciclo desde ${dataBr(ciclo.inicio)} · hoje ${dataBr(ciclo.hoje)}`;
  els.kpiPendentes.textContent = numero(resumo.pendentes ?? 0);
  els.kpiBloqueados.textContent = numero(resumo.bloqueados);
  els.kpiAptos.textContent = numero(resumo.aptos);
  els.kpiAntecipados.textContent = numero(resumo.liberadosAntecipados);
  els.kpiFaltasCiclo.textContent = numero(resumo.faltasCiclo);
  els.kpiPacientesCiclo.textContent = `${numero(resumo.pacientesCiclo)} pacientes · ${numero(resumo.porFaltas[3])} com 3+`;
  els.kpiFaltasMes.textContent = numero(resumo.faltasMes);
  els.kpiColeta.textContent = `coleta: ${dataHoraBr(resumo.ultimaColeta)}`;
  els.avisoControle.hidden = Boolean(resumo.controleCarregado);

  const contagem = { todos: items.length };
  Object.keys(STATUS).forEach((status) => {
    contagem[status] = items.filter((item) => item.status === status).length;
  });
  Object.entries(contagem).forEach(([chave, valor]) => {
    const alvo = document.getElementById(`cont-${chave}`);
    if (alvo) alvo.textContent = numero(valor);
  });
};

const renderLista = () => {
  const filtrados = ordenar(filtrar());
  const visiveis = filtrados.slice(0, state.limite);

  els.linhas.innerHTML = visiveis.map(linhaHtml).join("");
  els.vazio.hidden = filtrados.length > 0 || !state.dados;
  els.mais.hidden = filtrados.length <= visiveis.length;
  els.resumo.textContent = state.dados
    ? `${numero(visiveis.length)} de ${numero(filtrados.length)} pacientes${filtrados.length !== state.dados.items.length ? ` (total ${numero(state.dados.items.length)})` : ""}`
    : "—";

  els.filtroSituacao.querySelectorAll("button").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.situacao === state.situacao));
  });
  document.querySelectorAll("[data-filtro-situacao]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.filtroSituacao === state.situacao));
  });
};

const carregar = async ({ forcar }) => {
  const cache = forcar ? null : readCache(PACIENTES_CACHE_KEY, PACIENTES_TTL_MS);
  if (cache) {
    state.dados = cache.data;
  } else {
    state.dados = await request("/api/pacientes");
    writeCache(PACIENTES_CACHE_KEY, state.dados);
  }
  renderResumo();
  renderLista();
};

// ---------- detalhe ----------
const cnnTexto = (cnn) => {
  if (!cnn?.consultado) return selo("apto", "CNN não consultado");
  if (cnn.erro) return selo("apto", `CNN: ${cnn.erro}`);
  if (cnn.ativo === true) return selo("liberado", "Ativo no CNN");
  if (cnn.ativo === false) return selo("bloqueado", "Inativo (bloqueado) no CNN");
  return selo("apto", "CNN sem o campo ativo");
};

const acaoItemHtml = (acao) => {
  const classe = acao.acao === "LIBERACAO" ? "is-liberacao" : "is-bloqueio";
  const quem = acao.origem === "PAINEL" ? acao.usuario : ORIGEM[acao.origem] || acao.origem;
  const resultado = acao.sucesso
    ? !acao.httpStatus && String(acao.respostaApi || "").startsWith("Sem PATCH")
      ? `<span class="quando">Só registro, nada enviado ao CNN: ${escapeHtml(String(acao.respostaApi).replace(/^Sem PATCH:\s*/, ""))}</span>`
      : ""
    : `<span class="falha">Falhou no CNN${acao.httpStatus ? ` (HTTP ${acao.httpStatus})` : ""}: ${escapeHtml(acao.respostaApi || "sem detalhe")}</span>`;
  return `<li class="${classe}">
    <span><strong>${escapeHtml(ACAO[acao.acao] || acao.acao)}</strong> · ${escapeHtml(quem || "—")}${acao.antecipada ? " · antes do prazo" : ""}</span>
    <span class="quando">${escapeHtml(dataHoraBr(acao.em))}${acao.numeroFalta ? ` · falta ${acao.numeroFalta}` : ""}${acao.dataFimBloqueio ? ` · prazo ${dataBr(acao.dataFimBloqueio)}` : ""}</span>
    ${acao.motivo ? `<span class="motivo">${escapeHtml(acao.motivo)}</span>` : ""}
    ${resultado}
  </li>`;
};

const renderDetalhe = (p) => {
  const v = p.vigente;
  els.detalheNome.textContent = p.nome || "(sem nome)";
  els.detalheSub.textContent = `ID ${p.idPaciente}${p.cpf ? ` · CPF ${p.cpf}` : ""}`;

  const podeLiberar = p.cnn?.ativo !== true && v;
  // Bloquear vale para qualquer falta do período (ciclo); o prazo só decide a liberação.
  const noPeriodo = v && v.noCiclo;
  const podeBloquear = noPeriodo && p.cnn?.ativo !== false;
  // Banco e CNN divergem: alguém mudou o paciente direto na plataforma. Oferece registrar o que o CNN já tem.
  const divergeAtivo = v && v.situacao === "BLOQUEADO" && p.cnn?.ativo === true;
  const divergeInativo = noPeriodo && ["LIBERADO", "PENDENTE"].includes(v.situacao) && p.cnn?.ativo === false;
  // Aguardando bloqueio e ainda ativo no CNN: nada divergiu, o bloqueio só não aconteceu ainda.
  const aguardando = noPeriodo && v.situacao === "PENDENTE" && p.cnn?.ativo !== false;
  const botoes = [
    podeLiberar ? `<button class="btn btn--liberar" type="button" data-acao="liberar" data-id="${p.idPaciente}">Liberar no CNN</button>` : "",
    podeBloquear ? `<button class="btn btn--bloquear" type="button" data-acao="bloquear" data-id="${p.idPaciente}">Bloquear no CNN</button>` : "",
    aguardando ? `<button class="btn" type="button" data-acao="liberar" data-registrar="NAO_BLOQUEADO" data-id="${p.idPaciente}">Isentar esta falta</button>` : "",
    divergeAtivo ? `<button class="btn btn--liberar" type="button" data-acao="liberar" data-registrar="JA_ATIVO" data-id="${p.idPaciente}">Registrar liberação feita no CNN</button>` : "",
    divergeInativo ? `<button class="btn btn--bloquear" type="button" data-acao="bloquear" data-registrar="JA_BLOQUEADO" data-id="${p.idPaciente}">Registrar bloqueio feito no CNN</button>` : "",
  ].join("");
  const divergencia = divergeAtivo
    ? '<p class="modal__alerta">No painel o paciente está bloqueado, mas no CNN ele está ativo: alguém liberou direto na plataforma. Registre a liberação para o bloqueio das 01:00 não bloquear de novo por esta falta.</p>'
    : divergeInativo
      ? `<p class="modal__alerta">${v.situacao === "PENDENTE" ? "O paciente já está inativo no CNN, mas não há bloqueio registrado para esta falta." : "No painel o paciente está liberado, mas no CNN ele está inativo: alguém bloqueou direto na plataforma."} Registre o bloqueio para o painel refletir o CNN (a execução das 01:00 também registra).</p>`
      : aguardando
        ? '<p class="modal__alerta">Aguardando bloqueio: a falta está registrada, mas o paciente ainda está ativo no CNN. Bloqueie agora ou espere a execução das 01:00. Se a falta não deve valer, use "Isentar esta falta".</p>'
        : "";

  const vigenteHtml = v
    ? `<div class="cartao">
        <div class="cartao__linha">${selo(v.status)} ${cnnTexto(p.cnn)}</div>
        <dl class="dados">
          <dt>Falta vigente</dt><dd>${v.numeroFalta}ª · ${dataBr(v.dataFalta)}${v.noCiclo ? "" : " (ciclo anterior)"}</dd>
          <dt>Prazo</dt><dd>${v.diasBloqueio} dias · até ${dataBr(v.dataFimBloqueio)} (${escapeHtml(prazoTexto(v.dataFimBloqueio, p.ciclo.hoje))})</dd>
          ${p.controle ? `<dt>Controle</dt><dd>${escapeHtml(p.controle.situacao)} · ${escapeHtml(ACAO[p.controle.ultimaAcao] || "")} por ${escapeHtml(p.controle.origem === "PAINEL" ? p.controle.usuario : ORIGEM[p.controle.origem] || "")} em ${escapeHtml(dataHoraBr(p.controle.em))}</dd>` : ""}
        </dl>
        ${divergencia}
        ${botoes ? `<div class="cartao__acoes">${botoes}</div>` : ""}
      </div>`
    : `<div class="cartao">${cnnTexto(p.cnn)}<p class="modal__contexto">Sem falta registrada.</p></div>`;

  const faltasHtml = p.faltas.length
    ? `<table class="tabela tabela--compacta">
        <thead><tr><th>Data</th><th class="num">Nº</th><th>Profissional</th><th>Coletada em</th></tr></thead>
        <tbody>${p.faltas
          .map(
            (f) => `<tr>
              <td class="mono">${dataBr(f.dataFalta)}${f.horaInicio ? ` ${escapeHtml(f.horaInicio)}` : ""}${f.noCiclo ? "" : '<span class="sub">ciclo anterior</span>'}</td>
              <td class="num">${f.numeroFalta}</td>
              <td>${escapeHtml(f.profissional || "—")}</td>
              <td class="mono">${escapeHtml(dataHoraBr(f.coletadaEm))}</td>
            </tr>`,
          )
          .join("")}</tbody>
      </table>`
    : '<p class="modal__contexto">Nenhuma falta.</p>';

  const acoesHtml = p.acoes.length
    ? `<ol class="linha-tempo">${p.acoes.map(acaoItemHtml).join("")}</ol>`
    : '<p class="modal__contexto">Nenhuma ação registrada desde a implantação do painel.</p>';

  els.detalheCorpo.innerHTML = `
    <section aria-label="Situação">${vigenteHtml}</section>
    <section><h3>Faltas (${p.faltas.length})</h3>${faltasHtml}</section>
    <section><h3>Histórico de ações</h3>${acoesHtml}</section>`;

  els.detalhe.dataset.paciente = JSON.stringify({ idPaciente: p.idPaciente, nome: p.nome, vigente: v, hoje: p.ciclo.hoje });
};

const abrirDetalhe = async (id) => {
  state.detalheId = id;
  const resumo = state.dados?.items.find((item) => item.idPaciente === id);
  els.detalheNome.textContent = resumo?.nome || `Paciente ${id}`;
  els.detalheSub.textContent = `ID ${id}`;
  els.detalheCorpo.innerHTML = '<p class="modal__contexto">Buscando faltas, histórico e status no CNN…</p>';
  delete els.detalhe.dataset.paciente;
  if (!els.detalhe.open) els.detalhe.showModal();

  try {
    const dados = await request(`/api/pacientes/${id}`);
    if (state.detalheId === id) renderDetalhe(dados);
  } catch (error) {
    if (state.detalheId === id) {
      els.detalheCorpo.innerHTML = `<p class="modal__erro">${escapeHtml(error.message === "unauthorized" ? "Sessão expirada. Entre de novo." : error.message)}</p>`;
    }
  }
};

// ---------- liberar / bloquear ----------
const abrirAcao = (acao, paciente) => {
  const liberar = acao === "liberar";
  const v = paciente.vigente;
  const antecipada = liberar && v && v.dataFimBloqueio >= paciente.hoje;

  state.acao = { acao, id: paciente.idPaciente, apenasRegistrar: false };
  els.acaoKicker.textContent = liberar ? "Liberar paciente" : "Bloquear paciente";
  els.acaoTitulo.textContent = `${paciente.nome || "(sem nome)"} · ID ${paciente.idPaciente}`;
  els.acaoContexto.textContent = v
    ? `Falta vigente: ${v.numeroFalta}ª em ${dataBr(v.dataFalta)} · prazo de ${v.diasBloqueio} dias até ${dataBr(v.dataFimBloqueio)}.`
    : "";
  els.acaoAlerta.hidden = !(antecipada || !liberar);
  els.acaoAlerta.textContent = liberar
    ? "O prazo ainda não terminou: esta é uma liberação antecipada. O bloqueio das 01:00 não volta a bloquear por esta falta; uma falta nova bloqueia de novo."
    : "O painel busca as faltas deste paciente na agenda do CNN, grava as novas e bloqueia pela falta vigente (o prazo só define quando poderá ser liberado).";
  els.acaoConfirmar.textContent = liberar ? "Liberar no CNN" : "Bloquear no CNN";
  els.acaoConfirmar.className = `btn ${liberar ? "btn--primario" : "btn--perigo"}`;
  els.acaoConfirmar.disabled = false;
  els.acaoCancelar.disabled = false;
  els.acaoMotivo.value = "";
  els.acaoContador.textContent = "0/500";
  els.acaoErro.hidden = true;
  els.acao.showModal();
  els.acaoMotivo.focus();
};

const pacienteParaAcao = (id) => {
  if (els.detalhe.open && els.detalhe.dataset.paciente) {
    const doDetalhe = JSON.parse(els.detalhe.dataset.paciente);
    if (doDetalhe.idPaciente === id) return doDetalhe;
  }
  const item = state.dados?.items.find((linha) => linha.idPaciente === id);
  if (!item) return null;
  return {
    idPaciente: item.idPaciente,
    nome: item.nome,
    hoje: hoje(),
    vigente: {
      numeroFalta: item.numeroFalta,
      dataFalta: item.dataFalta,
      diasBloqueio: item.diasBloqueio,
      dataFimBloqueio: item.dataFimBloqueio,
    },
  };
};

// O CNN já está no estado pedido (alguém mudou direto na plataforma). Em vez de só mostrar o erro,
// o diálogo oferece registrar a situação no painel: controle e auditoria passam a refletir o CNN, sem PATCH.
const REGISTRAR = {
  JA_ATIVO: {
    kicker: "Paciente já ativo no CNN",
    alerta:
      "Este paciente já está ATIVO no CNN: alguém liberou direto na plataforma. Quer registrar essa liberação no painel? " +
      "Nada é enviado ao CNN. O controle e o histórico passam a mostrar a liberação, e o bloqueio das 01:00 deixa de " +
      "considerar esta falta e as anteriores. Uma falta nova bloqueia de novo.",
    botao: "Registrar liberação",
  },
  NAO_BLOQUEADO: {
    kicker: "Paciente ainda não bloqueado",
    alerta:
      "A falta está registrada, mas este paciente ainda NÃO foi bloqueado no CNN (está ativo). Não há o que liberar. " +
      "Se a falta não deve valer, você pode isentá-la: nada é enviado ao CNN e o bloqueio das 01:00 deixa de bloquear " +
      "por ela. Uma falta nova bloqueia normalmente. Se a falta vale, cancele e use Bloquear.",
    botao: "Isentar esta falta",
  },
  JA_BLOQUEADO: {
    kicker: "Paciente já inativo no CNN",
    alerta:
      "Este paciente já está INATIVO (bloqueado) no CNN. Quer registrar o bloqueio no painel? " +
      "Nada é enviado ao CNN. O controle e o histórico passam a mostrar o bloqueio por esta falta.",
    botao: "Registrar bloqueio",
  },
};

const oferecerRegistro = (codigo) => {
  const textos = REGISTRAR[codigo];
  state.acao.apenasRegistrar = true;
  els.acaoKicker.textContent = textos.kicker;
  els.acaoAlerta.textContent = textos.alerta;
  els.acaoAlerta.hidden = false;
  els.acaoErro.hidden = true;
  els.acaoConfirmar.textContent = textos.botao;
  els.acaoConfirmar.className = "btn btn--primario";
  els.acaoConfirmar.disabled = false;
  els.acaoCancelar.disabled = false;
  els.acaoConfirmar.focus();
};

const confirmarAcao = async (event) => {
  event.preventDefault();
  if (!state.acao || els.acaoConfirmar.disabled) return;

  const motivo = els.acaoMotivo.value.replace(/\s+/g, " ").trim();
  if (motivo.length < 5) {
    els.acaoErro.textContent = "Escreva o motivo (mínimo 5 caracteres).";
    els.acaoErro.hidden = false;
    return;
  }

  const { acao, id, apenasRegistrar } = state.acao;
  const textoOriginal = els.acaoConfirmar.textContent;
  els.acaoConfirmar.disabled = true;
  els.acaoCancelar.disabled = true;
  els.acaoConfirmar.textContent = apenasRegistrar ? "Registrando…" : acao === "liberar" ? "Liberando…" : "Bloqueando…";
  els.acaoErro.hidden = true;

  try {
    const resultado = await request(`/api/pacientes/${id}/${acao}`, {
      method: "POST",
      body: JSON.stringify(apenasRegistrar ? { motivo, apenasRegistrar: true } : { motivo }),
    });
    state.acao = null;
    els.acao.close();
    avisar(resultado.avisoAuditoria ? `${resultado.mensagem} ${resultado.avisoAuditoria}` : resultado.mensagem || "Feito.", {
      erro: Boolean(resultado.avisoAuditoria),
    });
    clearCaches();
    await recarregar(true).catch(() => {});
    if (els.detalhe.open && state.detalheId === id) await abrirDetalhe(id);
  } catch (error) {
    if (REGISTRAR[error.codigo] && !apenasRegistrar) {
      oferecerRegistro(error.codigo);
      return;
    }
    els.acaoErro.textContent = error.message === "unauthorized" ? "Sessão expirada. Entre de novo e repita." : error.message;
    els.acaoErro.hidden = false;
    els.acaoConfirmar.disabled = false;
    els.acaoCancelar.disabled = false;
    els.acaoConfirmar.textContent = textoOriginal;
  }
};

// ---------- eventos ----------
document.addEventListener("click", (event) => {
  const detalhe = event.target.closest("[data-detalhe]");
  if (detalhe) {
    void abrirDetalhe(Number(detalhe.dataset.detalhe));
    return;
  }

  const botao = event.target.closest("[data-acao]");
  if (botao) {
    const paciente = pacienteParaAcao(Number(botao.dataset.id));
    if (paciente) {
      abrirAcao(botao.dataset.acao, paciente);
      if (REGISTRAR[botao.dataset.registrar]) {
        oferecerRegistro(botao.dataset.registrar);
        els.acaoMotivo.focus();
      }
    }
    return;
  }

  const kpi = event.target.closest("[data-filtro-situacao]");
  if (kpi) {
    state.situacao = state.situacao === kpi.dataset.filtroSituacao ? "" : kpi.dataset.filtroSituacao;
    state.limite = PAGINA;
    renderLista();
  }
});

els.filtroSituacao.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-situacao]");
  if (!button) return;
  state.situacao = button.dataset.situacao;
  state.limite = PAGINA;
  renderLista();
});

els.busca.addEventListener("input", () => {
  state.busca = els.busca.value;
  state.limite = PAGINA;
  renderLista();
});

els.filtroFaltas.addEventListener("change", () => {
  state.faltas = els.filtroFaltas.value;
  state.limite = PAGINA;
  renderLista();
});

els.ordem.addEventListener("change", () => {
  state.ordem = els.ordem.value;
  renderLista();
});

els.mais.addEventListener("click", () => {
  state.limite += PAGINA;
  renderLista();
});

els.detalheFechar.addEventListener("click", () => els.detalhe.close());
els.detalhe.addEventListener("close", () => {
  state.detalheId = null;
});
els.detalhe.addEventListener("click", (event) => {
  if (event.target === els.detalhe) els.detalhe.close();
});

els.acaoForm.addEventListener("submit", (event) => void confirmarAcao(event));
els.acaoCancelar.addEventListener("click", () => els.acao.close());
els.acao.addEventListener("cancel", (event) => {
  if (els.acaoConfirmar.disabled) event.preventDefault();
});
els.acaoMotivo.addEventListener("input", () => {
  els.acaoContador.textContent = `${els.acaoMotivo.value.length}/500`;
});

const recarregar = iniciarPagina(carregar);

window.setInterval(() => {
  if (!document.querySelector("dialog[open]") && document.visibilityState === "visible") {
    void recarregar(true).catch(() => {});
  }
}, AUTO_REFRESH_MS);

const pacienteUrl = Number(new URLSearchParams(window.location.search).get("paciente"));
if (getAuth() && Number.isSafeInteger(pacienteUrl) && pacienteUrl > 0) {
  void abrirDetalhe(pacienteUrl);
}
