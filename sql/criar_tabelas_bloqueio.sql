/*
  Rodar no n8n (executeQuery) ou no SSMS.
  Sem GO: o n8n / driver mssql não trata GO (isso é do SSMS).
  CREATE TABLE não "afeta linhas" — o SELECT do final confirma se a tabela existe.
*/

IF OBJECT_ID(N'dbo.CtlCnnFaltaPaciente', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.CtlCnnFaltaPaciente (
        Id                  BIGINT IDENTITY(1, 1) NOT NULL,
        IdAgenda            BIGINT NOT NULL,
        IdPaciente          BIGINT NOT NULL,
        NomePaciente        NVARCHAR(200) NULL,
        CpfCnpj             NVARCHAR(20) NULL,
        EmailPaciente       NVARCHAR(200) NULL,
        TelefonePaciente    NVARCHAR(30) NULL,
        DataFalta           DATE NOT NULL,
        HoraInicio          TIME(0) NULL,
        HoraFim             TIME(0) NULL,
        StatusAgenda        NVARCHAR(50) NOT NULL,
        NumeroFalta         INT NOT NULL,
        IdPessoaExecutor    BIGINT NULL,
        IdExecutorAgenda    BIGINT NULL,
        NomeExecutor        NVARCHAR(200) NULL,
        TipoExecutor        NVARCHAR(50) NULL,
        IdLocalAgenda       BIGINT NULL,
        IdTipoConsulta      BIGINT NULL,
        Observacoes         NVARCHAR(500) NULL,
        DataColeta          DATETIME2(0) NOT NULL
            CONSTRAINT DF_CtlCnnFaltaPaciente_DataColeta DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_CtlCnnFaltaPaciente PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT UQ_CtlCnnFaltaPaciente_IdAgenda UNIQUE (IdAgenda)
    );
END;

IF COL_LENGTH(N'dbo.CtlCnnFaltaPaciente', N'DataAgenda') IS NOT NULL
   AND COL_LENGTH(N'dbo.CtlCnnFaltaPaciente', N'DataFalta') IS NULL
BEGIN
    EXEC sys.sp_rename N'dbo.CtlCnnFaltaPaciente.DataAgenda', N'DataFalta', N'COLUMN';
END;

IF COL_LENGTH(N'dbo.CtlCnnFaltaPaciente', N'NumeroFalta') IS NULL
BEGIN
    ALTER TABLE dbo.CtlCnnFaltaPaciente ADD NumeroFalta INT NULL;
END;

EXEC (N'
    ;WITH Numeracao AS (
        SELECT
            Id,
            ROW_NUMBER() OVER (
                PARTITION BY IdPaciente
                ORDER BY DataFalta, IdAgenda
            ) AS NumeroCalculado
        FROM dbo.CtlCnnFaltaPaciente
    )
    UPDATE destino
    SET NumeroFalta = origem.NumeroCalculado
    FROM dbo.CtlCnnFaltaPaciente AS destino
    INNER JOIN Numeracao AS origem
        ON origem.Id = destino.Id
    WHERE destino.NumeroFalta IS NULL;
');

IF EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.CtlCnnFaltaPaciente')
      AND name = N'NumeroFalta'
      AND is_nullable = 1
)
BEGIN
    EXEC (N'ALTER TABLE dbo.CtlCnnFaltaPaciente ALTER COLUMN NumeroFalta INT NOT NULL;');
END;

IF EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = N'IX_CtlCnnFaltaPaciente_IdPaciente_DataAgenda'
      AND object_id = OBJECT_ID(N'dbo.CtlCnnFaltaPaciente')
)
    DROP INDEX IX_CtlCnnFaltaPaciente_IdPaciente_DataAgenda ON dbo.CtlCnnFaltaPaciente;

IF EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = N'IX_CtlCnnFaltaPaciente_IdPaciente_DataFalta'
      AND object_id = OBJECT_ID(N'dbo.CtlCnnFaltaPaciente')
)
    DROP INDEX IX_CtlCnnFaltaPaciente_IdPaciente_DataFalta ON dbo.CtlCnnFaltaPaciente;

