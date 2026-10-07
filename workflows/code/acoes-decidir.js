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

const paciente = resposta.body && typeof resposta.body === 'object' ? resposta.body : {};

if (resposta.statusCode === 404) {
  return parar(404, 'Paciente não encontrado no CNN.');
}

if (!resposta.ok || paciente.id == null) {
  return parar(502, `Não foi possível consultar o paciente no CNN${resposta.statusCode ? ` (HTTP ${resposta.statusCode})` : ''}.`);
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

if (jaNoEstado && !validar.apenasRegistrar) {
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
    ativoAntes
  }
}];
