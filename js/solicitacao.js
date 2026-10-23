// Chamadas de solicitação de desbloqueio, usadas pelas telas Pacientes e Solicitações.
// Quem decide a permissão é a API: criar (todos), aprovar e recusar (admin), liberar (editor e admin).
import { atualizarContador } from "./pagina.js";
import { clearCache, clearCaches, request } from "./session.js";

const post = (path, corpo, method = "POST") => request(path, { method, body: JSON.stringify(corpo) });

// Abre uma solicitação. aprovarELiberar: atalho do admin (abre, aprova e libera no CNN de uma vez).
export const criarSolicitacao = (idPaciente, motivo, { aprovarELiberar = false } = {}) =>
  post("/api/solicitacoes", aprovarELiberar ? { idPaciente, motivo, aprovarELiberar: true } : { idPaciente, motivo });

// Aprovar, recusar (motivo obrigatório) ou cancelar (motivo opcional).
export const decidirSolicitacao = (id, acao, motivo = "") => post(`/api/solicitacoes/${id}`, { acao, motivo }, "PATCH");

// Reativa no CNN a partir da solicitação. aprovar: "Aprovar e liberar" do admin (solicitação ainda pendente).
export const liberarSolicitacao = (id, idPaciente, { aprovar = false } = {}) =>
  post(`/api/solicitacoes/${id}/liberar`, aprovar ? { idPaciente, aprovar: true } : { idPaciente });

// Depois de mexer numa solicitação: a lista dela, o paciente e (se liberou) histórico e relatórios ficaram velhos.
export const limparDepoisDeSolicitacao = (idPaciente, { liberou = false } = {}) => {
  clearCache("solicitacoes");
  clearCache("pacientes");
  if (idPaciente) clearCache(`paciente:${idPaciente}`);
  if (liberou) clearCaches("acoes:", "faltas:");
  atualizarContador();
};
