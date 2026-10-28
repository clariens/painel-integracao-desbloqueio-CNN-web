import { json, requireMethod, requireUnidade } from "../lib/auth.js";
import { callN8n } from "../lib/n8n.js";

export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  if (!requireMethod(req, res, "GET")) return;
  const acesso = requireUnidade(req, res);
  if (!acesso) return;

  const data = await callN8n(res, "leitura", { action: "parametros", ...acesso.unidade });
  if (!data) return;

  json(res, 200, data);
}
