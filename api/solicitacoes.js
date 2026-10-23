import decidir from "../lib/rotas/solicitacao-decidir.js";
import liberar from "../lib/rotas/solicitacao-liberar.js";
import listarOuCriar from "../lib/rotas/solicitacoes-lista.js";

export const config = { runtime: "nodejs" };

// Uma função só para as rotas de solicitações (o plano Hobby da Vercel aceita até 12 funções por deploy).
// O vercel.json reescreve /api/solicitacoes/:id → ?id=:id e /api/solicitacoes/:id/liberar → ?id=:id&op=liberar.
//   GET  /api/solicitacoes             → lista          POST /api/solicitacoes → nova solicitação
//   PATCH /api/solicitacoes/:id        → aprovar, recusar, cancelar
//   POST /api/solicitacoes/:id/liberar → liberar no CNN
export default async function handler(req, res) {
  if (req.query.op === "liberar") {
    await liberar(req, res);
    return;
  }
  if (req.query.id !== undefined) {
    await decidir(req, res);
    return;
  }
  await listarOuCriar(req, res);
}
