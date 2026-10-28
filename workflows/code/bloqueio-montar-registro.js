// Nó "montar registro" (bloqueio às 01:00). Roda para cada paciente do laço, depois do PATCH
// (ou no lugar dele, quando o paciente já estava inativo no CNN e só falta registrar):
// grava o resultado na auditoria (Origem AUTOMATICO) e, se deu certo, marca BLOQUEADO na tabela de controle.
let alvo = {};
try {
  alvo = $('loop bloqueios').itemMatching(0).json;
} catch (erro) {
  alvo = $('loop bloqueios').first().json;
}

const SO_REGISTRO = 'Sem PATCH: paciente já estava inativo no CNN; bloqueio só registrado pela automação.';
const resposta = alvo.apenasRegistrar
  ? { ok: true, statusCode: null, erro: null, texto: SO_REGISTRO }
  : lerRespostaHttp($input.first().json);

const query = sqlRegistrarAcao({
  idUnidade: unidadeAtual().idUnidade,
  idPaciente: alvo.idPaciente,
  nomePaciente: alvo.nomePaciente,
  acao: 'BLOQUEIO',
  origem: 'AUTOMATICO',
  usuario: 'n8n',
  motivo: `Falta ${alvo.numeroFalta} no ciclo: bloqueio de ${alvo.diasBloqueio} dias.`,
  idAgenda: alvo.idAgenda,
  numeroFalta: alvo.numeroFalta,
  dataInicioBloqueio: alvo.dataInicioBloqueio,
  dataFimBloqueio: alvo.dataFimBloqueio,
  antecipada: false,
  ativoAntes: typeof alvo.ativoAntes === 'boolean' ? alvo.ativoAntes : null,
  sucesso: resposta.ok,
  httpStatus: resposta.statusCode,
  respostaApi: alvo.apenasRegistrar ? SO_REGISTRO : resposta.ok ? null : resposta.erro || resposta.texto,
  idExecucao: $execution.id,
});

return [{
  json: {
    query,
    idPaciente: alvo.idPaciente,
    apenasRegistrar: Boolean(alvo.apenasRegistrar),
    sucesso: resposta.ok,
    httpStatus: resposta.statusCode
  }
}];
