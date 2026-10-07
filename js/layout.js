// Script clássico, carregado logo após o <aside>: aplica o estado do menu antes da pintura para ele não piscar.
// Base: js/layout.js do painel de monitoramento. Aqui o menu começa aberto em tela larga.
(() => {
  const KEY = "clariens.cnn.nav";
  const OPEN_CLASS = "is-nav-open";
  const body = document.body;
  const overlay = window.matchMedia("(max-width: 980px)");

  const readOpen = () => {
    try {
      const saved = sessionStorage.getItem(KEY);
      return saved ? saved === "open" : !overlay.matches;
    } catch {
      return !overlay.matches;
    }
  };

  const saveOpen = (open) => {
    try {
      sessionStorage.setItem(KEY, open ? "open" : "closed");
    } catch {
      // Sem storage o menu só não é lembrado entre páginas.
    }
  };

  const isOpen = () => body.classList.contains(OPEN_CLASS);

  const sync = (open) => {
    body.classList.toggle(OPEN_CLASS, open);
    document.querySelectorAll("[data-nav-toggle]").forEach((button) => {
      button.setAttribute("aria-expanded", String(open));
      button.setAttribute("aria-label", open ? "Fechar menu" : "Abrir menu");
    });
  };

  const setOpen = (open) => {
    const sidebar = document.querySelector("#sidebar");
    const hadFocus = sidebar?.contains(document.activeElement);
    sync(open);
    saveOpen(open);
    if (!open && hadFocus) {
      document.querySelector("[data-nav-toggle]")?.focus();
    }
  };

  sync(readOpen());
  document.addEventListener("DOMContentLoaded", () => sync(isOpen()));

  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-nav-toggle]")) {
      setOpen(!isOpen());
      return;
    }
    if (event.target.closest("[data-nav-close]")) {
      setOpen(false);
      return;
    }
    if (overlay.matches && event.target.closest(".sidebar__nav a")) {
      saveOpen(false);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen() && overlay.matches && !document.querySelector("dialog[open]")) {
      setOpen(false);
    }
  });

  // Tema claro (padrão Clariens) / escuro. O <head> de cada página aplica o salvo antes da pintura.
  const TEMA_KEY = "clariens.cnn.tema";
  const temaAtual = () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");

  const syncTema = () => {
    const escuro = temaAtual() === "dark";
    document.querySelectorAll("[data-tema-toggle]").forEach((button) => {
      button.textContent = escuro ? "Modo claro" : "Modo escuro";
      button.setAttribute("aria-pressed", String(escuro));
      button.setAttribute("aria-label", escuro ? "Mudar para o modo claro" : "Mudar para o modo escuro");
    });
  };

  document.addEventListener("click", (event) => {
    if (!event.target.closest("[data-tema-toggle]")) return;
    const novo = temaAtual() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = novo;
    try {
      localStorage.setItem(TEMA_KEY, novo);
    } catch {
      // Sem storage o tema só não é lembrado na próxima visita.
    }
    syncTema();
  });

  document.addEventListener("DOMContentLoaded", syncTema);
})();
