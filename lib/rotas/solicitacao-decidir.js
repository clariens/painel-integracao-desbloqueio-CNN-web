import { json, lerCorpo, requireMethod, requireUnidade, temPerfil } from "../auth.js";
import { callN8n } from "../n8n.js";
import { lerInteiro, lerMotivo } from "../solicitacoes.js";
import { revalidarSessao } from "../usuarios.js";


// PATCH /api/solicitacoes/:id { acao, motivo? }
//   aprovar: só ADMIN (só aprova; quem libera é Editor/Admin, em /api/solicitacoes/:id/liberar);
//   recusar: só ADMIN, motivo obrigatório;
//   cancelar: quem abriu a solicitação (ou ADMIN), motivo opcional.
export default async function handler(req, res) {
  if (!requireMethod(req, res, "PATCH")) return;
  const acesso = requireUnidade(req, res, "LEITOR");
  if (!acesso) return;
  const { sessao, unidade } = acesso;

  const id = lerInteiro(req.query.id);
  if (!id) {
    json(res, 400, { error: "Solicitação inválida." });
    return;
  }

  const body = lerCorpo(req, res);
  if (!body) return;

  const acao = String(body.acao || "");
  if (!["aprovar", "recusar", "cancelar"].includes(acao)) {
    json(res, 400, { error: "Ação inválida: use aprovar, recusar ou cancelar." });
    return;
  }

  const soAdmin = acao === "aprovar" || acao === "recusar";
  if (soAdmin && !temPerfil(sessao, "ADMIN")) {
    json(res, 403, { error: "Só o administrador aprova ou recusa solicitações.", codigo: "SEM_PERMISSAO" });
    return;
  }

  let motivo = "";
  if (acao === "recusar") {
    motivo = lerMotivo(res, body.motivo, { rotulo: "o motivo da recusa" });
    if (motivo === null) return;
  } else if (acao === "cancelar") {
    motivo = lerMotivo(res, body.motivo, { obrigatorio: false });
    if (motivo === null) return;
  }

  if (!(await revalidarSessao(res, sessao, soAdmin ? "ADMIN" : "LEITOR", unidade))) return;

  const data = await callN8n(res, "solicitacoes", {
    action: acao,
    ...unidade,
    id,
    motivo,
    usuario: sessao.login,
    admin: temPerfil(sessao, "ADMIN"),
  });
  if (!data) return;

  json(res, 200, data);
}
