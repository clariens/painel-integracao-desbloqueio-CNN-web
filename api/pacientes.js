import { handleAcao } from "../lib/acao.js";
import detalhar from "../lib/rotas/paciente-detalhe.js";
import listar from "../lib/rotas/pacientes-lista.js";

export const config = { runtime: "nodejs" };

// Uma função só para as rotas de pacientes (o plano Hobby da Vercel aceita até 12 funções por deploy).
// O vercel.json reescreve /api/pacientes/:id → ?id=:id e /api/pacientes/:id/liberar|bloquear → ?id=:id&op=…
//   GET  /api/pacientes              → lista
//   GET  /api/pacientes/:id          → detalhe
//   POST /api/pacientes/:id/liberar  → liberar (perfil Editor)
//   POST /api/pacientes/:id/bloquear → bloquear (perfil Editor)
export default async function handler(req, res) {
  const op = String(req.query.op || "");
  if (op === "liberar" || op === "bloquear") {
    await handleAcao(req, res, op);
    return;
  }
  if (req.query.id !== undefined) {
    await detalhar(req, res);
    return;
  }
  await listar(req, res);
}
