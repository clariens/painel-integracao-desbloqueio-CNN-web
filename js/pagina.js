// Partes comuns de todas as páginas: login, usuário no menu, relógio, barra de status, erro da API e aviso rápido.
import { PERFIL, escapeHtml, hojeSp, inicioCiclo } from "./formato.js";
import { clearAuth, clearCaches, comCache, getAuth, getUsuario, pode, readCache, request, setAuth, temCache, writeCache } from "./session.js";

const $ = (selector) => document.querySelector(selector);

const els = {
  login: $("#login"),
  loginForm: $("#login-form"),
  loginUser: $("#login-user"),
  loginPassword: $("#login-password"),
  loginError: $("#login-error"),
  apiError: $("#api-error"),
  clock: $("#clock"),
  syncDot: $("#sync-dot"),
  syncState: $("#sync-state"),
  refresh: $("#refresh"),
  usuario: $("#usuario-nome"),
  perfil: $("#usuario-perfil"),
  sair: $("#sair"),
  trocarSenha: $("#trocar-senha"),
  senha: $("#senha"),
  senhaForm: $("#senha-form"),
  senhaAviso: $("#senha-aviso"),
  senhaAtual: $("#senha-atual"),
  senhaNova: $("#senha-nova"),
  senhaConfirma: $("#senha-confirma"),
  senhaErro: $("#senha-erro"),
  senhaCancelar: $("#senha-cancelar"),
  senhaSalvar: $("#senha-salvar"),
};

let toastTimer = null;

export const mostrarErro = (mensagem) => {
  if (!els.apiError) return;
  els.apiError.textContent = mensagem || "";
  els.apiError.hidden = !mensagem;
};

export const status = (estado, texto) => {
  els.syncDot?.classList.toggle("is-busy", estado === "busy");
  els.syncDot?.classList.toggle("is-error", estado === "error");
  if (els.syncState) els.syncState.textContent = texto;
};

export const avisar = (mensagem, { erro = false } = {}) => {
  let toast = $("#toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    toast.className = "toast";
    toast.setAttribute("role", "status");
    document.body.append(toast);
  }
  toast.textContent = mensagem;
  toast.classList.toggle("is-erro", erro);
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 6000);
};

// Contador do menu "Solicitações": quantas aguardam aprovação. Lê o que já está na aba (a lista de
// solicitações ou, sem ela, o resumo de Pacientes); nunca chama a API só para isso.
const DIA_MS = 24 * 60 * 60 * 1000;
export const atualizarContador = () => {
  const alvo = $("#nav-solicitacoes");
  if (!alvo) return;
  const lista = readCache("solicitacoes", DIA_MS)?.data;
  const resumo = readCache("pacientes", DIA_MS)?.data?.resumo;
  const pendentes = lista?.contagem ? Number(lista.contagem.PENDENTE || 0) : Number(resumo?.solicitacoesPendentes || 0);
  alvo.textContent = pendentes > 0 ? String(pendentes) : "";
  alvo.title = pendentes > 0 ? `${pendentes} aguardando aprovação` : "";
  // Para o admin (quem aprova) o contador fica em destaque.
  alvo.classList.toggle("is-destaque", pendentes > 0 && pode("ADMIN"));
};

const atualizarUsuario = () => {
  const usuario = getUsuario();
  if (els.usuario) els.usuario.textContent = usuario?.nome || usuario?.login || "—";
  if (els.perfil) els.perfil.textContent = PERFIL[usuario?.perfil] || "";
};

// Troca da própria senha. Obrigatória (sem Cancelar e sem Esc) quando a senha é temporária.
let senhaObrigatoria = false;
let aposTrocarSenha = null;

const abrirTrocaSenha = (obrigatoria) => {
  if (!els.senha || els.senha.open) return;
  senhaObrigatoria = obrigatoria;
  els.senhaForm.reset();
  els.senhaErro.hidden = true;
  els.senhaAviso.hidden = !obrigatoria;
  els.senhaCancelar.hidden = obrigatoria;
  els.senha.showModal();
  els.senhaAtual.focus();
};

const horaCurta = (data) =>
  data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

// A tela mostrou o dado novo que chegou em segundo plano.
export const atualizadoAs = (savedAt) => status("ok", `atualizado às ${horaCurta(new Date(savedAt))}`);

/**
 * Carrega uma tela pelo cache: dado no prazo aparece sem chamar a API; dado vencido aparece na hora e é
 * atualizado por trás (aplicar roda de novo quando o novo chega). aplicar(dados) desenha a tela.
 */
