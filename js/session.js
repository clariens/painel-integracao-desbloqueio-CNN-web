// Login na aba, chamadas para /api e cache curto. Base: js/session.js do painel de monitoramento.
const AUTH_KEY = "clariens.cnn.auth";
const USER_KEY = "clariens.cnn.usuario";
const CACHE_PREFIX = "clariens.cnn.cache:";

const storage = {
  get: (key) => {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: (key, value) => {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      // Sem storage o login dura só até a próxima navegação.
    }
  },
  remove: (key) => {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // nada a limpar
    }
  },
};

// AUTH_KEY guarda o token da sessão (assinado pela Vercel); USER_KEY, { login, nome, perfil } para a tela.
export const getAuth = () => storage.get(AUTH_KEY);
export const getUsuario = () => {
  try {
    return JSON.parse(storage.get(USER_KEY) || "null");
  } catch {
    return null;
  }
};
export const setAuth = (token, usuario) => {
  storage.set(AUTH_KEY, token);
  storage.set(USER_KEY, JSON.stringify(usuario));
  document.documentElement.dataset.perfil = usuario?.perfil || "";
};

// Só para mostrar ou esconder botões: quem decide a permissão é a API.
const NIVEL = { LEITOR: 1, EDITOR: 2, ADMIN: 3 };
export const pode = (perfil) => (NIVEL[getUsuario()?.perfil] || 0) >= NIVEL[perfil];
export const clearAuth = () => {
  storage.remove(AUTH_KEY);
  storage.remove(USER_KEY);
  limparFiltros();
  document.documentElement.dataset.perfil = "";
};

// Prazo do cache de cada tela. Dentro do prazo, trocar de tela não chama a API (nem o n8n).
export const CACHE = {
  pacientes: 2 * 60 * 1000, // lista: muda com frequência e o próprio painel altera
  paciente: 60 * 1000, // detalhe: tem o status ao vivo no CNN
  faltas: 10 * 60 * 1000, // relatórios, por período
  acoes: 2 * 60 * 1000, // histórico, por filtro e página
  parametros: 30 * 60 * 1000, // configuração: quase não muda
  usuarios: 2 * 60 * 1000,
  solicitacoes: 60 * 1000, // pedidos de desbloqueio: o contador do menu sai daqui
  dashboard: 10 * 60 * 1000, // dashboard, por período (junto com faltas)
};

export const PACIENTES_CACHE_KEY = "pacientes";
export const PACIENTES_TTL_MS = CACHE.pacientes;

export const readCache = (key, maxAgeMs) => {
  try {
    const raw = storage.get(CACHE_PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry?.savedAt || Date.now() - entry.savedAt >= maxAgeMs) return null;
    return entry;
  } catch {
    return null;
  }
};

export const writeCache = (key, data) => {
  const entry = { savedAt: Date.now(), data };
  try {
    sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
  } catch {
    // Cota cheia ou storage bloqueado: a página só busca de novo na próxima entrada.
  }
  return entry;
};

export const clearCache = (key) => storage.remove(CACHE_PREFIX + key);

// Apaga as entradas cujas chaves começam com um dos prefixos (ex.: "acoes:", "faltas:"). Sem prefixo, apaga todas.
export const clearCaches = (...prefixos) => {
  try {
    const alvo = prefixos.length ? prefixos.map((prefixo) => CACHE_PREFIX + prefixo) : [CACHE_PREFIX];
    Object.keys(sessionStorage)
      .filter((key) => alvo.some((inicio) => key.startsWith(inicio)))
      .forEach((key) => sessionStorage.removeItem(key));
  } catch {
    // Nada a limpar se o storage está bloqueado.
  }
};

// Filtros de cada tela, lembrados na aba (somem ao fechar, como o cache).
const FILTROS_PREFIX = "clariens.cnn.filtros:";
export const lerFiltros = (tela) => {
  try {
    return JSON.parse(storage.get(FILTROS_PREFIX + tela) || "null") || {};
  } catch {
    return {};
  }
};
export const salvarFiltros = (tela, filtros) => storage.set(FILTROS_PREFIX + tela, JSON.stringify(filtros));
const limparFiltros = () => {
  try {
    Object.keys(sessionStorage)
      .filter((key) => key.startsWith(FILTROS_PREFIX))
      .forEach((key) => sessionStorage.removeItem(key));
  } catch {
    // Nada a limpar.
  }
};

export class ApiError extends Error {
  constructor(message, status, codigo = null) {
    super(message);
    this.status = status;
    this.codigo = codigo;
  }
}

export const request = async (path, options = {}) => {
  const headers = {
    Accept: "application/json",
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {}),
  };
  const auth = getAuth();

  if (auth) {
    headers.Authorization = `Bearer ${auth}`;
  }

  const response = await fetch(path, { ...options, headers });

  if (response.status === 401) {
    clearAuth();
    clearCaches();
    const login = document.querySelector("#login");
    if (login && !login.open) {
      login.showModal();
    }
    throw new ApiError("unauthorized", 401);
  }

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    throw new ApiError("O servidor não respondeu JSON. A chamada pode ter caído no meio.", response.status);
  }

  if (!response.ok) {
    // Senha temporária: a página abre o diálogo de troca (js/pagina.js escuta este evento).
    if (payload.codigo === "TROCAR_SENHA") {
      document.dispatchEvent(new CustomEvent("cnn:trocar-senha"));
    }
    throw new ApiError(payload.error || "Falha na API", response.status, payload.codigo || null);
  }

  return payload;
};

// "Cache primeiro": dentro do prazo devolve o que está na aba, sem chamar a API; senão busca e grava.
// Devolve { savedAt, data }; forcar (botão "Atualizar agora") ignora o cache e regrava.
// Com aoAtualizar, um dado vencido (até VELHO_MAX) aparece na hora com { velho: true } e a busca roda por trás;
// quando chega, grava e chama aoAtualizar(novaEntrada). Assim a tela nunca espera o n8n se já tem algo guardado.
const VELHO_MAX = 12 * 60 * 60 * 1000;
const emAndamento = new Map();
export const comCache = async (key, path, maxAgeMs, { forcar = false, aoAtualizar } = {}) => {
  if (!forcar) {
    const entrada = readCache(key, maxAgeMs);
    if (entrada) return entrada;

    const velha = aoAtualizar ? readCache(key, VELHO_MAX) : null;
    if (velha) {
      if (!emAndamento.has(key)) {
        const busca = request(path)
          .then((dados) => aoAtualizar(writeCache(key, dados)))
          .catch(() => {
            // Falhou por trás: a tela segue com o dado guardado; o próximo prazo tenta de novo.
          })
          .finally(() => emAndamento.delete(key));
        emAndamento.set(key, busca);
      }
      return { ...velha, velho: true };
    }
  }
  return writeCache(key, await request(path));
};

export const temCache = () => {
  try {
    return Object.keys(sessionStorage).some((key) => key.startsWith(CACHE_PREFIX));
  } catch {
    return false;
  }
};

// Depois que uma tela carrega, deixa a base de outra pronta em segundo plano (bônus: se falhar, a tela busca sozinha).
export const prefetchCache = (key, path, maxAgeMs) => {
  if (!getAuth() || readCache(key, maxAgeMs)) return;
  window.setTimeout(async () => {
    if (!getAuth() || readCache(key, maxAgeMs)) return;
    try {
      writeCache(key, await request(path));
    } catch {
      // Pré-carga é bônus.
    }
  }, 1500);
};
