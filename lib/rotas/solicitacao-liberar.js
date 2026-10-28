import { json, lerCorpo, requireMethod, requireUnidade, temPerfil } from "../auth.js";
import { lerInteiro, liberarPorSolicitacao } from "../solicitacoes.js";
import { revalidarSessao } from "../usuarios.js";


// POST /api/solicitacoes/:id/liberar { idPaciente, aprovar? }
// Reativa o paciente no CNN a partir da solicitação. Editor ou Admin com solicitação APROVADA;
// aprovar: true é o "Aprovar e liberar" do admin (solicitação ainda PENDENTE).
export default async function handler(req, res) {
  if (!requireMethod(req, res, "POST")) return;
  const acesso = requireUnidade(req, res, "EDITOR");
  if (!acesso) return;
  const { sessao, unidade } = acesso;

  const idSolicitacao = lerInteiro(req.query.id);
  if (!idSolicitacao) {
    json(res, 400, { error: "Solicitação inválida." });
    return;
  }

  const body = lerCorpo(req, res);
  if (!body) return;

  const idPaciente = lerInteiro(body.idPaciente);
  if (!idPaciente) {
    json(res, 400, { error: "Paciente inválido." });
    return;
  }

  const aprovar = body.aprovar === true;
  if (aprovar && !temPerfil(sessao, "ADMIN")) {
    json(res, 403, { error: "Só o administrador aprova solicitações.", codigo: "SEM_PERMISSAO" });
    return;
  }

  if (!(await revalidarSessao(res, sessao, aprovar ? "ADMIN" : "EDITOR", unidade))) return;

  await liberarPorSolicitacao(res, { unidade, idPaciente, idSolicitacao, aprovar, usuario: sessao.login });
}
