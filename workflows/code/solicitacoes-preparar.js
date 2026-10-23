// Nó "Preparar" (workflow CNN Painel - Solicitações). Lê body.action, valida os campos e monta o SQL.
// A Vercel já conferiu login e perfil (aprovar e recusar: admin); aqui valida de novo, porque o webhook é a fronteira.
// Escritas devolvem uma linha { Resultado, ... } (OK, JA_EXISTE, NAO_ENCONTRADA, STATUS_INVALIDO...).
// Liberar não passa por aqui: é o workflow Ações, com idSolicitacao, que reativa no CNN e fecha a solicitação.
const unwrap = (valor) => {
  if (typeof valor === 'string') {
    try {
      return JSON.parse(valor);
    } catch (erro) {
      return {};
    }
  }

  return valor && typeof valor === 'object' && !Array.isArray(valor) ? valor : {};
};

const item = unwrap($input.first().json);
const body = { ...item, ...unwrap(item.body) };
const action = String(body.action || '').trim();

const erro = (statusCode, mensagem) => [{
  json: { action: 'error', statusCode, response: { error: mensagem } }
}];

const LOGIN = /^[A-Za-z0-9._-]{2,50}$/;
const usuario = String(body.usuario || '').trim();
const motivo = String(body.motivo || '').replace(/\s+/g, ' ').trim();
const inicio = inicioCiclo();
const hoje = hojeSp();

const inteiro = (valor) => {
  const numero = Number(valor);
  return Number.isSafeInteger(numero) && numero > 0 ? numero : null;
};

const cabecalho = `USE INTEGRACAO;
SET NOCOUNT ON;
DECLARE @inicio DATE = ${sqlDate(inicio)};
DECLARE @hoje DATE = ${sqlDate(hoje)};
DECLARE @usuario NVARCHAR(100) = ${sqlS(usuario, 100)};`;

const escrita = (corpo) => `${cabecalho}
SET XACT_ABORT ON;
BEGIN TRANSACTION;
${corpo}
COMMIT TRANSACTION;`;

// Falta vigente do paciente @paciente: a de maior número no ciclo; sem falta no ciclo, a mais recente de antes.
const faltaVigente = `
DECLARE @idAgenda BIGINT, @nome NVARCHAR(200), @dataFalta DATE, @numero INT, @fim DATE;
SELECT TOP (1)
    @idAgenda = f.IdAgenda,
    @nome = f.NomePaciente,
    @dataFalta = f.DataFalta,
    @numero = f.NumeroFalta
FROM dbo.CtlCnnFaltaPaciente f
WHERE f.IdPaciente = @paciente
ORDER BY CASE WHEN f.DataFalta >= @inicio THEN 0 ELSE 1 END, f.NumeroFalta DESC, f.DataFalta DESC, f.IdAgenda DESC;
SET @fim = DATEADD(DAY, ${sqlDiasCase('@numero')}, @dataFalta);

DECLARE @situacao NVARCHAR(20), @referencia BIGINT;
SELECT @situacao = Situacao, @referencia = IdAgendaReferencia
FROM dbo.CtlCnnControlePaciente
WHERE IdPaciente = @paciente;`;

const ok = (query, extra = {}) => [{ json: { action, query, hoje, ...extra } }];

