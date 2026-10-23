// Nó "montar registro" (liberação automática às 02:00). Depois do PATCH (ou no lugar dele):
// grava a auditoria (Origem AUTOMATICO) e, se deu certo, marca LIBERADO no controle e encerra as
// solicitações de desbloqueio abertas do paciente (sqlRegistrarAcao faz tudo numa transação).
let decisao = {};
try {
  decisao = $('decidir').itemMatching(0).json;
} catch (erro) {
  decisao = $('decidir').first().json;
}

const SO_REGISTRO = 'Sem PATCH: paciente já estava ativo no CNN; liberação só registrada pela automação.';
const resposta = decisao.falhaConsulta
  ? { ok: false, statusCode: decisao.httpConsulta ?? null, erro: decisao.falhaConsulta, texto: decisao.falhaConsulta }
  : decisao.apenasRegistrar
    ? { ok: true, statusCode: null, erro: null, texto: SO_REGISTRO }
    : lerRespostaHttp($input.first().json);

const query = sqlRegistrarAcao({
  idPaciente: decisao.idPaciente,
  nomePaciente: decisao.nomePaciente,
  acao: 'LIBERACAO',
  origem: 'AUTOMATICO',
  usuario: 'n8n',
  motivo: `Prazo de ${decisao.diasBloqueio} dias da falta ${decisao.numeroFalta} cumprido (falta de ${decisao.dataInicioBloqueio}).`,
  idAgenda: decisao.idAgenda,
  numeroFalta: decisao.numeroFalta,
  dataInicioBloqueio: decisao.dataInicioBloqueio,
  dataFimBloqueio: decisao.dataFimBloqueio,
  antecipada: false,
  ativoAntes: decisao.ativoAntes,
  sucesso: resposta.ok,
  httpStatus: resposta.statusCode,
  respostaApi: decisao.apenasRegistrar ? SO_REGISTRO : resposta.ok ? null : resposta.erro || resposta.texto,
  idExecucao: $execution.id,
});

return [{
  json: {
    query,
    idPaciente: decisao.idPaciente,
    apenasRegistrar: Boolean(decisao.apenasRegistrar),
    sucesso: resposta.ok,
    httpStatus: resposta.statusCode
  }
}];
