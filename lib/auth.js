import crypto from "node:crypto";

// Sem WWW-Authenticate de propósito: com ele o navegador abre a caixa nativa de login por cima do diálogo do painel.
const unauthorizedHeaders = {
  "Cache-Control": "no-store",
};

const USER_PATTERN = /^[A-Za-z0-9._-]{2,50}$/;
const HEX_PATTERN = /^[0-9a-f]+$/i;
export const SCRYPT_KEYLEN = 64;

// Cada verificação scrypt custa dezenas de ms; a instância aquecida guarda os cabeçalhos já aceitos.
const verified = new Map();
const VERIFIED_MAX = 200;

export const json = (res, status, payload, extraHeaders = {}) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  Object.entries(extraHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  res.end(JSON.stringify(payload));
};

// DASHBOARD_USERS = "joao:<salt hex>:<hash hex>,maria:<salt hex>:<hash hex>" (gerado por scripts/gerar-senha.mjs).
const readUsers = () => {
  const users = new Map();
  String(process.env.DASHBOARD_USERS || "")
    .split(/[,;\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .forEach((entry) => {
      const [user, salt, hash] = entry.split(":");
      if (USER_PATTERN.test(user || "") && HEX_PATTERN.test(salt || "") && HEX_PATTERN.test(hash || "")) {
        users.set(user, { salt, hash });
      }
    });
  return users;
};

export const hashPassword = (password, salt) =>
  crypto.scryptSync(String(password), Buffer.from(salt, "hex"), SCRYPT_KEYLEN).toString("hex");

const decodeHeader = (req) => {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Basic ")) {
    return null;
  }

  let decoded = "";
  try {
    decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  } catch {
    return null;
  }

  const separatorIndex = decoded.indexOf(":");
  if (separatorIndex < 0) {
    return null;
  }

  return { header, user: decoded.slice(0, separatorIndex), password: decoded.slice(separatorIndex + 1) };
};

const checkPassword = (user, password) => {
  const entry = readUsers().get(user);
  if (!entry) {
    return false;
  }

  const expected = Buffer.from(entry.hash, "hex");
  const actual = Buffer.from(hashPassword(password, entry.salt), "hex");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
};

export const usuarioAutenticado = (req) => {
  const credentials = decodeHeader(req);
  if (!credentials) {
    return null;
  }

  const key = crypto
    .createHash("sha256")
    .update(`${process.env.DASHBOARD_USERS || ""}\n${credentials.header}`)
    .digest("hex");
  if (verified.has(key)) {
    return verified.get(key);
  }

  if (!checkPassword(credentials.user, credentials.password)) {
    return null;
  }

  if (verified.size >= VERIFIED_MAX) {
    verified.clear();
  }
  verified.set(key, credentials.user);
  return credentials.user;
};

export const requireAuth = (req, res) => {
  if (usuarioAutenticado(req)) {
    return true;
  }

  json(res, 401, { error: "Não autorizado" }, unauthorizedHeaders);
  return false;
};

export const requireMethod = (req, res, method) => {
  if (req.method === method) {
    return true;
  }

  json(res, 405, { error: "Método não permitido" }, { Allow: method });
  return false;
};

// Corpo malformado vira 400 em vez de derrubar a função com 500.
export const lerCorpo = (req, res) => {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  if (req.body === undefined || req.body === null || req.body === "") {
    return {};
  }

  try {
    const parsed = JSON.parse(String(req.body));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // cai no 400 abaixo
  }

  json(res, 400, { error: "Corpo da requisição inválido." });
  return null;
};

export const lerIdPaciente = (req, res) => {
  const raw = String(req.query.id || "");
  const id = /^\d{1,15}$/.test(raw) ? Number(raw) : NaN;

  if (!Number.isSafeInteger(id) || id <= 0) {
    json(res, 400, { error: "Paciente inválido." });
    return null;
  }

  return id;
};