if (action === 'listar') {
  // Todas as abertas e as 300 fechadas mais recentes, com a situação atual do paciente
  // (falta vigente de agora: se mudou, a solicitação está desatualizada).
  return ok(`${cabecalho}

;WITH Ultimas AS (
    SELECT TOP (300) Id
    FROM dbo.CtlCnnSolicitacao
    WHERE Status NOT IN (N'PENDENTE', N'APROVADA')
    ORDER BY AtualizadoEm DESC, Id DESC
)
SELECT
    N'solicitacao' AS _secao,
    s.Id,
    s.IdPaciente,
    s.NomePaciente,
    s.IdAgendaReferencia,
    s.NumeroFalta,
    CONVERT(char(10), s.DataFalta, 23) AS DataFalta,
    CONVERT(char(10), s.DataFimBloqueio, 23) AS DataFimBloqueio,
    s.Motivo,
    s.SolicitadoPor,
    s.SolicitadoEm,
    s.Status,
    s.DecididoPor,
    s.DecididoEm,
    s.MotivoDecisao,
    s.LiberadoPor,
    s.LiberadoEm,
    s.IdAcao,
    v.IdAgenda AS IdAgendaAtual,
    c.Situacao AS SituacaoControle,
    c.IdAgendaReferencia AS ReferenciaControle
FROM dbo.CtlCnnSolicitacao s
OUTER APPLY (
    SELECT TOP (1) f.IdAgenda
    FROM dbo.CtlCnnFaltaPaciente f
    WHERE f.IdPaciente = s.IdPaciente
    ORDER BY CASE WHEN f.DataFalta >= @inicio THEN 0 ELSE 1 END, f.NumeroFalta DESC, f.DataFalta DESC, f.IdAgenda DESC
) v
LEFT JOIN dbo.CtlCnnControlePaciente c
    ON c.IdPaciente = s.IdPaciente
WHERE s.Status IN (N'PENDENTE', N'APROVADA')
   OR s.Id IN (SELECT Id FROM Ultimas)
ORDER BY s.SolicitadoEm DESC, s.Id DESC;

SELECT N'contagem' AS _secao, Status, COUNT(*) AS Quantidade
FROM dbo.CtlCnnSolicitacao
GROUP BY Status;`);
}

if (!LOGIN.test(usuario)) {
  return erro(400, 'Usuário da solicitação ausente.');
}

if (action === 'criar') {
  const paciente = inteiro(body.idPaciente);
  if (!paciente) return erro(400, 'Paciente inválido.');
  if (motivo.length < 5 || motivo.length > 500) return erro(400, 'Informe o motivo (de 5 a 500 caracteres).');

  // Pode pedir: falta vigente com prazo correndo, ainda não liberada no painel para esta falta,
  // e (falta no ciclo) ou (bloqueio de ciclo anterior ainda correndo). Uma solicitação aberta por paciente.
  return ok(escrita(`DECLARE @paciente BIGINT = ${sqlN(paciente)};
${faltaVigente}

DECLARE @aberta BIGINT = (
    SELECT TOP (1) Id FROM dbo.CtlCnnSolicitacao WITH (UPDLOCK, HOLDLOCK)
    WHERE IdPaciente = @paciente AND Status IN (N'PENDENTE', N'APROVADA')
);

IF @idAgenda IS NULL
    SELECT N'SEM_FALTA' AS Resultado
ELSE IF @dataFalta < @inicio AND NOT (@situacao = N'BLOQUEADO' AND @referencia = @idAgenda)
    SELECT N'SEM_FALTA' AS Resultado
ELSE IF @fim < @hoje
    SELECT N'PRAZO_CUMPRIDO' AS Resultado, CONVERT(char(10), @fim, 23) AS DataFimBloqueio
ELSE IF @situacao = N'LIBERADO' AND @referencia = @idAgenda
    SELECT N'JA_LIBERADO' AS Resultado
ELSE IF @aberta IS NOT NULL
    SELECT N'JA_EXISTE' AS Resultado, @aberta AS Id
ELSE
BEGIN
    INSERT INTO dbo.CtlCnnSolicitacao (
        IdPaciente, NomePaciente, IdAgendaReferencia, NumeroFalta, DataFalta, DataFimBloqueio, Motivo, SolicitadoPor
    )
    VALUES (@paciente, @nome, @idAgenda, @numero, @dataFalta, @fim, ${sqlS(motivo, 500)}, @usuario);

    SELECT N'OK' AS Resultado, CONVERT(BIGINT, SCOPE_IDENTITY()) AS Id, @paciente AS IdPaciente, N'PENDENTE' AS Status;
END;`), { idPaciente: paciente });
}

const id = inteiro(body.id);
if (!id) {
  return erro(400, 'Solicitação inválida.');
}

// Lê a solicitação travada para a decisão (duas pessoas clicando ao mesmo tempo: só uma vence).
const travar = `DECLARE @id BIGINT = ${sqlN(id)};
DECLARE @status NVARCHAR(20), @paciente BIGINT, @referenciaSolicitacao BIGINT, @solicitadoPor NVARCHAR(100);
SELECT
    @status = Status,
    @paciente = IdPaciente,
    @referenciaSolicitacao = IdAgendaReferencia,
    @solicitadoPor = SolicitadoPor
FROM dbo.CtlCnnSolicitacao WITH (UPDLOCK, HOLDLOCK)
WHERE Id = @id;`;

