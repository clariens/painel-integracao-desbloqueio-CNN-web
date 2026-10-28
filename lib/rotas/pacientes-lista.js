import { json, requireMethod, requireUnidade } from "../auth.js";
import { callN8n } from "../n8n.js";


export default async function handler(req, res) {
  if (!requireMethod(req, res, "GET")) return;
  const acesso = requireUnidade(req, res);
  if (!acesso) return;

  const data = await callN8n(res, "leitura", { action: "pacientes", ...acesso.unidade });
  if (!data) return;

  json(res, 200, data);
}
