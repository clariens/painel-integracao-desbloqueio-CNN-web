// Nó "Montar resposta" (workflow CNN Painel - Solicitações). Devolve { statusCode, response }.
const meta = $('Preparar').first().json;

if (meta.action === 'error') {
  return [{ json: { statusCode: meta.statusCode || 400, response: meta.response || { error: 'Requisição inválida.' } } }];
}

const sqlItens = $('Executar').all();
const falha = erroSql(sqlItens);
if (falha) {
  return [{ json: { statusCode: 502, response: { error: `Falha no banco de solicitações: ${String(falha).slice(0, 300)}` } } }];
}

const linhas = linhasSql(sqlItens);
const iso = (valor) => {
  if (!valor) return null;
  const data = valor instanceof Date ? valor : new Date(String(valor).includes('T') || String(valor).endsWith('Z') ? valor : `${String(valor).replace(' ', 'T')}Z`);
  return Number.isNaN(data.getTime()) ? String(valor) : data.toISOString();
};
const dia = (valor) => {
  if (!valor) return null;
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor.toISOString().slice(0, 10);
  const texto = String(valor).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(texto) ? texto : null;
};
const numero = (valor) => (valor === null || valor === undefined || valor === '' ? null : Number(valor));
const responder = (statusCode, response) => [{ json: { statusCode, response } }];
const ABERTAS = ['PENDENTE', 'APROVADA'];

if (meta.action === 'listar') {
  const itens = linhas
    .filter((linha) => linha._secao === 'solicitacao')
    .map((s) => {
      const aberta = ABERTAS.includes(s.Status);
      const fimPrazo = dia(s.DataFimBloqueio);
      return {
        id: numero(s.Id),
        idPaciente: numero(s.IdPaciente),
        nomePaciente: s.NomePaciente || null,
        idAgenda: numero(s.IdAgendaReferencia),
        numeroFalta: numero(s.NumeroFalta),
        dataFalta: dia(s.DataFalta),
        dataFimBloqueio: fimPrazo,
        motivo: s.Motivo || '',
        solicitadoPor: s.SolicitadoPor || null,
        solicitadoEm: iso(s.SolicitadoEm),
        status: s.Status,
        decididoPor: s.DecididoPor || null,
        decididoEm: iso(s.DecididoEm),
        motivoDecisao: s.MotivoDecisao || null,
        liberadoPor: s.LiberadoPor || null,
        liberadoEm: iso(s.LiberadoEm),
        idAcao: numero(s.IdAcao),
        // Aberta, mas o paciente teve falta nova (aprovar/liberar vão recusar) ou o prazo já acabou.
        desatualizada: aberta && numero(s.IdAgendaAtual) !== numero(s.IdAgendaReferencia),
        prazoCumprido: aberta && Boolean(fimPrazo) && fimPrazo < meta.hoje,
        bloqueado: s.SituacaoControle === 'BLOQUEADO' && numero(s.ReferenciaControle) === numero(s.IdAgendaReferencia),
      };
    });

  const contagem = { PENDENTE: 0, APROVADA: 0, LIBERADA: 0, RECUSADA: 0, CANCELADA: 0, ENCERRADA: 0 };
  for (const linha of linhas.filter((l) => l._secao === 'contagem')) {
    contagem[linha.Status] = numero(linha.Quantidade) || 0;
  }

  return responder(200, { asOf: new Date().toISOString(), hoje: meta.hoje, contagem, itens });
}

// Escritas: criar, aprovar, recusar, cancelar.
const r = linhas.find((linha) => linha.Resultado) || {};
const STATUS_TEXTO = {
  PENDENTE: 'pendente',
  APROVADA: 'aprovada',
  LIBERADA: 'liberada',
  RECUSADA: 'recusada',
  CANCELADA: 'cancelada',
  ENCERRADA: 'encerrada',
};
const RESULTADOS = {
  OK: [200, null],
  SEM_FALTA: [404, 'Paciente sem falta no ciclo para desbloquear.'],
  PRAZO_CUMPRIDO: [409, 'O prazo desta falta já terminou: a liberação automática cuida deste paciente.'],
  JA_LIBERADO: [409, 'O paciente já foi liberado para esta falta.'],
  JA_EXISTE: [409, `Este paciente já tem uma solicitação aberta${r.Id ? ` (#${r.Id})` : ''}: acompanhe na tela Solicitações.`],
  NAO_ENCONTRADA: [404, 'Solicitação não encontrada.'],
  STATUS_INVALIDO: [409, `A solicitação já está ${STATUS_TEXTO[r.Status] || 'fechada'}.`],
  DESATUALIZADA: [409, 'O paciente teve uma falta nova depois da solicitação: ela foi encerrada. Abra uma nova para a falta atual.'],
  NAO_PERMITIDO: [403, 'Só quem abriu a solicitação (ou um administrador) pode cancelá-la.'],
};
const [statusCode, mensagem] = RESULTADOS[r.Resultado] || [502, 'O banco não confirmou a alteração.'];

if (statusCode !== 200) {
  return responder(statusCode, {
    error: mensagem,
    codigo: r.Resultado || 'SEM_RESULTADO',
    ...(r.Id !== undefined && r.Id !== null ? { id: numero(r.Id) } : {}),
  });
}

return responder(meta.action === 'criar' ? 201 : 200, {
  ok: true,
  id: numero(r.Id),
  idPaciente: numero(r.IdPaciente),
  status: r.Status || null,
});
