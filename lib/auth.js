import crypto from "node:crypto";

// Sem WWW-Authenticate de propósito: com ele o navegador abre a caixa nativa de login por cima do diálogo do painel.
const unauthorizedHeaders = {
  "Cache-Control": "no-store",
};

export const LOGIN_PATTERN = /^[A-Za-z0-9._-]{2,50}$/;
export const SCRYPT_KEYLEN = 64;
export const SENHA_MIN = 6;
export const PERFIS = { LEITOR: 1, EDITOR: 2, ADMIN: 3 };
const SESSAO_MS = 8 * 60 * 60 * 1000;

export const json = (res, status, payload, extraHeaders = {}) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  Object.entries(extraHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  res.end(JSON.stringify(payload));
};

// ---------- senhas (scrypt; o banco guarda só salt e hash em hex) ----------
export const hashPassword = (password, salt) =>
  crypto.scryptSync(String(password), Buffer.from(salt, "hex"), SCRYPT_KEYLEN).toString("hex");

export const gerarHash = (senha) => {
  const salt = crypto.randomBytes(16).toString("hex");
  return { salt, hash: hashPassword(senha, salt) };
};

// Login inexistente também calcula um hash: a resposta demora o mesmo e não denuncia quais logins existem.
const SALT_FICTICIO = "00000000000000000000000000000000";
export const conferirSenha = (senha, salt, hash) => {
  const valido = /^[0-9a-f]{32}$/i.test(salt || "") && /^[0-9a-f]{128}$/i.test(hash || "");
  const calculado = Buffer.from(hashPassword(senha, valido ? salt : SALT_FICTICIO), "hex");
  if (!valido) return false;
  const esperado = Buffer.from(hash, "hex");
  return esperado.length === calculado.length && crypto.timingSafeEqual(esperado, calculado);
};

// Regra da senha escolhida pela pessoa: 6 a 200 caracteres, com pelo menos um número e um caractere especial.
// Devolve a mensagem de erro, ou null se a senha serve. js/pagina.js repete a mesma regra para avisar antes de enviar.
export const validarSenha = (senha) => {
  const texto = String(senha || "");
  if (texto.length < SENHA_MIN || texto.length > 200) return `A nova senha precisa ter de ${SENHA_MIN} a 200 caracteres.`;
  if (!/\d/.test(texto)) return "A nova senha precisa ter pelo menos um número.";
  if (!/[^\p{L}\p{N}\s]/u.test(texto)) return "A nova senha precisa ter pelo menos um caractere especial (ex.: ! @ # $ % * -).";
  return null;
};

// 16 caracteres aleatórios (base64url), para senha temporária.
export const senhaTemporaria = () => crypto.randomBytes(12).toString("base64url");

// ---------- sessão: token assinado com SESSION_SECRET (HMAC-SHA256), enviado como Authorization: Bearer ----------
const segredo = () => process.env.SESSION_SECRET || "";
const assinar = (dados) => crypto.createHmac("sha256", segredo()).update(dados).digest("base64url");

export const assinarSessao = ({ login, nome, perfil, versaoSessao, trocarSenha }) => {
  const payload = Buffer.from(
    JSON.stringify({ login, nome, perfil, ver: versaoSessao, trocarSenha: Boolean(trocarSenha), exp: Date.now() + SESSAO_MS }),
  ).toString("base64url");
  return `${payload}.${assinar(payload)}`;
};

export const lerSessao = (req) => {
  const header = req.headers.authorization || "";
  if (!segredo() || !header.startsWith("Bearer ")) {
    return null;
  }

  const [payload, assinatura] = header.slice(7).trim().split(".");
  if (!payload || !assinatura) {
    return null;
  }

  const esperada = Buffer.from(assinar(payload));
  const recebida = Buffer.from(assinatura);
  if (esperada.length !== recebida.length || !crypto.timingSafeEqual(esperada, recebida)) {
    return null;
  }

  try {
    const sessao = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const valida =
      sessao && LOGIN_PATTERN.test(String(sessao.login)) && PERFIS[sessao.perfil] && Number.isFinite(sessao.exp) && sessao.exp > Date.now();
    return valida ? sessao : null;
  } catch {
    return null;
  }
};

export const usuarioAutenticado = (req) => lerSessao(req)?.login || null;

export const temPerfil = (sessao, perfilMinimo) => (PERFIS[sessao?.perfil] || 0) >= PERFIS[perfilMinimo];

/**
 * Devolve a sessão, ou responde 401/403 e devolve null.
 * perfilMinimo: LEITOR (ver), EDITOR (liberar/bloquear), ADMIN (usuários).
 * Com senha temporária (trocarSenha), só a rota de troca de senha passa (permitirTrocaSenha).
 */
export const requireAuth = (req, res, perfilMinimo = "LEITOR", { permitirTrocaSenha = false } = {}) => {
  if (!segredo()) {
    json(res, 500, { error: "SESSION_SECRET é obrigatório." });
    return null;
  }

  const sessao = lerSessao(req);
  if (!sessao) {
    json(res, 401, { error: "Não autorizado" }, unauthorizedHeaders);
    return null;
  }

  if (sessao.trocarSenha && !permitirTrocaSenha) {
    json(res, 403, { error: "Defina uma nova senha para continuar.", codigo: "TROCAR_SENHA" });
    return null;
  }

  if (!temPerfil(sessao, perfilMinimo)) {
    json(res, 403, { error: "Seu perfil não permite esta ação.", codigo: "SEM_PERMISSAO" });
    return null;
  }

  return sessao;
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
