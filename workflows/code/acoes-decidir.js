// Nó "decidir" (workflow CNN Painel - Ações). Confere banco e CNN antes de qualquer PATCH.
// seguir: false -> responde direto (404/409/502) sem chamar a API de status.
const validar = $('Validar').first().json;
const situacaoSql = $('situação do paciente').all();
const linha = linhasSql(situacaoSql)[0] || null;
const resposta = lerRespostaHttp($input.first().json);

const parar = (statusCode, error) => [{
  json: { seguir: false, statusCode, response: { error } }
}];

if (!linha) {
  const detalhe = erroSql(situacaoSql);
  return parar(502, detalhe ? `Falha ao consultar o banco: ${detalhe}` : 'Falha ao consultar o banco.');
}

if (!linha.IdAgenda) {
  return parar(404, 'Paciente sem falta registrada na tabela de controle.');
}

// O prazo 60/90/180 só decide a liberação ("antecipada" = liberar antes dele). Bloquear vale para
// qualquer falta no período analisado (ciclo), com o prazo correndo ou não.
const hoje = validar.hoje;
const numeroFalta = Number(linha.NumeroFalta) || 1;
const diasBloqueio = diasPorFalta(numeroFalta);
const dataInicio = dataIso(linha.DataFalta);
const dataFim = somarDias(dataInicio, diasBloqueio);
const prazoVigente = Boolean(dataFim) && dataFim >= hoje;
const vigenteNoCiclo = linha.VigenteNoCiclo === true || linha.VigenteNoCiclo === 1;

if (validar.action === 'bloquear' && !vigenteNoCiclo) {
  return parar(404, 'Paciente sem falta no ciclo atual. O bloqueio só vale para falta registrada no ciclo.');
}

const parar409 = (codigo, error) => [{ json: { seguir: false, statusCode: 409, response: { error, codigo } } }];

// Quem já cumpriu o prazo da falta vigente não é bloqueado (mesma regra do bloqueio das 01:00).
if (validar.action === 'bloquear' && !prazoVigente) {
  return parar409('PRAZO_CUMPRIDO', 'O prazo desta falta já terminou: quem cumpriu o prazo não é bloqueado.');
}

const paciente = resposta.body && typeof resposta.body === 'object' ? resposta.body : {};

if (resposta.statusCode === 404) {
  return parar(404, 'Paciente não encontrado no CNN.');
}

if (!resposta.ok || paciente.id == null) {
  return parar(502, `Não foi possível consultar o paciente no CNN${resposta.statusCode ? ` (HTTP ${resposta.statusCode})` : ''}.`);
}

// Liberar antes do fim do prazo (liberação antecipada ou isenção de falta ainda não bloqueada) só com uma
// solicitação de desbloqueio deste paciente e desta falta: APROVADA, ou PENDENTE com "Aprovar e liberar".
// Depois do prazo (Apto), a liberação segue sem solicitação.
const comSolicitacao = Boolean(validar.idSolicitacao);
if (validar.action === 'liberar' && prazoVigente && !comSolicitacao) {
  return parar409(
    'SOLICITACAO_NECESSARIA',
    'Liberar antes do fim do prazo exige uma solicitação de desbloqueio aprovada pelo administrador.'
  );
}

if (comSolicitacao) {
  if (!linha.SolicitacaoId) {
    return parar(404, 'Solicitação não encontrada.');
  }
  if (String(linha.SolicitacaoIdPaciente) !== String(validar.id)) {
    return parar409('SOLICITACAO_INVALIDA', 'A solicitação é de outro paciente.');
  }
  if (String(linha.SolicitacaoIdAgenda ?? '') !== String(linha.IdAgenda ?? '')) {
    return parar409(
      'SOLICITACAO_DESATUALIZADA',
      'O paciente teve uma falta nova depois da solicitação. Abra uma nova solicitação para a falta atual.'
    );
  }
  const statusOk = linha.SolicitacaoStatus === 'APROVADA' || (linha.SolicitacaoStatus === 'PENDENTE' && validar.aprovar);
  if (!statusOk) {
    const textos = {
      PENDENTE: 'A solicitação ainda não foi aprovada pelo administrador.',
      LIBERADA: 'Esta solicitação já foi usada para liberar o paciente.',
      RECUSADA: 'A solicitação foi recusada.',
      CANCELADA: 'A solicitação foi cancelada.',
      ENCERRADA: 'A solicitação foi encerrada.'
    };
    return parar409('SOLICITACAO_INVALIDA', textos[linha.SolicitacaoStatus] || 'Solicitação inválida.');
  }
}

const ativoAntes = typeof paciente.ativo === 'boolean' ? paciente.ativo : null;

// CNN já no estado pedido (alguém mudou direto na plataforma, ou o banco ficou para trás).
// Primeira vez: 409 com codigo, e o painel pergunta se registra. Com apenasRegistrar: segue sem PATCH,
// e o controle passa a refletir o CNN (no liberar, o bloqueio das 01:00 deixa de considerar esta falta).
const jaNoEstado =
  (validar.action === 'liberar' && ativoAntes === true) ||
  (validar.action === 'bloquear' && ativoAntes === false);

// Ativo no CNN sem bloqueio registrado para a falta vigente do ciclo: ninguém liberou,
// o paciente só ainda não foi bloqueado. Registrar aqui é isentar a falta, não "registrar a liberação".
const bloqueioRegistrado =
  linha.Situacao === 'BLOQUEADO' && String(linha.IdAgendaReferencia ?? '') === String(linha.IdAgenda ?? '');
const aindaNaoBloqueado = validar.action === 'liberar' && !bloqueioRegistrado && vigenteNoCiclo;

// Com solicitação válida, o CNN já ativo não é dúvida: é isenção (ainda não bloqueado) ou liberação só registrada.
if (jaNoEstado && !validar.apenasRegistrar && !comSolicitacao) {
  const liberar = validar.action === 'liberar';
  const naoBloqueado = aindaNaoBloqueado;
  return [{
    json: {
      seguir: false,
      statusCode: 409,
      response: {
        error: !liberar
          ? 'Paciente já está bloqueado (inativo) no CNN.'
          : naoBloqueado
            ? 'Paciente ainda não foi bloqueado: está ativo no CNN e não há bloqueio registrado para esta falta.'
            : 'Paciente já está ativo no CNN.',
        codigo: !liberar ? 'JA_BLOQUEADO' : naoBloqueado ? 'NAO_BLOQUEADO' : 'JA_ATIVO'
      }
    }
  }];
}

return [{
  json: {
    seguir: true,
    apenasRegistrar: jaNoEstado,
    // Liberar sem bloqueio registrado (paciente ainda ativo) = isentar a falta antes do bloqueio.
    isencao: jaNoEstado && aindaNaoBloqueado,
    acao: validar.action === 'liberar' ? 'LIBERACAO' : 'BLOQUEIO',
    ativoDestino: validar.action === 'liberar',
    idPaciente: validar.id,
    nomePaciente: paciente.nome || linha.NomePaciente || null,
    idAgenda: linha.IdAgenda,
    numeroFalta,
    diasBloqueio,
    dataInicioBloqueio: dataInicio,
    dataFimBloqueio: dataFim,
    antecipada: validar.action === 'liberar' && prazoVigente,
    ativoAntes,
    idSolicitacao: comSolicitacao ? validar.idSolicitacao : null,
    motivoSolicitacao: comSolicitacao ? linha.SolicitacaoMotivo || null : null,
    solicitadoPor: comSolicitacao ? linha.SolicitacaoPor || null : null
  }
}];
