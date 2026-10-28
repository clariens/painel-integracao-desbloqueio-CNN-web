/*
  Tabelas do painel de bloqueio e liberação. Rodar no banco INTEGRACAO (SSMS ou nó executeQuery do n8n).
  Pode rodar mais de uma vez: cada passo confere antes de agir e nada é apagado.
  Sem GO: o driver do n8n não entende GO (isso é do SSMS).

  - dbo.CtlCnnControlePaciente: tabela de controle, uma linha por paciente com o estado atual.
  - dbo.CtlCnnAcaoPaciente: auditoria, uma linha por PATCH (automático ou pelo painel). Só recebe INSERT.

  A carga inicial do controle fica em sql/carga_inicial_controle.sql e roda só no corte da liberação automática.
*/

IF OBJECT_ID(N'dbo.CtlCnnControlePaciente', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.CtlCnnControlePaciente (
        IdPaciente          BIGINT NOT NULL,
        NomePaciente        NVARCHAR(200) NULL,
        Situacao            NVARCHAR(20) NOT NULL,
        IdAgendaReferencia  BIGINT NULL,
        NumeroFalta         INT NULL,
        DataInicioBloqueio  DATE NULL,
        DataFimBloqueio     DATE NULL,
        UltimaAcao          NVARCHAR(20) NOT NULL,
        OrigemUltimaAcao    NVARCHAR(20) NOT NULL,
        UltimaAcaoPor       NVARCHAR(100) NULL,
        MotivoUltimaAcao    NVARCHAR(500) NULL,
        IdUltimaAcao        BIGINT NULL,
        UltimaAcaoEm        DATETIME2(0) NOT NULL
            CONSTRAINT DF_CtlCnnControlePaciente_UltimaAcaoEm DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_CtlCnnControlePaciente PRIMARY KEY CLUSTERED (IdPaciente),
        CONSTRAINT CK_CtlCnnControlePaciente_Situacao CHECK (Situacao IN (N'BLOQUEADO', N'LIBERADO')),
        CONSTRAINT CK_CtlCnnControlePaciente_UltimaAcao CHECK (UltimaAcao IN (N'BLOQUEIO', N'LIBERACAO')),
        CONSTRAINT CK_CtlCnnControlePaciente_Origem CHECK (OrigemUltimaAcao IN (N'AUTOMATICO', N'PAINEL', N'CARGA_INICIAL'))
    );
END;

IF OBJECT_ID(N'dbo.CtlCnnAcaoPaciente', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.CtlCnnAcaoPaciente (
        Id                  BIGINT IDENTITY(1, 1) NOT NULL,
        IdPaciente          BIGINT NOT NULL,
        NomePaciente        NVARCHAR(200) NULL,
        Acao                NVARCHAR(20) NOT NULL,
        Origem              NVARCHAR(20) NOT NULL,
        Usuario             NVARCHAR(100) NOT NULL,
        Motivo              NVARCHAR(500) NULL,
        IdAgendaReferencia  BIGINT NULL,
        NumeroFalta         INT NULL,
        DataInicioBloqueio  DATE NULL,
        DataFimBloqueio     DATE NULL,
        Antecipada          BIT NOT NULL
            CONSTRAINT DF_CtlCnnAcaoPaciente_Antecipada DEFAULT 0,
        AtivoAntes          BIT NULL,
        Sucesso             BIT NOT NULL,
        HttpStatus          INT NULL,
        RespostaApi         NVARCHAR(1000) NULL,
        IdExecucaoN8n       NVARCHAR(50) NULL,
        CriadoEm            DATETIME2(0) NOT NULL
            CONSTRAINT DF_CtlCnnAcaoPaciente_CriadoEm DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_CtlCnnAcaoPaciente PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT CK_CtlCnnAcaoPaciente_Acao CHECK (Acao IN (N'BLOQUEIO', N'LIBERACAO')),
        CONSTRAINT CK_CtlCnnAcaoPaciente_Origem CHECK (Origem IN (N'AUTOMATICO', N'PAINEL', N'CARGA_INICIAL'))
    );
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = N'IX_CtlCnnAcaoPaciente_IdPaciente_CriadoEm'
      AND object_id = OBJECT_ID(N'dbo.CtlCnnAcaoPaciente')
)
BEGIN
    EXEC (N'
        CREATE NONCLUSTERED INDEX IX_CtlCnnAcaoPaciente_IdPaciente_CriadoEm
            ON dbo.CtlCnnAcaoPaciente (IdPaciente, CriadoEm DESC);
    ');
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = N'IX_CtlCnnAcaoPaciente_CriadoEm'
      AND object_id = OBJECT_ID(N'dbo.CtlCnnAcaoPaciente')
)
BEGIN
    EXEC (N'
        CREATE NONCLUSTERED INDEX IX_CtlCnnAcaoPaciente_CriadoEm
            ON dbo.CtlCnnAcaoPaciente (CriadoEm DESC)
            INCLUDE (IdPaciente, Acao, Origem, Usuario, Sucesso);
    ');
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = N'IX_CtlCnnControlePaciente_Situacao'
      AND object_id = OBJECT_ID(N'dbo.CtlCnnControlePaciente')
)
BEGIN
    EXEC (N'
        CREATE NONCLUSTERED INDEX IX_CtlCnnControlePaciente_Situacao
            ON dbo.CtlCnnControlePaciente (Situacao)
            INCLUDE (IdAgendaReferencia);
    ');
END;

-- Relatórios por período leem CtlCnnFaltaPaciente por DataFalta.
IF OBJECT_ID(N'dbo.CtlCnnFaltaPaciente', N'U') IS NOT NULL
   AND NOT EXISTS (
        SELECT 1
        FROM sys.indexes
        WHERE name = N'IX_CtlCnnFaltaPaciente_DataFalta'
          AND object_id = OBJECT_ID(N'dbo.CtlCnnFaltaPaciente')
   )
BEGIN
    EXEC (N'
        CREATE NONCLUSTERED INDEX IX_CtlCnnFaltaPaciente_DataFalta
            ON dbo.CtlCnnFaltaPaciente (DataFalta)
            INCLUDE (IdPaciente, NumeroFalta, NomePaciente, NomeExecutor, IdAgenda);
    ');
END;

/*
  Permissões do login usado pela credencial "TST Araguari - Integracao" no n8n (troque o nome do usuário do banco):

  GRANT SELECT, INSERT, UPDATE ON dbo.CtlCnnControlePaciente TO [usuario_n8n];
  GRANT SELECT, INSERT ON dbo.CtlCnnAcaoPaciente TO [usuario_n8n];
*/

SELECT
    DB_NAME() AS Banco,
    t.name AS Tabela,
    (SELECT COUNT(*) FROM sys.columns c WHERE c.object_id = t.object_id) AS QuantidadeColunas
FROM sys.tables t
WHERE t.object_id IN (
    OBJECT_ID(N'dbo.CtlCnnControlePaciente'),
    OBJECT_ID(N'dbo.CtlCnnAcaoPaciente')
)
ORDER BY t.name;
