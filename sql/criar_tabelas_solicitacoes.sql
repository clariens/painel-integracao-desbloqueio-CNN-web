/*
  Solicitações de desbloqueio. Rodar no banco INTEGRACAO (SSMS ou nó executeQuery do n8n).
  Pode rodar mais de uma vez: cada passo confere antes de agir e nada é apagado.
  Sem GO: o driver do n8n não entende GO (isso é do SSMS).

  Rodar ANTES de colar os workflows novos: a auditoria passa a gravar IdSolicitacao, e o bloqueio,
  as ações e a liberação automática atualizam as solicitações na mesma transação.

  - dbo.CtlCnnSolicitacao: um pedido de desbloqueio por linha (quem pediu, motivo, decisão, liberação).
    Só pode haver uma solicitação aberta (PENDENTE ou APROVADA) por paciente: índice único filtrado.
  - dbo.CtlCnnAcaoPaciente ganha IdSolicitacao: a liberação feita a partir de uma solicitação aponta para ela.
*/

IF OBJECT_ID(N'dbo.CtlCnnSolicitacao', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.CtlCnnSolicitacao (
        Id                  BIGINT IDENTITY(1, 1) NOT NULL,
        IdPaciente          BIGINT NOT NULL,
        NomePaciente        NVARCHAR(200) NULL,
        IdAgendaReferencia  BIGINT NOT NULL,
        NumeroFalta         INT NULL,
        DataFalta           DATE NULL,
        DataFimBloqueio     DATE NULL,
        Motivo              NVARCHAR(500) NOT NULL,
        SolicitadoPor       NVARCHAR(100) NOT NULL,
        SolicitadoEm        DATETIME2(0) NOT NULL
            CONSTRAINT DF_CtlCnnSolicitacao_SolicitadoEm DEFAULT SYSUTCDATETIME(),
        Status              NVARCHAR(20) NOT NULL
            CONSTRAINT DF_CtlCnnSolicitacao_Status DEFAULT N'PENDENTE',
        DecididoPor         NVARCHAR(100) NULL,
        DecididoEm          DATETIME2(0) NULL,
        MotivoDecisao       NVARCHAR(500) NULL,
        LiberadoPor         NVARCHAR(100) NULL,
        LiberadoEm          DATETIME2(0) NULL,
        IdAcao              BIGINT NULL,
        AtualizadoEm        DATETIME2(0) NOT NULL
            CONSTRAINT DF_CtlCnnSolicitacao_AtualizadoEm DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_CtlCnnSolicitacao PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT CK_CtlCnnSolicitacao_Status CHECK (Status IN (
            N'PENDENTE', N'APROVADA', N'LIBERADA', N'RECUSADA', N'CANCELADA', N'ENCERRADA'
        ))
    );
END;

-- Uma solicitação aberta por paciente. Filtrado: as fechadas (liberada, recusada...) podem se repetir.
IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = N'UX_CtlCnnSolicitacao_Aberta'
      AND object_id = OBJECT_ID(N'dbo.CtlCnnSolicitacao')
)
BEGIN
    EXEC (N'
        CREATE UNIQUE NONCLUSTERED INDEX UX_CtlCnnSolicitacao_Aberta
            ON dbo.CtlCnnSolicitacao (IdPaciente)
            WHERE Status IN (N''PENDENTE'', N''APROVADA'');
    ');
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = N'IX_CtlCnnSolicitacao_Status_SolicitadoEm'
      AND object_id = OBJECT_ID(N'dbo.CtlCnnSolicitacao')
)
BEGIN
    EXEC (N'
        CREATE NONCLUSTERED INDEX IX_CtlCnnSolicitacao_Status_SolicitadoEm
            ON dbo.CtlCnnSolicitacao (Status, SolicitadoEm DESC);
    ');
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = N'IX_CtlCnnSolicitacao_IdPaciente_SolicitadoEm'
      AND object_id = OBJECT_ID(N'dbo.CtlCnnSolicitacao')
)
BEGIN
    EXEC (N'
        CREATE NONCLUSTERED INDEX IX_CtlCnnSolicitacao_IdPaciente_SolicitadoEm
            ON dbo.CtlCnnSolicitacao (IdPaciente, SolicitadoEm DESC);
    ');
END;

-- A liberação feita a partir de uma solicitação aponta para ela na auditoria.
IF COL_LENGTH(N'dbo.CtlCnnAcaoPaciente', N'IdSolicitacao') IS NULL
BEGIN
    ALTER TABLE dbo.CtlCnnAcaoPaciente ADD IdSolicitacao BIGINT NULL;
END;

/*
  Permissões do login usado pela credencial "TST Araguari - Integracao" no n8n (troque o nome do usuário do banco):

  GRANT SELECT, INSERT, UPDATE ON dbo.CtlCnnSolicitacao TO [usuario_n8n];
*/

SELECT
    DB_NAME() AS Banco,
    t.name AS Tabela,
    (SELECT COUNT(*) FROM sys.columns c WHERE c.object_id = t.object_id) AS QuantidadeColunas,
    COL_LENGTH(N'dbo.CtlCnnAcaoPaciente', N'IdSolicitacao') AS BytesIdSolicitacaoNaAuditoria
FROM sys.tables t
WHERE t.object_id IN (
    OBJECT_ID(N'dbo.CtlCnnSolicitacao'),
    OBJECT_ID(N'dbo.CtlCnnAcaoPaciente')
)
ORDER BY t.name;
