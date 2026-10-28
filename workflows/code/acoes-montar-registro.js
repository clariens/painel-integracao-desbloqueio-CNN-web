// Nó "montar registro" (workflow CNN Painel - Ações). Depois do PATCH (ou no lugar dele, quando é só registro):
// a auditoria grava sempre (deu certo ou não); o controle só muda se o CNN aceitou.
const validar = $('Validar').first().json;
const decisao = $('decidir').first().json;

// apenasRegistrar: o CNN já estava no estado pedido e nenhum PATCH foi enviado (HttpStatus fica NULL).
const SO_REGISTRO = decisao.isencao
  ? 'Sem PATCH: falta isenta no painel antes do bloqueio (paciente ainda ativo no CNN).'
  : decisao.acao === 'LIBERACAO'
    ? 'Sem PATCH: paciente já estava ativo no CNN; liberação só registrada no painel.'
    : 'Sem PATCH: paciente já estava inativo no CNN; bloqueio só registrado no painel.';
const resposta = decisao.apenasRegistrar
  ? { ok: true, statusCode: null, erro: null, texto: SO_REGISTRO }
  : lerRespostaHttp($input.first().json);

// Liberação por solicitação: sem motivo próprio, vale o motivo de quem pediu.
const motivo = validar.motivo || (decisao.idSolicitacao
  ? `Solicitação #${decisao.idSolicitacao}${decisao.solicitadoPor ? ` (${decisao.solicitadoPor})` : ''}: ${decisao.motivoSolicitacao || ''}`.trim()
  : '');

const query = sqlRegistrarAcao({
  idUnidade: validar.idUnidade,
  idPaciente: decisao.idPaciente,
  nomePaciente: decisao.nomePaciente,
  acao: decisao.acao,
  origem: 'PAINEL',
  usuario: validar.usuario,
  motivo,
  idSolicitacao: decisao.idSolicitacao,
  aprovador: validar.aprovar ? validar.usuario : null,
  idAgenda: decisao.idAgenda,
  numeroFalta: decisao.numeroFalta,
  dataInicioBloqueio: decisao.dataInicioBloqueio,
  dataFimBloqueio: decisao.dataFimBloqueio,
  antecipada: decisao.antecipada,
  ativoAntes: decisao.ativoAntes,
  sucesso: resposta.ok,
  httpStatus: resposta.statusCode,
  respostaApi: decisao.apenasRegistrar ? SO_REGISTRO : resposta.ok ? null : resposta.erro || resposta.texto,
  idExecucao: $execution.id,
});

const verbo = decisao.acao === 'LIBERACAO' ? 'liberado' : 'bloqueado';
const resultado = resposta.ok
  ? {
      statusCode: 200,
      response: {
        ok: true,
        acao: decisao.acao,
        idPaciente: decisao.idPaciente,
        nomePaciente: decisao.nomePaciente,
        antecipada: Boolean(decisao.antecipada),
        apenasRegistrado: Boolean(decisao.apenasRegistrar),
        idSolicitacao: decisao.idSolicitacao || null,
        dataFimBloqueio: decisao.dataFimBloqueio,
        em: new Date().toISOString(),
        mensagem: decisao.isencao
          ? 'Falta isenta: o bloqueio das 01:00 não vai bloquear o paciente por ela (nada foi enviado à API).'
          : decisao.apenasRegistrar
            ? `Situação registrada: o paciente já estava ${verbo} no CNN (nada foi enviado à API).`
            : `Paciente ${verbo} no CNN.`
      }
    }
  : {
      statusCode: 502,
      response: {
        error: `A API do CNN recusou${resposta.statusCode ? ` (HTTP ${resposta.statusCode})` : ''}: ${(resposta.erro || resposta.texto || 'sem resposta').slice(0, 300)}${validar.aprovar ? ' A solicitação ficou aprovada: tente liberar de novo.' : ''}`
      }
    };

return [{ json: { query, resultado } }];
