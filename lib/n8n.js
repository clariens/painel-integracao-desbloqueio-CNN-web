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
};

// Repassa { action, ... } ao webhook do workflow. Em caso de erro já respondeu e devolve null.
export const callN8n = async (res, workflow, payload) => {
  const { env, timeoutMs } = WORKFLOWS[workflow];
  const url = process.env[env];
  const secret = process.env.N8N_WEBHOOK_SECRET;

  if (!url) {
    json(res, 500, { error: `${env} é obrigatório.` });
    return null;
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

    // 401/403 do n8n é a chave do webhook, não o login do painel: repassar como 401 reabriria o login à toa.
    if (response.status === 401 || response.status === 403) {
      json(res, 502, {
        error: "O n8n recusou a chave do webhook. Confira se N8N_WEBHOOK_SECRET é igual ao valor da credencial Header Auth (X-Monitor-Key) no n8n.",
      });
      return null;
    }

    if (!response.ok) {
      const errorPayload = data?.response || data;
      const message = errorPayload.error || errorPayload.message || "Falha no endpoint n8n.";
      // codigo (ex.: JA_ATIVO) deixa o painel reagir a um caso específico sem depender do texto.
      const codigo = typeof errorPayload.codigo === "string" ? errorPayload.codigo : undefined;
      json(res, response.status, codigo ? { error: message, codigo } : { error: message });
      return null;
    }

    return data?.response && data.statusCode ? data.response : data;
  } catch (error) {
    console.error("n8n.proxy", workflow, error?.name || error);
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    json(res, timedOut ? 504 : 502, {
      error: timedOut
        ? "O n8n não respondeu a tempo. Confira o histórico antes de repetir a ação."
        : "Não foi possível alcançar o webhook do n8n.",
    });
    return null;
  }
};
