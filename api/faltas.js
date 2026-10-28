import { json, requireMethod, requireUnidade } from "../lib/auth.js";
import { callN8n } from "../lib/n8n.js";

export const config = { runtime: "nodejs" };

const safeDate = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value) : "");

export default async function handler(req, res) {
  if (!requireMethod(req, res, "GET")) return;
  const acesso = requireUnidade(req, res);
  if (!acesso) return;

  const de = safeDate(req.query.de);
  const ate = safeDate(req.query.ate);
  if (de && ate && de > ate) {
    json(res, 400, { error: "A data inicial é depois da final." });
    return;
  }

  const data = await callN8n(res, "leitura", { action: "faltas", ...acesso.unidade, de, ate });
  if (!data) return;

  json(res, 200, data);
}