export const usarCache = async (key, apiPath, prazoMs, { forcar }, aplicar) => {
  const entrada = await comCache(key, apiPath, prazoMs, {
    forcar,
    aoAtualizar: (nova) => {
      aplicar(nova.data);
      atualizadoAs(nova.savedAt);
      atualizarContador();
    },
  });
  aplicar(entrada.data);
  return entrada;
};

// O que cada tela abre por padrão: mesmas chaves e caminhos que as telas usam (js/pacientes.js, relatorios.js...).
const telasPadrao = () => {
  const hoje = hojeSp();
  const inicio = inicioCiclo(hoje);
  return [
    { nome: "Pacientes", key: "pacientes", path: "/api/pacientes" },
    { nome: "Solicitações", key: "solicitacoes", path: "/api/solicitacoes" },
    { nome: "Relatórios", key: `faltas:${inicio}:${hoje}`, path: `/api/faltas?${new URLSearchParams({ de: inicio, ate: hoje })}` },
    { nome: "Histórico", key: "acoes:page=1", path: "/api/acoes?page=1" },
    { nome: "Configuração", key: "parametros", path: "/api/parametros" },
    ...(pode("ADMIN") ? [{ nome: "Usuários", key: "usuarios", path: "/api/usuarios" }] : []),
  ];
};

// Ao entrar: busca todas as telas ao mesmo tempo (o tempo de uma busca, não de cinco) com uma tela de espera.
// Depois disso, trocar de tela não espera o n8n. Falha numa tela não trava as outras: ela busca sozinha ao abrir.
export const prepararDados = async () => {
  const telas = telasPadrao();
  const camada = document.createElement("div");
  camada.className = "preparo";
  camada.setAttribute("role", "status");
  camada.setAttribute("aria-live", "polite");
  camada.innerHTML = `
    <div class="preparo__cartao">
      <div class="preparo__anel" aria-hidden="true"><span></span><span></span><span></span></div>
      <h2>Preparando os dados…</h2>
      <p>Buscando todas as telas de uma vez, para a navegação ficar instantânea.</p>
      <ul class="preparo__lista">${telas
        .map((tela, i) => `<li data-preparo="${i}"><span class="preparo__marca" aria-hidden="true"></span>${escapeHtml(tela.nome)}</li>`)
        .join("")}</ul>
      <div class="preparo__barra" aria-hidden="true"><span></span></div>
    </div>`;
  document.body.append(camada);
  const barra = camada.querySelector(".preparo__barra span");
  let prontas = 0;

  await Promise.allSettled(
    telas.map(async (tela, i) => {
      const item = camada.querySelector(`[data-preparo="${i}"]`);
      try {
        writeCache(tela.key, await request(tela.path));
        item.classList.add("is-ok");
      } catch {
        item.classList.add("is-falha");
      } finally {
        prontas += 1;
        barra.style.width = `${Math.round((prontas / telas.length) * 100)}%`;
      }
    }),
  );

  camada.classList.add("is-saindo");
  window.setTimeout(() => camada.remove(), 350);
  atualizarContador();
};

const relogio = () => {
  if (!els.clock) return;
  els.clock.textContent = new Date().toLocaleString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
};

const setLoginBusy = (busy) => {
  const button = els.loginForm?.querySelector("button[type='submit']");
  if (!button) return;
  button.disabled = busy;
  button.textContent = busy ? "Entrando…" : "Entrar";
};

const hora = (data) => data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

/**
 * carregar({ forcar }) busca os dados da página e lança erro se falhar. Se devolver { savedAt } (entrada do cache),
 * a barra mostra a hora em que o dado foi buscado, e não a hora em que a tela abriu.
 * prazoMs: refaz a busca quando o cache vence (só com a aba visível e sem diálogo aberto).
 * Devolve uma função para atualizar a página por fora (por exemplo, depois de uma ação).
 */