if (action === 'aprovar') {
  return ok(escrita(`${travar}
${faltaVigente}

IF @status IS NULL
    SELECT N'NAO_ENCONTRADA' AS Resultado
ELSE IF @status <> N'PENDENTE'
    SELECT N'STATUS_INVALIDO' AS Resultado, @status AS Status
ELSE IF ISNULL(@idAgenda, 0) <> @referenciaSolicitacao
BEGIN
    UPDATE dbo.CtlCnnSolicitacao
    SET Status = N'ENCERRADA',
        MotivoDecisao = N'Nova falta registrada: a solicitação era da falta anterior.',
        DecididoPor = @usuario, DecididoEm = SYSUTCDATETIME(), AtualizadoEm = SYSUTCDATETIME()
    WHERE Id = @id;
    SELECT N'DESATUALIZADA' AS Resultado, @paciente AS IdPaciente;
END
ELSE IF @fim < @hoje
BEGIN
    UPDATE dbo.CtlCnnSolicitacao
    SET Status = N'ENCERRADA',
        MotivoDecisao = N'Prazo cumprido: a liberação automática cuida deste paciente.',
        DecididoPor = @usuario, DecididoEm = SYSUTCDATETIME(), AtualizadoEm = SYSUTCDATETIME()
    WHERE Id = @id;
    SELECT N'PRAZO_CUMPRIDO' AS Resultado, @paciente AS IdPaciente;
END
ELSE
BEGIN
    UPDATE dbo.CtlCnnSolicitacao
    SET Status = N'APROVADA',
        DecididoPor = @usuario, DecididoEm = SYSUTCDATETIME(), AtualizadoEm = SYSUTCDATETIME()
    WHERE Id = @id;
    SELECT N'OK' AS Resultado, @id AS Id, @paciente AS IdPaciente, N'APROVADA' AS Status;
END;`), { id });
}

if (action === 'recusar') {
  if (motivo.length < 5 || motivo.length > 500) return erro(400, 'Informe o motivo da recusa (de 5 a 500 caracteres).');

  return ok(escrita(`${travar}

IF @status IS NULL
    SELECT N'NAO_ENCONTRADA' AS Resultado
ELSE IF @status NOT IN (N'PENDENTE', N'APROVADA')
    SELECT N'STATUS_INVALIDO' AS Resultado, @status AS Status
ELSE
BEGIN
    UPDATE dbo.CtlCnnSolicitacao
    SET Status = N'RECUSADA',
        MotivoDecisao = ${sqlS(motivo, 500)},
        DecididoPor = @usuario, DecididoEm = SYSUTCDATETIME(), AtualizadoEm = SYSUTCDATETIME()
    WHERE Id = @id;
    SELECT N'OK' AS Resultado, @id AS Id, @paciente AS IdPaciente, N'RECUSADA' AS Status;
END;`), { id });
}

if (action === 'cancelar') {
  if (motivo && motivo.length > 500) return erro(400, 'O motivo passa de 500 caracteres.');
  const admin = body.admin === true;

  return ok(escrita(`${travar}

IF @status IS NULL
    SELECT N'NAO_ENCONTRADA' AS Resultado
ELSE IF @status NOT IN (N'PENDENTE', N'APROVADA')
    SELECT N'STATUS_INVALIDO' AS Resultado, @status AS Status
ELSE IF @solicitadoPor <> @usuario AND ${sqlBit(admin)} = 0
    SELECT N'NAO_PERMITIDO' AS Resultado
ELSE
BEGIN
    UPDATE dbo.CtlCnnSolicitacao
    SET Status = N'CANCELADA',
        MotivoDecisao = ${sqlS(motivo || null, 500)},
        DecididoPor = @usuario, DecididoEm = SYSUTCDATETIME(), AtualizadoEm = SYSUTCDATETIME()
    WHERE Id = @id;
    SELECT N'OK' AS Resultado, @id AS Id, @paciente AS IdPaciente, N'CANCELADA' AS Status;
END;`), { id });
}

return erro(400, 'Ação desconhecida.');
