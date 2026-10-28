import { json, requireMethod, requireUnidade } from "../lib/auth.js";
import { callN8n } from "../lib/n8n.js";

export const config = { runtime: "nodejs" };

const safeDate = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value) : "");
const pick = (value, allowed) => (allowed.includes(String(value || "")) ? String(value) : "");

export default async function handler(req, res) {
  if (!requireMethod(req, res, "GET")) return;
  const acesso = requireUnidade(req, res);
  if (!acesso) return;

  const page = Number.parseInt(String(req.query.page || "1"), 10);
  const paciente = String(req.query.paciente || "");

  const data = await callN8n(res, "leitura", {
    action: "acoes",
    ...acesso.unidade,
    de: safeDate(req.query.de),
    ate: safeDate(req.query.ate),
    acao: pick(req.query.acao, ["BLOQUEIO", "LIBERACAO"]),
    origem: pick(req.query.origem, ["AUTOMATICO", "PAINEL", "CARGA_INICIAL"]),
    resultado: pick(req.query.resultado, ["ok", "falha"]),
    usuario: String(req.query.usuario || "").slice(0, 100),
    paciente: /^\d{1,15}$/.test(paciente) ? Number(paciente) : null,
    page: Number.isFinite(page) && page > 0 ? page : 1,
  });
  if (!data) return;

  json(res, 200, data);
}
