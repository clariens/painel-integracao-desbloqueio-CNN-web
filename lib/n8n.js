import { json } from "./auth.js";

const parsePayload = async (response) => {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
};

const WORKFLOWS = {
  leitura: { env: "N8N_LEITURA_URL", timeoutMs: 45_000 },
  acoes: { env: "N8N_ACOES_URL", timeoutMs: 55_000 },
  usuarios: { env: "N8N_USUARIOS_URL", timeoutMs: 20_000 },
  solicitacoes: { env: "N8N_SOLICITACOES_URL", timeoutMs: 20_000 },
};

/**
 * Chama o webhook do workflow com { action, ... } sem responder ao navegador.
 * Devolve { ok: true, data } ou { ok: false, status, error, codigo } para a rota decidir o que fazer.
 */
export const chamarN8n = async (workflow, payload) => {
  const { env, timeoutMs } = WORKFLOWS[workflow];
  const url = process.env[env];
  const secret = process.env.N8N_WEBHOOK_SECRET;

  if (!url) {
    return { ok: false, status: 500, error: `${env} é obrigatório.` };
  }

  try {
    const headers = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };

    if (secret) {
      headers["X-Monitor-Key"] = secret;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const data = await parsePayload(response);
    const errorPayload = data?.response || data;
    // codigo (ex.: JA_ATIVO) deixa o painel reagir a um caso específico sem depender do texto.
    const codigo = typeof errorPayload?.codigo === "string" ? errorPayload.codigo : undefined;

    // 401/403 sem codigo é a chave do webhook (Header Auth), não o login do painel: repassar como 401 reabriria
    // o login à toa. Um 403 com codigo é regra do próprio workflow (ex.: NAO_PERMITIDO) e segue como 403.
    if ((response.status === 401 || response.status === 403) && !codigo) {
      return {
        ok: false,
        status: 502,
        error: "O n8n recusou a chave do webhook. Confira se N8N_WEBHOOK_SECRET é igual ao valor da credencial Header Auth (X-Monitor-Key) no n8n.",
      };
    }

    if (!response.ok) {
      return { ok: false, status: response.status, error: errorPayload.error || errorPayload.message || "Falha no endpoint n8n.", codigo };
    }

    return { ok: true, data: data?.response && data.statusCode ? data.response : data };
  } catch (error) {
    console.error("n8n.proxy", workflow, error?.name || error);
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    return {
      ok: false,
      status: timedOut ? 504 : 502,
      error: timedOut
        ? "O n8n não respondeu a tempo. Confira o histórico antes de repetir a ação."
        : "Não foi possível alcançar o webhook do n8n.",
    };
  }
};

export const responderFalha = (res, falha) => {
  json(res, falha.status, falha.codigo ? { error: falha.error, codigo: falha.codigo } : { error: falha.error });
};

// Repassa { action, ... } ao webhook do workflow. Em caso de erro já respondeu e devolve null.
export const callN8n = async (res, workflow, payload) => {
  const resultado = await chamarN8n(workflow, payload);
  if (!resultado.ok) {
    responderFalha(res, resultado);
    return null;
  }
  return resultado.data;
};
