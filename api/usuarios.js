import alterar from "../lib/rotas/usuario-alterar.js";
import listarOuCriar from "../lib/rotas/usuarios-lista.js";

export const config = { runtime: "nodejs" };

// Uma função só para as rotas de usuários (o plano Hobby da Vercel aceita até 12 funções por deploy).
// O vercel.json reescreve /api/usuarios/:login → ?login=:login.
//   GET/POST /api/usuarios → lista e cria     PATCH /api/usuarios/:login → altera
export default async function handler(req, res) {
  if (req.query.login !== undefined) {
    await alterar(req, res);
    return;
  }
  await listarOuCriar(req, res);
}
