import { json, lerCorpo, lerIdPaciente, requireAuth, requireMethod, usuarioAutenticado } from "./auth.js";
import { callN8n } from "./n8n.js";

const MOTIVO_MIN = 5;
const MOTIVO_MAX = 500;

// Liberar e bloquear seguem o mesmo roteiro; muda só a action enviada ao workflow Ações.
export const handleAcao = async (req, res, action) => {
  if (!requireMethod(req, res, "POST")) return;
  if (!requireAuth(req, res)) return;

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

  // apenasRegistrar: o usuário confirmou registrar a situação que o CNN já tem, sem PATCH.
  const data = await callN8n(res, "acoes", {
    action,
    id,
    motivo,
    usuario: usuarioAutenticado(req),
    apenasRegistrar: body.apenasRegistrar === true,
  });
  if (!data) return;

  json(res, 200, data);
};
