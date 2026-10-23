import { EVENTO_USUARIO, dataHoraBr, escapeHtml, numero, selo, seloPerfil } from "./formato.js";
import { avisar, iniciarPagina, ocupado, usarCache } from "./pagina.js";
import { CACHE, getUsuario, request } from "./session.js";

// Gestão de usuários (só ADMIN; a API recusa os demais com 403).
const $ = (selector) => document.querySelector(selector);

const state = { dados: null, editando: null };

const els = {
  novo: $("#novo"),
  linhas: $("#linhas"),
  vazio: $("#vazio"),
  eventos: $("#eventos"),
  eventosVazio: $("#eventos-vazio"),
  kpiAtivos: $("#kpi-ativos"),
  kpiInativos: $("#kpi-inativos"),
  kpiAdmins: $("#kpi-admins"),
  kpiEditores: $("#kpi-editores"),
  kpiLeitores: $("#kpi-leitores"),
  dialogo: $("#usuario-dialog"),
  form: $("#usuario-form"),
  kicker: $("#usuario-kicker"),
  titulo: $("#usuario-titulo"),
  login: $("#usuario-login"),
  nome: $("#usuario-nome-campo"),
  perfil: $("#usuario-perfil-campo"),
  dica: $("#usuario-dica"),
  erro: $("#usuario-erro"),
  cancelar: $("#usuario-cancelar"),
  salvar: $("#usuario-salvar"),
  senhaTemp: $("#senha-temp"),
  senhaTempTitulo: $("#senha-temp-titulo"),
  senhaTempValor: $("#senha-temp-valor"),
  senhaTempCopiar: $("#senha-temp-copiar"),
};

const euMesmo = (login) => login.toLowerCase() === String(getUsuario()?.login || "").toLowerCase();
const bloqueadoAgora = (u) => u.bloqueadoAte && Date.parse(u.bloqueadoAte) > Date.now();

const situacao = (u) => {
  if (!u.ativo) return selo("falha", "Desativado");
  if (bloqueadoAgora(u)) return `${selo("pendente", "Login bloqueado")}<span class="sub">até ${escapeHtml(dataHoraBr(u.bloqueadoAte))}</span>`;
  return `${selo("ok", "Ativo")}${u.trocarSenha ? '<span class="sub">senha temporária, ainda não trocada</span>' : ""}`;
};

const botoes = (u) => {
  const login = escapeHtml(u.login);
  const lista = [`<button class="btn btn--sm" type="button" data-editar="${login}">Editar</button>`];
  // O próprio admin não se desativa nem redefine a própria senha por aqui (usa "Trocar senha" no menu).
  if (!euMesmo(u.login)) {
    lista.push(`<button class="btn btn--sm" type="button" data-senha="${login}">Redefinir senha</button>`);
    lista.push(
      u.ativo
        ? `<button class="btn btn--sm btn--bloquear" type="button" data-ativo="false" data-login="${login}">Desativar</button>`
        : `<button class="btn btn--sm btn--liberar" type="button" data-ativo="true" data-login="${login}">Reativar</button>`,
    );
  }
  return lista.join("");
};

const linhaHtml = (u) => `
  <tr class="${u.ativo ? "" : "linha--inativa"}">
    <td>${escapeHtml(u.nome)}${euMesmo(u.login) ? ' <span class="sub-inline">(você)</span>' : ""}<span class="sub mono">${escapeHtml(u.login)}</span></td>
    <td>${seloPerfil(u.perfil)}</td>
    <td>${situacao(u)}</td>
    <td class="mono">${u.ultimoAcessoEm ? escapeHtml(dataHoraBr(u.ultimoAcessoEm)) : "nunca"}</td>
    <td class="mono">${escapeHtml(dataHoraBr(u.criadoEm))}<span class="sub">${escapeHtml(u.criadoPor || "")}</span></td>
    <td class="acoes-cel">${botoes(u)}</td>
  </tr>`;

const eventoHtml = (e) => `
  <tr>
    <td class="mono">${escapeHtml(dataHoraBr(e.em))}</td>
    <td class="mono">${escapeHtml(e.login)}</td>
    <td>${escapeHtml(EVENTO_USUARIO[e.evento] || e.evento)}</td>
    <td>${escapeHtml(e.detalhe || "—")}</td>
    <td class="mono">${escapeHtml(e.por || "—")}</td>
  </tr>`;

const render = () => {
  const { usuarios, eventos } = state.dados;
  const ativos = usuarios.filter((u) => u.ativo);
  const conta = (perfil) => numero(ativos.filter((u) => u.perfil === perfil).length);

  els.kpiAtivos.textContent = numero(ativos.length);
  els.kpiInativos.textContent = `${numero(usuarios.length - ativos.length)} desativados`;
  els.kpiAdmins.textContent = conta("ADMIN");
  els.kpiEditores.textContent = conta("EDITOR");
  els.kpiLeitores.textContent = conta("LEITOR");

  els.linhas.innerHTML = usuarios.map(linhaHtml).join("");
  els.vazio.hidden = usuarios.length > 0;
  els.eventos.innerHTML = eventos.map(eventoHtml).join("");
  els.eventosVazio.hidden = eventos.length > 0;
};

const carregar = async ({ forcar }) => {
  const entrada = await usarCache("usuarios", "/api/usuarios", CACHE.usuarios, { forcar }, (dados) => {
    state.dados = dados;
    render();
  });
  return entrada;
};

// Depois de criar ou alterar alguém, atualizar() força a busca (e regrava o cache).
const recarregar = iniciarPagina(carregar, { prazoMs: CACHE.usuarios });
const atualizar = () => recarregar(true).catch(() => {});

