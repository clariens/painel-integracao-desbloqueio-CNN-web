// ===== Helpers de SQL (fonte única: workflows/code/_sql.js) =====
// O SQL é montado por texto: todo valor passa por uma destas funções.
const sqlN = (valor) => {
  if (valor === null || valor === undefined || valor === '') {
    return 'NULL';
  }

  const numero = Number(valor);
  return Number.isFinite(numero) ? String(Math.trunc(numero)) : 'NULL';
};

const sqlS = (valor, maxLength) => {
  if (valor === null || valor === undefined || valor === '') {
    return 'NULL';
  }

  const texto = String(valor).slice(0, maxLength ?? 4000).replace(/'/g, "''");
  return `N'${texto}'`;
};

const sqlDate = (valor) => {
  if (!valor) {
    return 'NULL';
  }

  const data = String(valor).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return 'NULL';
  }

  return `CONVERT(date, '${data}', 23)`;
};

const sqlTime = (valor) => {
  if (!valor) {
    return 'NULL';
  }

  let hora = String(valor).trim();
  if (/^\d{2}:\d{2}$/.test(hora)) {
    hora = `${hora}:00`;
  }

  if (!/^\d{2}:\d{2}:\d{2}$/.test(hora)) {
    return 'NULL';
  }

  return `CONVERT(time(0), '${hora}')`;
};

const sqlBit = (valor) => {
  if (valor === null || valor === undefined) {
    return 'NULL';
  }

  return valor ? '1' : '0';
};

// Linhas devolvidas por um nó Microsoft SQL, em qualquer dos formatos que o n8n já usou.
const linhasSql = (itens) => {
  const linhas = [];

  for (const item of itens) {
    const payload = item?.json ?? {};

    if (Array.isArray(payload.recordset)) {
      linhas.push(...payload.recordset);
    } else if (Array.isArray(payload.recordsets?.[0])) {
      linhas.push(...payload.recordsets[0]);
    } else if (Object.keys(payload).length > 0 && payload.error === undefined) {
      linhas.push(payload);
    }
  }

  return linhas;
};

const erroSql = (itens) => {
  const comErro = itens.find((item) => item?.json?.error !== undefined);
  if (!comErro) {
    return null;
  }

  const erro = comErro.json.error;
  return typeof erro === 'string' ? erro : erro?.message || 'Falha no SQL Server.';
};

// Resposta de um nó HTTP com "Full Response" e "Never Error": { statusCode, body }.
// Com erro de rede e onError = continueRegularOutput, chega { error: {...} }.
const lerRespostaHttp = (json) => {
  const resposta = json ?? {};
  const erro = resposta.error;
  const statusCode = Number(resposta.statusCode ?? erro?.httpCode ?? erro?.status ?? erro?.cause?.status) || null;
  const body = resposta.body !== undefined ? resposta.body : erro ? null : resposta;
  const ok = !erro && statusCode !== null && statusCode >= 200 && statusCode < 300;
  const texto = typeof body === 'string' ? body : body ? JSON.stringify(body) : erro?.message || String(erro ?? '');
  return { ok, statusCode, body, erro: erro ? erro.message || String(erro) : null, texto: texto.slice(0, 1000) };
};

