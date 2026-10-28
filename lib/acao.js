import { json, lerCorpo, lerIdPaciente, requireMethod, requireUnidade } from "./auth.js";
import { callN8n } from "./n8n.js";
import { revalidarSessao } from "./usuarios.js";

const MOTIVO_MIN = 5;
const MOTIVO_MAX = 500;

// Liberar e bloquear seguem o mesmo roteiro; muda só a action enviada ao workflow Ações. Exigem perfil EDITOR.
// Sempre na unidade escolhida (X-Unidade): paciente de outra unidade não é encontrado.
export const handleAcao = async (req, res, action) => {
  if (!requireMethod(req, res, "POST")) return;
  const acesso = requireUnidade(req, res, "EDITOR");
  if (!acesso) return;
  const { sessao, unidade } = acesso;

  const id = lerIdPaciente(req, res);
  if (id === null) return;

  const body = lerCorpo(req, res);
  if (!body) return;

  const motivo = String(body.motivo || "").replace(/\s+/g, " ").trim();
  if (motivo.length < MOTIVO_MIN) {
    json(res, 400, { error: `Informe o motivo (mínimo ${MOTIVO_MIN} caracteres).` });
    return;
  }
  if (motivo.length > MOTIVO_MAX) {
    json(res, 400, { error: `O motivo passa de ${MOTIVO_MAX} caracteres.` });
    return;
  }

  if (!(await revalidarSessao(res, sessao, "EDITOR", unidade))) return;

  // apenasRegistrar: o usuário confirmou registrar a situação que o CNN já tem, sem PATCH.
  const data = await callN8n(res, "acoes", {
    action,
    ...unidade,
    id,
    motivo,
    usuario: sessao.login,
    apenasRegistrar: body.apenasRegistrar === true,
  });
  if (!data) return;

  json(res, 200, data);
};
