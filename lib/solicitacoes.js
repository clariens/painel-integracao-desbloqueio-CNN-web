import { json } from "./auth.js";
import { chamarN8n, responderFalha } from "./n8n.js";

export const MOTIVO_MIN = 5;
export const MOTIVO_MAX = 500;

// Motivo normalizado (espaços colapsados). Responde 400 e devolve null se estiver fora do tamanho.
export const lerMotivo = (res, valor, { obrigatorio = true, rotulo = "o motivo" } = {}) => {
  const motivo = String(valor || "").replace(/\s+/g, " ").trim();
  if (!motivo && !obrigatorio) return "";
  if (motivo.length < MOTIVO_MIN) {
    json(res, 400, { error: `Informe ${rotulo} (mínimo ${MOTIVO_MIN} caracteres).` });
    return null;
  }
  if (motivo.length > MOTIVO_MAX) {
    json(res, 400, { error: `O motivo passa de ${MOTIVO_MAX} caracteres.` });
    return null;
  }
  return motivo;
};

export const lerInteiro = (valor) => {
  const raw = String(valor ?? "");
  const numero = /^\d{1,15}$/.test(raw) ? Number(raw) : NaN;
  return Number.isSafeInteger(numero) && numero > 0 ? numero : null;
};

/**
 * Libera o paciente pelo workflow Ações a partir de uma solicitação. O n8n confere se a solicitação é deste
 * paciente e da falta vigente, e se está APROVADA (ou PENDENTE com aprovar = "Aprovar e liberar" do admin).
 * Responde ao navegador (sucesso ou erro). extraErro vai junto na resposta de erro.
 */
export const liberarPorSolicitacao = async (res, { unidade, idPaciente, idSolicitacao, aprovar, usuario }, extraErro = {}) => {
  const resultado = await chamarN8n("acoes", {
    action: "liberar",
    ...unidade,
    id: idPaciente,
    idSolicitacao,
    aprovar: aprovar === true,
    usuario,
  });

  if (!resultado.ok) {
    if (Object.keys(extraErro).length) {
      json(res, resultado.status, { error: resultado.error, ...(resultado.codigo ? { codigo: resultado.codigo } : {}), ...extraErro });
    } else {
      responderFalha(res, resultado);
    }
    return null;
  }

  json(res, 200, { ...resultado.data, idSolicitacao });
  return resultado.data;
};