IF OBJECT_ID(N'dbo.CtlCnnFaltaPaciente', N'U') IS NOT NULL
   AND NOT EXISTS (
        SELECT 1
        FROM sys.indexes
        WHERE name = N'IX_CtlCnnFaltaPaciente_IdPaciente_NumeroFalta'
          AND object_id = OBJECT_ID(N'dbo.CtlCnnFaltaPaciente')
   )
BEGIN
    EXEC (N'
        CREATE NONCLUSTERED INDEX IX_CtlCnnFaltaPaciente_IdPaciente_NumeroFalta
            ON dbo.CtlCnnFaltaPaciente (IdPaciente, NumeroFalta)
            INCLUDE (DataFalta, StatusAgenda, NomePaciente, IdAgenda);
    ');
END;

-- Rótulo do agendamento (idRotulo da agenda), para os relatórios.
IF COL_LENGTH(N'dbo.CtlCnnFaltaPaciente', N'IdRotulo') IS NULL
BEGIN
    ALTER TABLE dbo.CtlCnnFaltaPaciente ADD IdRotulo BIGINT NULL;
END;

-- Procedimentos de cada falta (procedimentos[] da agenda). Algumas clínicas não preenchem: aí a falta fica sem linha aqui.
IF OBJECT_ID(N'dbo.CtlCnnFaltaProcedimento', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.CtlCnnFaltaProcedimento (
        IdAgenda            BIGINT NOT NULL,
        IdTipoProcedimento  BIGINT NOT NULL,
        NomeProcedimento    NVARCHAR(200) NULL,
        IdEspecialidade     BIGINT NULL,
        Quantidade          INT NULL,
        CONSTRAINT PK_CtlCnnFaltaProcedimento PRIMARY KEY CLUSTERED (IdAgenda, IdTipoProcedimento)
    );
END;

-- Nomes das listas da API do CNN, gravados pelo bloqueio (01:00). Executor: Id = idpessoa (o idPessoaExecutor da agenda).
IF OBJECT_ID(N'dbo.CtlCnnCadastro', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.CtlCnnCadastro (
        Tipo                NVARCHAR(20) NOT NULL,
        Id                  BIGINT NOT NULL,
        Nome                NVARCHAR(200) NULL,
        Extra               NVARCHAR(100) NULL,
        AtualizadoEm        DATETIME2(0) NOT NULL
            CONSTRAINT DF_CtlCnnCadastro_AtualizadoEm DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_CtlCnnCadastro PRIMARY KEY CLUSTERED (Tipo, Id),
        CONSTRAINT CK_CtlCnnCadastro_Tipo CHECK (Tipo IN (N'TIPO_CONSULTA', N'EXECUTOR', N'ROTULO', N'LOCAL_AGENDA', N'ESPECIALIDADE'))
    );
END;

/*
  Permissões do login usado pela credencial "TST Araguari" no n8n (troque o nome do usuário do banco):

  GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.CtlCnnFaltaProcedimento TO [usuario_n8n];
  GRANT SELECT, INSERT, UPDATE ON dbo.CtlCnnCadastro TO [usuario_n8n];
*/

IF OBJECT_ID(N'dbo.CtlCnnBloqueioPaciente', N'U') IS NOT NULL
    DROP TABLE dbo.CtlCnnBloqueioPaciente;

IF OBJECT_ID(N'dbo.CtlCnnRegraBloqueioFalta', N'U') IS NOT NULL
    DROP TABLE dbo.CtlCnnRegraBloqueioFalta;

SELECT
    DB_NAME() AS Banco,
    SCHEMA_NAME(t.schema_id) AS Esquema,
    t.name AS Tabela,
    (
        SELECT COUNT(*)
        FROM sys.columns c
        WHERE c.object_id = t.object_id
    ) AS QuantidadeColunas,
    COL_LENGTH(N'dbo.CtlCnnFaltaPaciente', N'NumeroFalta') AS BytesNumeroFalta
FROM sys.tables t
WHERE t.object_id IN (
    OBJECT_ID(N'dbo.CtlCnnFaltaPaciente'),
    OBJECT_ID(N'dbo.CtlCnnFaltaProcedimento'),
    OBJECT_ID(N'dbo.CtlCnnCadastro')
);
