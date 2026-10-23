import { json, lerCorpo, requireAuth, temPerfil } from "../../lib/auth.js";
import { callN8n, chamarN8n, responderFalha } from "../../lib/n8n.js";
import { lerInteiro, lerMotivo, liberarPorSolicitacao } from "../../lib/solicitacoes.js";
import { revalidarSessao } from "../../lib/usuarios.js";

export const config = { runtime: "nodejs" };

// GET /api/solicitacoes → { contagem, itens }. Todos os perfis veem.
// POST { idPaciente, motivo } → abre uma solicitação de desbloqueio (qualquer perfil).
// POST { idPaciente, motivo, aprovarELiberar: true } → atalho do admin: abre, aprova e libera no CNN.
export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    json(res, 405, { error: "Método não permitido" }, { Allow: "GET, POST" });
    return;
  }

  const sessao = requireAuth(req, res, "LEITOR");
  if (!sessao) return;

  if (req.method === "GET") {
    const data = await callN8n(res, "solicitacoes", { action: "listar" });
    if (!data) return;
    json(res, 200, data);
    return;
  }

  const body = lerCorpo(req, res);
  if (!body) return;

  const idPaciente = lerInteiro(body.idPaciente);
  if (!idPaciente) {
    json(res, 400, { error: "Paciente inválido." });
    return;
  }

  const motivo = lerMotivo(res, body.motivo);
  if (motivo === null) return;

  const aprovarELiberar = body.aprovarELiberar === true;
  if (aprovarELiberar && !temPerfil(sessao, "ADMIN")) {
    json(res, 403, { error: "Só o administrador aprova solicitações.", codigo: "SEM_PERMISSAO" });
    return;
  }

  if (!(await revalidarSessao(res, sessao, aprovarELiberar ? "ADMIN" : "LEITOR"))) return;

  const criada = await chamarN8n("solicitacoes", { action: "criar", idPaciente, motivo, usuario: sessao.login });
  if (!criada.ok) {
    responderFalha(res, criada);
    return;
  }

  if (!aprovarELiberar) {
    json(res, 201, criada.data);
    return;
  }

  // A solicitação já existe: se o CNN falhar, ela fica aprovada (o n8n grava) e dá para tentar liberar de novo.
  await liberarPorSolicitacao(
    res,
    { idPaciente, idSolicitacao: criada.data.id, aprovar: true, usuario: sessao.login },
    { idSolicitacao: criada.data.id }
  );
}
