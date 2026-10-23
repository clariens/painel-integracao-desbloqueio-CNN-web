import { ACAO, DECISAO_SOLICITACAO, ORIGEM, STATUS, dataBr, dataHoraBr, escapeHtml, hojeSp, inicioCiclo, numero, prazoTexto, selo, seloSolicitacao } from "./formato.js";
import { avisar, iniciarPagina, usarCache } from "./pagina.js";
import { CACHE, comCache, getAuth, lerFiltros, pode, prefetchCache, request, salvarFiltros } from "./session.js";
import { criarSolicitacao, liberarSolicitacao, limparDepoisDeSolicitacao } from "./solicitacao.js";

const PAGINA = 100;
const $ = (selector) => document.querySelector(selector);

const state = {
  dados: null,
  situacao: "",
  busca: "",
  faltas: "",
  tipoConsulta: "",
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
  filtroTipo: $("#filtro-tipo"),
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
const SEM_TIPO = "(sem tipo de consulta)";

// O que o paciente ia fazer: tipo de consulta e procedimentos, com o profissional.
// O que o paciente ia fazer: os procedimentos ou, sem eles (clínica que não preenche), o tipo de consulta.
// Na lista vai em vermelho ao lado da data; com mais de um procedimento, o primeiro e "+N" (todos no title).
const procedimentoHtml = (falta) => {
  const lista = String(falta.procedimentos || "").split(", ").filter(Boolean);
  const texto = lista.length ? lista[0] + (lista.length > 1 ? ` +${lista.length - 1}` : "") : falta.tipoConsulta;
  if (!texto) return "";
  const completo = [lista.join(", "), falta.tipoConsulta].filter(Boolean).join(" · ");
  return `<span class="falta-proc" title="${escapeHtml(completo)}">${escapeHtml(texto)}</span>`;
};

const faltasSelo = (n) => !n ? "" : `<span class="faltas-selo${n >= 3 ? " faltas-selo--alta" : ""}">${n} falta${n === 1 ? "" : "s"}</span>`;

// Opções do filtro "Tipo de consulta": os tipos que aparecem na lista, do mais comum ao menos.
const preencherTipos = () => {
  const contagem = new Map();
  for (const item of state.dados?.items || []) {
    const tipo = item.tipoConsulta || SEM_TIPO;
    contagem.set(tipo, (contagem.get(tipo) || 0) + 1);
  }
  const tipos = [...contagem].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"));
  if (state.tipoConsulta && !contagem.has(state.tipoConsulta)) state.tipoConsulta = "";
  els.filtroTipo.innerHTML =
    '<option value="">Todos</option>' +
    tipos.map(([tipo, n]) => `<option value="${escapeHtml(tipo)}">${escapeHtml(tipo)} (${n})</option>`).join("");
  els.filtroTipo.value = state.tipoConsulta;
};

// ---------- lista ----------
const filtrar = () => {
  const items = state.dados?.items || [];
  const busca = normalizar(state.busca.trim());
  const faltas = Number(state.faltas) || 0;

  return items.filter((item) => {
    if (state.situacao && item.status !== state.situacao) return false;
    if (faltas && (faltas >= 3 ? item.faltasCiclo < 3 : item.faltasCiclo !== faltas)) return false;
    if (state.tipoConsulta && (item.tipoConsulta || SEM_TIPO) !== state.tipoConsulta) return false;
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

// Botões por situação (a API confere de novo o perfil e a regra):
//   - bloqueado ou aguardando, com o prazo correndo: liberar só por solicitação de desbloqueio.
//     Sem solicitação: "Solicitar desbloqueio" (todos); o admin tem o atalho "Liberar" (abre, aprova e libera).
//     Com solicitação aprovada: Editor e Admin liberam. Pendente: aguarda o admin (tela Solicitações).
//   - apto (prazo cumprido): Editor e Admin liberam direto (a rotina das 02:00 também libera).
//   - aguardando ou liberado antes do prazo: Editor e Admin podem bloquear na hora.
const botaoSolicitacao = (sol, idPaciente) => {
  if (sol.status === "APROVADA" && pode("EDITOR")) {
    return `<button class="btn btn--sm btn--liberar" type="button" data-liberar-solicitacao="${sol.id}" data-id="${idPaciente}">Liberar</button>`;
  }
  if (sol.status === "PENDENTE" && pode("ADMIN")) {
    return `<button class="btn btn--sm btn--liberar" type="button" data-liberar-solicitacao="${sol.id}" data-aprovar="1" data-id="${idPaciente}">Aprovar e liberar</button>`;
  }
  return `<a class="sol-link" href="/solicitacoes?id=${sol.id}">${seloSolicitacao(sol.status, sol.status === "PENDENTE" ? "Solicitado" : "Aprovado")}</a>`;
};

const botaoAcao = (item) => {
  const botoes = [];
  const sol = item.solicitacao?.valida ? item.solicitacao : null;
  const noPrazo = item.status === "bloqueado" || item.status === "pendente";

  if (noPrazo && sol) {
    botoes.push(botaoSolicitacao(sol, item.idPaciente));
  } else if (noPrazo) {
    botoes.push(
      pode("ADMIN")
        ? `<button class="btn btn--sm btn--liberar" type="button" data-acao="liberar-admin" data-id="${item.idPaciente}">Liberar</button>`
        : `<button class="btn btn--sm" type="button" data-acao="solicitar" data-id="${item.idPaciente}">Solicitar desbloqueio</button>`,
    );
  } else if (item.status === "apto" && pode("EDITOR")) {
    botoes.push(`<button class="btn btn--sm btn--liberar" type="button" data-acao="liberar" data-id="${item.idPaciente}">Liberar</button>`);
  }

  // Aguardando bloqueio ou liberado antes do prazo: Bloquear agora, sem esperar as 01:00.
  if (pode("EDITOR") && (item.status === "pendente" || item.status === "liberado_antecipado") && !item.foraDoCiclo) {
    botoes.push(`<button class="btn btn--sm btn--bloquear" type="button" data-acao="bloquear" data-id="${item.idPaciente}">Bloquear</button>`);
  }
  return botoes.join("");
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
      <span class="sub">ID ${item.idPaciente} ${faltasSelo(item.faltasCiclo)}</span>
    </td>
    <td class="falta-cel">
      <span class="falta-linha"><span class="mono">${item.numeroFalta}ª · ${dataBr(item.dataFalta)}</span>${procedimentoHtml(item)}</span>
      <span class="sub">${item.foraDoCiclo ? "ciclo anterior · " : ""}${escapeHtml(item.profissional || "")}</span>
    </td>
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

  guardarFiltros();
  els.filtroSituacao.querySelectorAll("button").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.situacao === state.situacao));
  });
  document.querySelectorAll("[data-filtro-situacao]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.filtroSituacao === state.situacao));
  });
};