// Grava uma ação na auditoria e, se deu certo, atualiza a tabela de controle. Devolve o SQL completo.
const sqlRegistrarAcao = (acao) => {
  const situacao = acao.acao === 'LIBERACAO' ? 'LIBERADO' : 'BLOQUEADO';
  const merge = acao.sucesso
    ? `
MERGE dbo.CtlCnnControlePaciente WITH (HOLDLOCK) AS destino
USING (SELECT ${sqlN(acao.idPaciente)} AS IdPaciente) AS origem
    ON destino.IdPaciente = origem.IdPaciente
WHEN MATCHED THEN
    UPDATE SET
        NomePaciente = COALESCE(${sqlS(acao.nomePaciente, 200)}, destino.NomePaciente),
        Situacao = ${sqlS(situacao, 20)},
        IdAgendaReferencia = ${sqlN(acao.idAgenda)},
        NumeroFalta = ${sqlN(acao.numeroFalta)},
        DataInicioBloqueio = ${sqlDate(acao.dataInicioBloqueio)},
        DataFimBloqueio = ${sqlDate(acao.dataFimBloqueio)},
        UltimaAcao = ${sqlS(acao.acao, 20)},
        OrigemUltimaAcao = ${sqlS(acao.origem, 20)},
        UltimaAcaoPor = ${sqlS(acao.usuario, 100)},
        MotivoUltimaAcao = ${sqlS(acao.motivo, 500)},
        IdUltimaAcao = @IdAcao,
        UltimaAcaoEm = SYSUTCDATETIME()
WHEN NOT MATCHED THEN
    INSERT (
        IdPaciente, NomePaciente, Situacao, IdAgendaReferencia, NumeroFalta,
        DataInicioBloqueio, DataFimBloqueio, UltimaAcao, OrigemUltimaAcao,
        UltimaAcaoPor, MotivoUltimaAcao, IdUltimaAcao
    )
    VALUES (
        ${sqlN(acao.idPaciente)}, ${sqlS(acao.nomePaciente, 200)}, ${sqlS(situacao, 20)}, ${sqlN(acao.idAgenda)}, ${sqlN(acao.numeroFalta)},
        ${sqlDate(acao.dataInicioBloqueio)}, ${sqlDate(acao.dataFimBloqueio)}, ${sqlS(acao.acao, 20)}, ${sqlS(acao.origem, 20)},
        ${sqlS(acao.usuario, 100)}, ${sqlS(acao.motivo, 500)}, @IdAcao
    );`
    : '';

  // Solicitações de desbloqueio (dbo.CtlCnnSolicitacao), na mesma transação da auditoria.
  const idSolicitacao = sqlN(acao.idSolicitacao);
  const temSolicitacao = idSolicitacao !== 'NULL';
  const liberou = acao.sucesso && acao.acao === 'LIBERACAO';
  const solicitacoes = [];

  if (temSolicitacao && liberou) {
    // A solicitação usada nesta liberação fica LIBERADA (com "Aprovar e liberar", a decisão vai junto).
    solicitacoes.push(`
UPDATE dbo.CtlCnnSolicitacao
SET Status = N'LIBERADA',
    LiberadoPor = ${sqlS(acao.usuario, 100)},
    LiberadoEm = SYSUTCDATETIME(),
    IdAcao = @IdAcao,
    DecididoPor = COALESCE(DecididoPor, ${sqlS(acao.aprovador, 100)}),
    DecididoEm = COALESCE(DecididoEm, CASE WHEN ${sqlS(acao.aprovador, 100)} IS NULL THEN NULL ELSE SYSUTCDATETIME() END),
    AtualizadoEm = SYSUTCDATETIME()
WHERE Id = ${idSolicitacao}
  AND Status IN (N'PENDENTE', N'APROVADA');`);
  } else if (temSolicitacao && acao.aprovador) {
    // "Aprovar e liberar" com o CNN fora do ar: a aprovação vale; a liberação pode ser tentada de novo.
    solicitacoes.push(`
UPDATE dbo.CtlCnnSolicitacao
SET Status = N'APROVADA',
    DecididoPor = ${sqlS(acao.aprovador, 100)},
    DecididoEm = SYSUTCDATETIME(),
    AtualizadoEm = SYSUTCDATETIME()
WHERE Id = ${idSolicitacao}
  AND Status = N'PENDENTE';`);
  }

  if (liberou) {
    // Liberado por outro caminho (prazo cumprido): as outras solicitações abertas perdem o sentido.
    const motivoEncerramento = acao.origem === 'AUTOMATICO'
      ? 'Prazo cumprido: paciente liberado pela rotina automática.'
      : `Paciente liberado por ${acao.usuario || 'outro usuário'}.`;
    solicitacoes.push(`
UPDATE dbo.CtlCnnSolicitacao
SET Status = N'ENCERRADA',
    MotivoDecisao = ${sqlS(motivoEncerramento, 500)},
    DecididoEm = SYSUTCDATETIME(),
    AtualizadoEm = SYSUTCDATETIME()
WHERE IdPaciente = ${sqlN(acao.idPaciente)}
  AND Status IN (N'PENDENTE', N'APROVADA')${temSolicitacao ? `\n  AND Id <> ${idSolicitacao}` : ''};`);
  }

  if (acao.sucesso && acao.acao === 'BLOQUEIO') {
    // Bloqueio por uma falta nova: a solicitação feita para a falta anterior não vale mais.
    solicitacoes.push(`
UPDATE dbo.CtlCnnSolicitacao
SET Status = N'ENCERRADA',
    MotivoDecisao = N'Nova falta registrada: a solicitação era da falta anterior.',
    DecididoEm = SYSUTCDATETIME(),
    AtualizadoEm = SYSUTCDATETIME()
WHERE IdPaciente = ${sqlN(acao.idPaciente)}
  AND Status IN (N'PENDENTE', N'APROVADA')
  AND IdAgendaReferencia <> ${sqlN(acao.idAgenda)};`);
  }

  return `USE INTEGRACAO;
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;

INSERT INTO dbo.CtlCnnAcaoPaciente (
    IdPaciente, NomePaciente, Acao, Origem, Usuario, Motivo,
    IdAgendaReferencia, NumeroFalta, DataInicioBloqueio, DataFimBloqueio,
    Antecipada, AtivoAntes, Sucesso, HttpStatus, RespostaApi, IdExecucaoN8n, IdSolicitacao
)
VALUES (
    ${sqlN(acao.idPaciente)}, ${sqlS(acao.nomePaciente, 200)}, ${sqlS(acao.acao, 20)}, ${sqlS(acao.origem, 20)}, ${sqlS(acao.usuario || 'desconhecido', 100)}, ${sqlS(acao.motivo, 500)},
    ${sqlN(acao.idAgenda)}, ${sqlN(acao.numeroFalta)}, ${sqlDate(acao.dataInicioBloqueio)}, ${sqlDate(acao.dataFimBloqueio)},
    ${sqlBit(Boolean(acao.antecipada))}, ${sqlBit(acao.ativoAntes)}, ${sqlBit(Boolean(acao.sucesso))}, ${sqlN(acao.httpStatus)}, ${sqlS(acao.respostaApi, 1000)}, ${sqlS(acao.idExecucao, 50)}, ${idSolicitacao}
);

DECLARE @IdAcao BIGINT = CONVERT(BIGINT, SCOPE_IDENTITY());
${merge}
${solicitacoes.join('\n')}

COMMIT TRANSACTION;

SELECT @IdAcao AS IdAcao, CAST(${sqlBit(Boolean(acao.sucesso))} AS bit) AS Sucesso;`;
};
// Junta os itens de um nó HTTP paginado da API do CNN: cada página chega como { lista: [...] }.
// Página com erro (onError = continueRegularOutput) é ignorada.
const listaDaApi = (itens) => {
  const lista = [];

  for (const item of itens || []) {
    const pagina = item?.json ?? {};
    if (Array.isArray(pagina.lista)) {
      lista.push(...pagina.lista);
    }
  }

  return lista;
};

