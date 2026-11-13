// Nó "montar registro" (workflow Liberar todos os bloqueados). Depois do PATCH (ou no lugar dele):
// grava a auditoria (Origem PAINEL, com o usuário e o motivo do nó "configurar") e, se deu certo,
// marca LIBERADO no controle e encerra as solicitações abertas do paciente (sqlRegistrarAcao, numa transação).
const config = $('preparar consulta').first().json;
let decisao = {};
try {
  decisao = $('decidir').itemMatching(0).json;
} catch (erro) {
  decisao = $('decidir').first().json;
}

const SO_REGISTRO = 'Sem PATCH: paciente já estava ativo no CNN; liberação em massa só registrada.';
const resposta = decisao.falhaConsulta
  ? { ok: false, statusCode: decisao.httpConsulta ?? null, erro: decisao.falhaConsulta, texto: decisao.falhaConsulta }
  : decisao.apenasRegistrar
    ? { ok: true, statusCode: null, erro: null, texto: SO_REGISTRO }
    : lerRespostaHttp($input.first().json);

const query = sqlRegistrarAcao({
  idUnidade: decisao.idUnidade,
  idPaciente: decisao.idPaciente,
  nomePaciente: decisao.nomePaciente,
  acao: 'LIBERACAO',
  origem: 'PAINEL',
  usuario: config.usuario,
  motivo: `Liberação em massa: ${config.motivo}`,
  idAgenda: decisao.idAgenda,
  numeroFalta: decisao.numeroFalta,
  dataInicioBloqueio: decisao.dataInicioBloqueio,
  dataFimBloqueio: decisao.dataFimBloqueio,
  antecipada: Boolean(decisao.dataFimBloqueio) && decisao.dataFimBloqueio >= config.hoje,
  ativoAntes: decisao.ativoAntes,
  sucesso: resposta.ok,
  httpStatus: resposta.statusCode,
  respostaApi: decisao.apenasRegistrar ? SO_REGISTRO : resposta.ok ? null : resposta.erro || resposta.texto,
  idExecucao: $execution.id,
});

return [{
  json: {
    query,
    idUnidade: decisao.idUnidade,
    idPaciente: decisao.idPaciente,
    apenasRegistrar: Boolean(decisao.apenasRegistrar),
    sucesso: resposta.ok,
    httpStatus: resposta.statusCode
  }
}];