// Filtros lembrados na aba: voltar para Pacientes reabre a lista como estava.
const FILTROS = ["situacao", "busca", "faltas", "tipoConsulta", "ordem"];
const guardarFiltros = () => salvarFiltros("pacientes", Object.fromEntries(FILTROS.map((campo) => [campo, state[campo]])));
const restaurarFiltros = () => {
  const salvos = lerFiltros("pacientes");
  FILTROS.forEach((campo) => {
    if (typeof salvos[campo] === "string") state[campo] = salvos[campo];
  });
  els.busca.value = state.busca;
  els.filtroFaltas.value = state.faltas;
  els.ordem.value = state.ordem;
};

const carregar = async ({ forcar }) => {
  const entrada = await usarCache("pacientes", "/api/pacientes", CACHE.pacientes, { forcar }, (dados) => {
    state.dados = dados;
    renderResumo();
    preencherTipos();
    renderLista();
  });
  // Deixa Relatórios e Configuração prontos em segundo plano.
  const hojeRel = hojeSp();
  const inicioRel = inicioCiclo(hojeRel);
  prefetchCache(`faltas:${inicioRel}:${hojeRel}`, `/api/faltas?${new URLSearchParams({ de: inicioRel, ate: hojeRel })}`, CACHE.faltas);
  prefetchCache("parametros", "/api/parametros", CACHE.parametros);
  prefetchCache("solicitacoes", "/api/solicitacoes", CACHE.solicitacoes);
  return entrada;
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
    <span><strong>${escapeHtml(ACAO[acao.acao] || acao.acao)}</strong> · ${escapeHtml(quem || "—")}${acao.antecipada ? " · antes do prazo" : ""}${acao.idSolicitacao ? ` · solicitação #${acao.idSolicitacao}` : ""}</span>
    <span class="quando">${escapeHtml(dataHoraBr(acao.em))}${acao.numeroFalta ? ` · falta ${acao.numeroFalta}` : ""}${acao.dataFimBloqueio ? ` · prazo ${dataBr(acao.dataFimBloqueio)}` : ""}</span>
    ${acao.motivo ? `<span class="motivo">${escapeHtml(acao.motivo)}</span>` : ""}
    ${resultado}
  </li>`;
};

const renderDetalhe = (p) => {
  const v = p.vigente;
  els.detalheNome.textContent = p.nome || "(sem nome)";
  els.detalheSub.textContent = `ID ${p.idPaciente}${p.cpf ? ` · CPF ${p.cpf}` : ""}`;

  const hojeDetalhe = p.ciclo.hoje;
  const prazoCorrendo = Boolean(v) && v.dataFimBloqueio >= hojeDetalhe;
  // Bloquear vale para falta do período (ciclo) com o prazo ainda correndo.
  const noPeriodo = v && v.noCiclo;
  const podeBloquear = pode("EDITOR") && noPeriodo && prazoCorrendo && p.cnn?.ativo !== false;
  // Antes do fim do prazo, liberar (ou isentar a falta) só por solicitação de desbloqueio.
  const precisaSolicitacao = prazoCorrendo && ["BLOQUEADO", "PENDENTE"].includes(v.situacao);
  const solicitacoes = p.solicitacoes || [];
  const solAberta = solicitacoes.find((s) => s.valida && ["PENDENTE", "APROVADA"].includes(s.status)) || null;
  // Banco e CNN divergem: alguém mudou o paciente direto na plataforma. Oferece registrar o que o CNN já tem.
  const divergeAtivo = v && v.situacao === "BLOQUEADO" && p.cnn?.ativo === true;
  const divergeInativo = noPeriodo && ["LIBERADO", "PENDENTE"].includes(v.situacao) && p.cnn?.ativo === false;
  // Aguardando bloqueio e ainda ativo no CNN: nada divergiu, o bloqueio só não aconteceu ainda.
  const aguardando = noPeriodo && prazoCorrendo && v.situacao === "PENDENTE" && p.cnn?.ativo !== false;

  const botoesLiberar = [];
  if (precisaSolicitacao && solAberta) {
    if (solAberta.status === "APROVADA" && pode("EDITOR")) {
      botoesLiberar.push(`<button class="btn btn--liberar" type="button" data-liberar-solicitacao="${solAberta.id}" data-id="${p.idPaciente}">Liberar no CNN (solicitação #${solAberta.id})</button>`);
    } else if (solAberta.status === "PENDENTE" && pode("ADMIN")) {
      botoesLiberar.push(`<button class="btn btn--liberar" type="button" data-liberar-solicitacao="${solAberta.id}" data-aprovar="1" data-id="${p.idPaciente}">Aprovar e liberar (#${solAberta.id})</button>`);
    }
  } else if (precisaSolicitacao) {
    botoesLiberar.push(
      pode("ADMIN")
        ? `<button class="btn btn--liberar" type="button" data-acao="liberar-admin" data-id="${p.idPaciente}">${aguardando ? "Isentar esta falta" : "Liberar no CNN"}</button>`
        : `<button class="btn" type="button" data-acao="solicitar" data-id="${p.idPaciente}">Solicitar desbloqueio</button>`,
    );
  } else if (pode("EDITOR") && v && v.situacao === "BLOQUEADO" && p.cnn?.ativo !== true) {
    // Prazo cumprido (Apto): libera direto, como a rotina das 02:00 faria.
    botoesLiberar.push(`<button class="btn btn--liberar" type="button" data-acao="liberar" data-id="${p.idPaciente}">Liberar no CNN</button>`);
  }

  const botoes = [
    ...botoesLiberar,
    podeBloquear ? `<button class="btn btn--bloquear" type="button" data-acao="bloquear" data-id="${p.idPaciente}">Bloquear no CNN</button>` : "",
    pode("EDITOR") && divergeAtivo && !prazoCorrendo ? `<button class="btn btn--liberar" type="button" data-acao="liberar" data-registrar="JA_ATIVO" data-id="${p.idPaciente}">Registrar liberação feita no CNN</button>` : "",
    pode("EDITOR") && divergeInativo ? `<button class="btn btn--bloquear" type="button" data-acao="bloquear" data-registrar="JA_BLOQUEADO" data-id="${p.idPaciente}">Registrar bloqueio feito no CNN</button>` : "",
  ].join("");

  const avisoSolicitacao = solAberta
    ? `<p class="modal__contexto">Solicitação #${solAberta.id} ${solAberta.status === "PENDENTE" ? "aguardando aprovação do administrador" : "aprovada: falta liberar no CNN"} · aberta por ${escapeHtml(solAberta.solicitadoPor || "—")} em ${escapeHtml(dataHoraBr(solAberta.solicitadoEm))}. <a href="/solicitacoes?id=${solAberta.id}">Ver solicitações</a></p>`
    : "";
  const divergencia = divergeAtivo
    ? prazoCorrendo
      ? '<p class="modal__alerta">No painel o paciente está bloqueado, mas no CNN ele está ativo: alguém liberou direto na plataforma, antes do fim do prazo. Para valer, a liberação precisa de uma solicitação aprovada pelo administrador; sem ela, o bloqueio das 01:00 bloqueia de novo.</p>'
      : '<p class="modal__alerta">No painel o paciente está bloqueado, mas no CNN ele está ativo: alguém liberou direto na plataforma. O prazo já terminou: registre a liberação (ou deixe a rotina das 02:00 registrar).</p>'
    : divergeInativo
      ? `<p class="modal__alerta">${v.situacao === "PENDENTE" ? "O paciente já está inativo no CNN, mas não há bloqueio registrado para esta falta." : "No painel o paciente está liberado, mas no CNN ele está inativo: alguém bloqueou direto na plataforma."} Registre o bloqueio para o painel refletir o CNN (a execução das 01:00 também registra).</p>`
      : aguardando && !solAberta
        ? '<p class="modal__alerta">Aguardando bloqueio: a falta está registrada, mas o paciente ainda está ativo no CNN. A execução das 01:00 bloqueia. Se o paciente justificou a falta, abra uma solicitação de desbloqueio: aprovada, a falta fica isenta.</p>'
        : "";

  const vigenteHtml = v
    ? `<div class="cartao">
        <div class="cartao__linha">${selo(v.status)} ${cnnTexto(p.cnn)}</div>
        <dl class="dados">
          <dt>Falta vigente</dt><dd>${v.numeroFalta}ª · ${dataBr(v.dataFalta)}${v.noCiclo ? "" : " (ciclo anterior)"}</dd>
          ${v.tipoConsulta || v.procedimentos ? `<dt>Ia fazer</dt><dd><span class="falta-proc">${escapeHtml([v.procedimentos, v.tipoConsulta].filter(Boolean).join(" · "))}</span></dd>` : ""}
          ${v.profissional ? `<dt>Profissional</dt><dd>${escapeHtml(v.profissional)}</dd>` : ""}
          <dt>Prazo</dt><dd>${v.diasBloqueio} dias · até ${dataBr(v.dataFimBloqueio)} (${escapeHtml(prazoTexto(v.dataFimBloqueio, p.ciclo.hoje))})</dd>
          ${p.controle ? `<dt>Controle</dt><dd>${escapeHtml(p.controle.situacao)} · ${escapeHtml(ACAO[p.controle.ultimaAcao] || "")} por ${escapeHtml(p.controle.origem === "PAINEL" ? p.controle.usuario : ORIGEM[p.controle.origem] || "")} em ${escapeHtml(dataHoraBr(p.controle.em))}</dd>` : ""}
        </dl>
        ${avisoSolicitacao}
        ${divergencia}
        ${botoes ? `<div class="cartao__acoes">${botoes}</div>` : ""}
      </div>`
    : `<div class="cartao">${cnnTexto(p.cnn)}<p class="modal__contexto">Sem falta registrada.</p></div>`;

  const faltasHtml = p.faltas.length
    ? `<table class="tabela tabela--compacta">
        <thead><tr><th>Data</th><th class="num">Nº</th><th>Consulta / procedimentos</th><th>Profissional</th></tr></thead>
        <tbody>${p.faltas
          .map(
            (f) => `<tr>
              <td class="mono">${dataBr(f.dataFalta)}${f.horaInicio ? ` ${escapeHtml(f.horaInicio)}` : ""}${f.noCiclo ? "" : '<span class="sub">ciclo anterior</span>'}</td>
              <td class="num">${f.numeroFalta}</td>
              <td>${f.procedimentos ? `<span class="falta-proc">${escapeHtml(f.procedimentos)}</span><span class="sub">${escapeHtml(f.tipoConsulta || "")}</span>` : `<span class="falta-proc">${escapeHtml(f.tipoConsulta || "—")}</span>`}${f.rotulo ? `<span class="sub">rótulo: ${escapeHtml(f.rotulo)}</span>` : ""}</td>
              <td>${escapeHtml(f.profissional || "—")}</td>
            </tr>`,
          )
          .join("")}</tbody>
      </table>`
    : '<p class="modal__contexto">Nenhuma falta.</p>';

  const acoesHtml = p.acoes.length
    ? `<ol class="linha-tempo">${p.acoes.map(acaoItemHtml).join("")}</ol>`
    : '<p class="modal__contexto">Nenhuma ação registrada desde a implantação do painel.</p>';

  const solicitacoesHtml = solicitacoes.length
    ? `<ol class="linha-tempo">${solicitacoes
        .map(
          (s) => `<li class="${s.status === "LIBERADA" ? "is-liberacao" : s.status === "RECUSADA" ? "is-bloqueio" : ""}">
            <span><strong>#${s.id}</strong> ${seloSolicitacao(s.status)} · ${escapeHtml(s.solicitadoPor || "—")}</span>
            <span class="quando">${escapeHtml(dataHoraBr(s.solicitadoEm))}${s.numeroFalta ? ` · falta ${s.numeroFalta}` : ""}${!s.valida && ["PENDENTE", "APROVADA"].includes(s.status) ? " · de uma falta anterior" : ""}</span>
            <span class="motivo">${escapeHtml(s.motivo)}</span>
            ${s.decididoPor || s.motivoDecisao ? `<span class="quando">${escapeHtml(DECISAO_SOLICITACAO[s.status] || s.status)}${s.decididoPor ? ` por ${escapeHtml(s.decididoPor)}` : ""}${s.decididoEm ? ` em ${escapeHtml(dataHoraBr(s.decididoEm))}` : ""}${s.motivoDecisao ? `: ${escapeHtml(s.motivoDecisao)}` : ""}</span>` : ""}
            ${s.liberadoPor ? `<span class="quando">Liberado no CNN por ${escapeHtml(s.liberadoPor)} em ${escapeHtml(dataHoraBr(s.liberadoEm))}</span>` : ""}
          </li>`,
        )
        .join("")}</ol>`
    : '<p class="modal__contexto">Nenhuma solicitação de desbloqueio.</p>';

  els.detalheCorpo.innerHTML = `
    <section aria-label="Situação">${vigenteHtml}</section>
    <section><h3>Faltas (${p.faltas.length})</h3>${faltasHtml}</section>
    <section><h3>Solicitações de desbloqueio (${solicitacoes.length})</h3>${solicitacoesHtml}</section>
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
    const { data } = await comCache(`paciente:${id}`, `/api/pacientes/${id}`, CACHE.paciente);
    if (state.detalheId === id) renderDetalhe(data);
  } catch (error) {
    if (state.detalheId === id) {
      els.detalheCorpo.innerHTML = `<p class="modal__erro">${escapeHtml(error.message === "unauthorized" ? "Sessão expirada. Entre de novo." : error.message)}</p>`;
    }
  }
};

// ---------- liberar / bloquear / solicitar ----------
// Modos do diálogo de motivo:
//   solicitar      -> abre uma solicitação de desbloqueio (todos os perfis);
//   liberar-admin  -> atalho do admin: abre a solicitação, aprova e libera no CNN de uma vez;
//   liberar        -> liberação direta (prazo cumprido) ou registro do que o CNN já tem;
//   bloquear       -> bloqueio na hora.
const MODOS = {
  solicitar: {
    kicker: "Solicitar desbloqueio",
    alerta:
      "A solicitação vai para o administrador aprovar. Escreva o motivo que o paciente informou (por exemplo, atestado médico). " +
      "Você acompanha a resposta na tela Solicitações.",
    botao: "Enviar solicitação",
    classe: "btn--primario",
  },
  "liberar-admin": {
    kicker: "Liberar paciente (administrador)",
    alerta:
      "O prazo ainda não terminou. A liberação fica registrada como uma solicitação de desbloqueio aprovada por você. " +
      "O bloqueio das 01:00 não volta a bloquear por esta falta; uma falta nova bloqueia de novo.",
    botao: "Aprovar e liberar",
    classe: "btn--primario",
  },
  liberar: {
    kicker: "Liberar paciente",
    alerta: "",
    botao: "Liberar no CNN",
    classe: "btn--primario",
  },
  bloquear: {
    kicker: "Bloquear paciente",
    alerta:
      "O painel busca as faltas deste paciente na agenda do CNN, grava as novas e bloqueia pela falta vigente " +
      "(o prazo define quando ele será liberado pela rotina automática).",
    botao: "Bloquear no CNN",
    classe: "btn--perigo",
  },
};

const abrirAcao = (acao, paciente) => {
  const modo = MODOS[acao] || MODOS.liberar;
  const v = paciente.vigente;

  state.acao = { acao, id: paciente.idPaciente, apenasRegistrar: false };
  els.acaoKicker.textContent = modo.kicker;
  els.acaoTitulo.textContent = `${paciente.nome || "(sem nome)"} · ID ${paciente.idPaciente}`;
  els.acaoContexto.textContent = v
    ? `Falta vigente: ${v.numeroFalta}ª em ${dataBr(v.dataFalta)} · prazo de ${v.diasBloqueio} dias até ${dataBr(v.dataFimBloqueio)}.`
    : "";
  els.acaoAlerta.hidden = !modo.alerta;
  els.acaoAlerta.textContent = modo.alerta;
  els.acaoConfirmar.textContent = modo.botao;
  els.acaoConfirmar.className = `btn ${modo.classe}`;
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
  els.acaoConfirmar.textContent = apenasRegistrar
    ? "Registrando…"
    : { solicitar: "Enviando…", "liberar-admin": "Liberando…", liberar: "Liberando…" }[acao] || "Bloqueando…";
  els.acaoErro.hidden = true;

  try {
    let resultado;
    if (acao === "solicitar" || acao === "liberar-admin") {
      resultado = await criarSolicitacao(id, motivo, { aprovarELiberar: acao === "liberar-admin" });
      if (acao === "solicitar") resultado = { mensagem: `Solicitação #${resultado.id} enviada: aguarda a aprovação do administrador.` };
    } else {
      resultado = await request(`/api/pacientes/${id}/${acao}`, {
        method: "POST",
        body: JSON.stringify(apenasRegistrar ? { motivo, apenasRegistrar: true } : { motivo }),
      });
    }
    state.acao = null;
    els.acao.close();
    avisar(resultado.avisoAuditoria ? `${resultado.mensagem} ${resultado.avisoAuditoria}` : resultado.mensagem || "Feito.", {
      erro: Boolean(resultado.avisoAuditoria),
    });
    // A ação mudou o paciente: lista, detalhe, solicitações, histórico e relatórios em cache ficaram velhos.
    limparDepoisDeSolicitacao(id, { liberou: acao !== "solicitar" });
    await recarregar(true).catch(() => {});
    if (els.detalhe.open && state.detalheId === id) await abrirDetalhe(id);
  } catch (error) {
    // O atalho do admin criou a solicitação, mas o CNN falhou: ela ficou aprovada, e a lista precisa mostrar isso.
    if (error.status && acao === "liberar-admin") limparDepoisDeSolicitacao(id);
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

// Liberar a partir de uma solicitação: aprovada (Editor/Admin) ou "Aprovar e liberar" (Admin, ainda pendente).
const liberarPorSolicitacao = async (botao) => {
  const idSolicitacao = Number(botao.dataset.liberarSolicitacao);
  const idPaciente = Number(botao.dataset.id);
  const aprovar = botao.dataset.aprovar === "1";
  const nome = state.dados?.items.find((item) => item.idPaciente === idPaciente)?.nome || `paciente ${idPaciente}`;
  const pergunta = aprovar
    ? `Aprovar a solicitação #${idSolicitacao} e liberar ${nome} no CNN agora?`
    : `Liberar ${nome} no CNN pela solicitação #${idSolicitacao} (já aprovada)?`;
  if (!window.confirm(pergunta)) return;

  botao.disabled = true;
  try {
    const resultado = await liberarSolicitacao(idSolicitacao, idPaciente, { aprovar });
    avisar(resultado.avisoAuditoria ? `${resultado.mensagem} ${resultado.avisoAuditoria}` : resultado.mensagem || "Paciente liberado.", {
      erro: Boolean(resultado.avisoAuditoria),
    });
    limparDepoisDeSolicitacao(idPaciente, { liberou: true });
  } catch (error) {
    if (error.message !== "unauthorized") avisar(error.message || "Falha ao liberar.", { erro: true });
    limparDepoisDeSolicitacao(idPaciente);
  } finally {
    botao.disabled = false;
  }
  await recarregar(true).catch(() => {});
  if (els.detalhe.open && state.detalheId === idPaciente) await abrirDetalhe(idPaciente);
};

// ---------- eventos ----------
document.addEventListener("click", (event) => {
  const detalhe = event.target.closest("[data-detalhe]");
  if (detalhe) {
    void abrirDetalhe(Number(detalhe.dataset.detalhe));
    return;
  }

  const porSolicitacao = event.target.closest("[data-liberar-solicitacao]");
  if (porSolicitacao) {
    void liberarPorSolicitacao(porSolicitacao);
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

els.filtroTipo.addEventListener("change", () => {
  state.tipoConsulta = els.filtroTipo.value;
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

restaurarFiltros();
const recarregar = iniciarPagina(carregar, { prazoMs: CACHE.pacientes });

const pacienteUrl = Number(new URLSearchParams(window.location.search).get("paciente"));
if (getAuth() && Number.isSafeInteger(pacienteUrl) && pacienteUrl > 0) {
  void abrirDetalhe(pacienteUrl);
}
