// Partes comuns de todas as páginas: login, usuário no menu, relógio, barra de status, erro da API e aviso rápido.
import { clearAuth, clearCaches, encodeAuth, getAuth, getUsuario, setAuth } from "./session.js";

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
  sair: $("#sair"),
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

const atualizarUsuario = () => {
  if (els.usuario) els.usuario.textContent = getUsuario() || "—";
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

/**
 * carregar({ forcar }) busca os dados da página e lança erro se falhar.
 * Devolve uma função para atualizar a página por fora (por exemplo, depois de uma ação).
 */
export const iniciarPagina = (carregar) => {
  const executar = async (forcar = false) => {
    status("busy", "buscando…");
    mostrarErro("");
    try {
      await carregar({ forcar });
      status("ok", `atualizado ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`);
    } catch (error) {
      if (error.message === "unauthorized") {
        status("error", "sem login");
        throw error;
      }
      status("error", "falha");
      mostrarErro(error.message || "Falha ao buscar os dados.");
      throw error;
    }
  };

  els.loginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (els.loginForm.querySelector("button[type='submit']").disabled) return;
    const usuario = els.loginUser.value.trim();
    setAuth(encodeAuth(usuario, els.loginPassword.value), usuario);
    els.loginError.hidden = true;
    setLoginBusy(true);

    try {
      await executar(true);
      els.loginPassword.value = "";
      els.login.close();
      atualizarUsuario();
    } catch (error) {
      els.loginError.textContent =
        error.message === "unauthorized" ? "Usuário ou senha inválidos." : error.message || "Falha ao falar com o servidor.";
      els.loginError.hidden = false;
      if (error.message !== "unauthorized") {
        els.login.close();
        atualizarUsuario();
      }
    } finally {
      setLoginBusy(false);
    }
  });

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

  if (getAuth()) {
    void executar(false).catch(() => {
      if (!getAuth() && !els.login.open) els.login.showModal();
    });
  } else {
    els.login.showModal();
  }

  return executar;
};
