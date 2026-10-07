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

export const encodeAuth = (user, password) => btoa(String.fromCharCode(...new TextEncoder().encode(`${user}:${password}`)));
export const getAuth = () => storage.get(AUTH_KEY);
export const getUsuario = () => storage.get(USER_KEY) || "";
export const setAuth = (value, usuario) => {
  storage.set(AUTH_KEY, value);
  storage.set(USER_KEY, usuario);
};
export const clearAuth = () => {
  storage.remove(AUTH_KEY);
  storage.remove(USER_KEY);
};

export const PACIENTES_CACHE_KEY = "pacientes";
export const PACIENTES_TTL_MS = 60 * 1000;

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

export const clearCaches = () => {
  try {
    Object.keys(sessionStorage)
      .filter((key) => key.startsWith(CACHE_PREFIX))
      .forEach((key) => sessionStorage.removeItem(key));
  } catch {
    // Nada a limpar se o storage está bloqueado.
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
    headers.Authorization = `Basic ${auth}`;
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
    throw new ApiError(payload.error || "Falha na API", response.status, payload.codigo || null);
  }

  return payload;
};