export const iniciarPagina = (carregar, { prazoMs } = {}) => {
  const executar = async (forcar = false) => {
    status("busy", "buscando…");
    mostrarErro("");
    try {
      const resultado = await carregar({ forcar });
      atualizarContador();
      // Dado vencido na tela enquanto o novo vem por trás.
      if (resultado?.velho) status("busy", "atualizando…");
      else status("ok", `atualizado às ${hora(resultado?.savedAt ? new Date(resultado.savedAt) : new Date())}`);
    } catch (error) {
      if (error.message === "unauthorized") {
        status("error", "sem login");
        throw error;
      }
      if (error.codigo === "TROCAR_SENHA") {
        status("error", "troque a senha");
        throw error;
      }
      status("error", "falha");
      mostrarErro(error.message || "Falha ao buscar os dados.");
      throw error;
    }
  };

  // Prepara todas as telas e abre esta já com o dado guardado.
  const entrarComDados = async () => {
    await prepararDados();
    await executar(false).catch(() => {});
  };
  aposTrocarSenha = () => entrarComDados();

  els.loginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (els.loginForm.querySelector("button[type='submit']").disabled) return;
    els.loginError.hidden = true;
    setLoginBusy(true);

    let sessao;
    try {
      sessao = await request("/api/sessao", {
        method: "POST",
        body: JSON.stringify({ usuario: els.loginUser.value.trim(), senha: els.loginPassword.value }),
      });
    } catch (error) {
      els.loginError.textContent =
        error.message === "unauthorized" ? "Usuário ou senha inválidos." : error.message || "Falha ao falar com o servidor.";
      els.loginError.hidden = false;
      setLoginBusy(false);
      return;
    }

    setAuth(sessao.token, sessao.usuario);
    document.documentElement.dataset.sessao = "sim";
    els.loginPassword.value = "";
    setLoginBusy(false);
    els.login.close();
    atualizarUsuario();

    // Outra pessoa pode ter usado a aba antes: nada do cache dela serve.
    clearCaches();
    if (sessao.trocarSenha) {
      abrirTrocaSenha(true);
      return;
    }
    void entrarComDados();
  });

  els.senhaForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (els.senhaSalvar.disabled) return;
    const mostrar = (mensagem) => {
      els.senhaErro.textContent = mensagem;
      els.senhaErro.hidden = false;
    };
    // Mesma regra de validarSenha (lib/auth.js); a API confere de novo.
    const nova = els.senhaNova.value;
    if (nova.length < 6) {
      mostrar("A nova senha precisa ter pelo menos 6 caracteres.");
      return;
    }
    if (!/\d/.test(nova)) {
      mostrar("A nova senha precisa ter pelo menos um número.");
      return;
    }
    if (!/[^\p{L}\p{N}\s]/u.test(nova)) {
      mostrar("A nova senha precisa ter pelo menos um caractere especial (ex.: ! @ # $ % * -).");
      return;
    }
    if (els.senhaNova.value !== els.senhaConfirma.value) {
      mostrar("A confirmação não é igual à nova senha.");
      return;
    }

    els.senhaSalvar.disabled = true;
    els.senhaSalvar.textContent = "Salvando…";
    try {
      const sessao = await request("/api/senha", {
        method: "POST",
        body: JSON.stringify({ atual: els.senhaAtual.value, nova: els.senhaNova.value }),
      });
      setAuth(sessao.token, sessao.usuario);
      const eraObrigatoria = senhaObrigatoria;
      senhaObrigatoria = false;
      els.senha.close();
      avisar("Senha alterada.");
      if (eraObrigatoria) aposTrocarSenha?.();
    } catch (error) {
      if (error.message !== "unauthorized") mostrar(error.message || "Falha ao trocar a senha.");
      else els.senha.close();
    } finally {
      els.senhaSalvar.disabled = false;
      els.senhaSalvar.textContent = "Salvar senha";
    }
  });

  els.senha?.addEventListener("cancel", (event) => {
    if (senhaObrigatoria) event.preventDefault();
  });
  els.senhaCancelar?.addEventListener("click", () => els.senha.close());
  els.trocarSenha?.addEventListener("click", () => abrirTrocaSenha(false));
  // A API respondeu TROCAR_SENHA (senha temporária ainda não trocada): abre a troca obrigatória.
  document.addEventListener("cnn:trocar-senha", () => abrirTrocaSenha(true));

  // Login fechado: o painel volta a aparecer (o CSS o esconde enquanto data-sessao="nao").
  els.login?.addEventListener("close", () => {
    document.documentElement.dataset.sessao = "sim";
  });

  // O login não fecha com Esc: sem ele a página não tem o que mostrar.
  els.login?.addEventListener("cancel", (event) => event.preventDefault());

  els.refresh?.addEventListener("click", () => {
    void executar(true).catch(() => {});
  });

  els.sair?.addEventListener("click", () => {
    clearAuth();
    clearCaches();
    window.location.reload();
  });

  relogio();
  window.setInterval(relogio, 30_000);
  atualizarUsuario();
  atualizarContador();

  if (prazoMs) {
    window.setInterval(() => {
      if (getAuth() && document.visibilityState === "visible" && !document.querySelector("dialog[open]")) {
        void executar(false).catch(() => {});
      }
    }, prazoMs);
  }

  if (getAuth()) {
    // Aba já logada mas sem nada guardado (ex.: recarregou depois de limpar): prepara tudo de uma vez.
    const abrir = temCache() ? Promise.resolve() : prepararDados();
    void abrir.then(() =>
      executar(false).catch(() => {
        if (!getAuth() && !els.login.open) els.login.showModal();
      }),
    );
  } else {
    els.login.showModal();
  }

  return executar;
};