// Itens de um nó que pode não existir (ou não ter rodado) neste workflow: lista vazia em vez de erro.
const itensDoNo = (nome) => {
  try {
    return $(nome).all();
  } catch (erro) {
    return [];
  }
};

// MERGE em dbo.CtlCnnCadastro: linhas { tipo, id, nome, extra }. Blocos de 500 (VALUES aceita até 1000 linhas).
const sqlCadastros = (linhas) => {
  const validas = [];
  const vistos = new Set();

  for (const linha of linhas) {
    const id = Number(linha.id);
    const chave = `${linha.tipo}:${id}`;
    if (!linha.tipo || !Number.isFinite(id) || vistos.has(chave)) {
      continue;
    }
    vistos.add(chave);
    validas.push(`(${sqlS(linha.tipo, 20)}, ${sqlN(id)}, ${sqlS(linha.nome, 200)}, ${sqlS(linha.extra, 100)})`);
  }

  const blocos = [];
  for (let i = 0; i < validas.length; i += 500) {
    blocos.push(`
MERGE dbo.CtlCnnCadastro WITH (HOLDLOCK) AS destino
USING (VALUES
    ${validas.slice(i, i + 500).join(',\n    ')}
) AS origem (Tipo, Id, Nome, Extra)
    ON destino.Tipo = origem.Tipo AND destino.Id = origem.Id
WHEN MATCHED AND (ISNULL(destino.Nome, N'') <> ISNULL(origem.Nome, N'') OR ISNULL(destino.Extra, N'') <> ISNULL(origem.Extra, N'')) THEN
    UPDATE SET Nome = origem.Nome, Extra = origem.Extra, AtualizadoEm = SYSUTCDATETIME()
WHEN NOT MATCHED THEN
    INSERT (Tipo, Id, Nome, Extra) VALUES (origem.Tipo, origem.Id, origem.Nome, origem.Extra);`);
  }

  return blocos.join('\n');
};
// ===== fim dos helpers de SQL =====