const mostrarSenhaTemporaria = (login, senha) => {
  els.senhaTempTitulo.textContent = login;
  els.senhaTempValor.textContent = senha;
  els.senhaTempCopiar.textContent = "Copiar senha";
  els.senhaTemp.showModal();
};

// ---------- novo / editar ----------
const abrirDialogo = (usuario = null) => {
  state.editando = usuario;
  els.form.reset();
  els.erro.hidden = true;
  els.kicker.textContent = usuario ? "Editar usuário" : "Novo usuário";
  els.titulo.textContent = usuario ? usuario.nome : "Novo usuário";
  els.login.value = usuario?.login || "";
  els.login.disabled = Boolean(usuario);
  els.nome.value = usuario?.nome || "";
  els.perfil.value = usuario?.perfil || "LEITOR";
  // O próprio perfil de admin não muda por aqui (outro admin muda).
  els.perfil.disabled = Boolean(usuario && euMesmo(usuario.login));
  els.dica.textContent = usuario
    ? euMesmo(usuario.login)
      ? "Você pode mudar o seu nome. Perfil e acesso de admin só outro admin altera."
      : "Mudar o perfil encerra as ações da sessão aberta da pessoa: ela entra de novo para continuar."
    : "Uma senha temporária é gerada ao salvar. A pessoa define a própria senha no primeiro acesso.";
  els.dialogo.showModal();
  (usuario ? els.nome : els.login).focus();
};

els.novo.addEventListener("click", () => abrirDialogo());
els.cancelar.addEventListener("click", () => els.dialogo.close());
els.dialogo.addEventListener("cancel", (event) => {
  if (els.salvar.disabled) event.preventDefault();
});

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (els.salvar.disabled) return;
  els.erro.hidden = true;
  const fim = ocupado(els.salvar, "Salvando…", { outros: [els.cancelar] });

  const editando = state.editando;
  try {
    if (editando) {
      const alteracao = {};
      if (els.nome.value.trim() !== editando.nome) alteracao.nome = els.nome.value;
      if (!els.perfil.disabled && els.perfil.value !== editando.perfil) alteracao.perfil = els.perfil.value;
      if (Object.keys(alteracao).length) {
        await request(`/api/usuarios/${encodeURIComponent(editando.login)}`, { method: "PATCH", body: JSON.stringify(alteracao) });
        avisar(`${editando.login} atualizado.`);
      }
      els.dialogo.close();
    } else {
      const criado = await request("/api/usuarios", {
        method: "POST",
        body: JSON.stringify({ login: els.login.value, nome: els.nome.value, perfil: els.perfil.value }),
      });
      els.dialogo.close();
      mostrarSenhaTemporaria(criado.login, criado.senhaTemporaria);
    }
    void atualizar();
  } catch (error) {
    if (error.message !== "unauthorized") {
      els.erro.textContent = error.message || "Falha ao salvar.";
      els.erro.hidden = false;
    } else {
      els.dialogo.close();
    }
  } finally {
    fim();
  }
});

// ---------- ações da linha ----------
const acharUsuario = (login) => state.dados?.usuarios.find((u) => u.login === login);

els.linhas.addEventListener("click", async (event) => {
  const botao = event.target.closest("button");
  if (!botao || botao.disabled) return;

  if (botao.dataset.editar) {
    const usuario = acharUsuario(botao.dataset.editar);
    if (usuario) abrirDialogo(usuario);
    return;
  }

  const executar = async (login, corpo, pergunta, sucesso) => {
    if (!window.confirm(pergunta)) return;
    const texto = corpo.redefinirSenha ? "Gerando senha…" : corpo.ativo === false ? "Desativando…" : "Reativando…";
    const outros = [...(botao.closest("td")?.querySelectorAll("button") || [])].filter((b) => b !== botao);
    const fim = ocupado(botao, texto, { outros });
    try {
      const resposta = await request(`/api/usuarios/${encodeURIComponent(login)}`, { method: "PATCH", body: JSON.stringify(corpo) });
      if (resposta.senhaTemporaria) mostrarSenhaTemporaria(login, resposta.senhaTemporaria);
      else avisar(sucesso);
      void atualizar();
    } catch (error) {
      if (error.message !== "unauthorized") avisar(error.message || "Falha ao alterar o usuário.", { erro: true });
    } finally {
      fim();
    }
  };

  if (botao.dataset.senha) {
    const login = botao.dataset.senha;
    await executar(
      login,
      { redefinirSenha: true },
      `Gerar uma senha temporária nova para ${login}? A senha atual deixa de funcionar e a sessão aberta da pessoa é encerrada.`,
      "",
    );
    return;
  }

  if (botao.dataset.login) {
    const login = botao.dataset.login;
    const ativar = botao.dataset.ativo === "true";
    await executar(
      login,
      { ativo: ativar },
      ativar ? `Reativar ${login}? A pessoa volta a entrar com a senha que já tinha.` : `Desativar ${login}? A pessoa não consegue mais entrar. O histórico dela continua.`,
      ativar ? `${login} reativado.` : `${login} desativado.`,
    );
  }
});

els.senhaTempCopiar.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(els.senhaTempValor.textContent);
    els.senhaTempCopiar.textContent = "Copiada";
  } catch {
    // Sem permissão de área de transferência: seleciona o texto para copiar à mão.
    const selecao = window.getSelection();
    const faixa = document.createRange();
    faixa.selectNodeContents(els.senhaTempValor);
    selecao.removeAllRanges();
    selecao.addRange(faixa);
    els.senhaTempCopiar.textContent = "Selecione e copie (Ctrl+C)";
  }
});

// A senha temporária não fica na tela depois de fechada.
els.senhaTemp.addEventListener("close", () => {
  els.senhaTempValor.textContent = "—";
});
