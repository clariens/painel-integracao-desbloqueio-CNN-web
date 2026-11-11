/*
  ClinicBoard — GMUD de produção: estrutura completa do banco INTEGRACAO.

  Para um banco SEM as tabelas do sistema (primeira implantação em produção). Cria as 10 tabelas já na forma
  final: com unidade (IdUnidade) em todas as tabelas de dados, chaves e índices começando pela unidade.
  É o mesmo resultado que os scripts de sql/ produziram no ambiente de desenvolvimento, sem os passos de
  migração (renomear coluna, apagar tabelas antigas, refazer chaves), que não se aplicam a um banco novo.

  Unidades cadastradas: 1 = Clínica Escola Zarns Salvador, 3 = Centro Ambulatório José Gomes da Rocha.
  Os números são os mesmos do desenvolvimento (o 2, Pouso Alegre, fica livre para quando entrar).
  O CID do CNN de cada unidade NÃO fica no banco: fica nas Variables do n8n, CNN_CID_<Codigo>.

  Como rodar: SSMS, conectado ao servidor de produção. Uma transação só (XACT_ABORT): se qualquer passo falhar,
  nada fica criado. Pode rodar de novo: cada tabela, índice e unidade é conferido antes de criar.
  Sem GO, para também poder rodar num nó executeQuery do n8n.

  Depois deste script:
    1. GRANT para o usuário da credencial SQL de produção do n8n (bloco comentado no fim).
    2. Primeiro administrador: `npm run admin` no repositório e rodar o INSERT que ele imprime (02_..., ver a GMUD).
*/

USE INTEGRACAO;

SET NOCOUNT ON;
SET XACT_ABORT ON;
-- Exigidos pelo índice filtrado (UX_CtlCnnSolicitacao_Aberta). São o padrão do SSMS; ficam explícitos.
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

BEGIN TRANSACTION;

/* ---------- 1. Unidades ---------- */

IF OBJECT_ID(N'dbo.CtlCnnUnidade', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.CtlCnnUnidade (
        IdUnidade           SMALLINT NOT NULL,
        Codigo              NVARCHAR(40) NOT NULL,
        Nome                NVARCHAR(100) NOT NULL,
        Ativa               BIT NOT NULL
            CONSTRAINT DF_CtlCnnUnidade_Ativa DEFAULT 1,
        CriadoEm            DATETIME2(0) NOT NULL
            CONSTRAINT DF_CtlCnnUnidade_CriadoEm DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_CtlCnnUnidade PRIMARY KEY CLUSTERED (IdUnidade),
        CONSTRAINT UQ_CtlCnnUnidade_Codigo UNIQUE (Codigo),
        -- O código vira nome de variável no n8n (CNN_CID_<Codigo>): só A-Z, 0-9 e _.
        CONSTRAINT CK_CtlCnnUnidade_Codigo CHECK (Codigo COLLATE Latin1_General_BIN NOT LIKE N'%[^A-Z0-9_]%')
    );
END;

INSERT INTO dbo.CtlCnnUnidade (IdUnidade, Codigo, Nome)
SELECT novas.IdUnidade, novas.Codigo, novas.Nome
FROM (VALUES
    (CAST(1 AS SMALLINT), N'ZARNS_SALVADOR', N'Clínica Escola Zarns Salvador'),
    (CAST(3 AS SMALLINT), N'JOSE_GOMES_DA_ROCHA', N'Centro Ambulatório José Gomes da Rocha')
) AS novas (IdUnidade, Codigo, Nome)
WHERE NOT EXISTS (SELECT 1 FROM dbo.CtlCnnUnidade u WHERE u.IdUnidade = novas.IdUnidade);

/* ---------- 2. Faltas, procedimentos e cadastros (bloqueio das 01:00) ---------- */

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
        IdRotulo            BIGINT NULL,
        IdUnidade           SMALLINT NOT NULL
            CONSTRAINT DF_CtlCnnFaltaPaciente_IdUnidade DEFAULT 1,
        CONSTRAINT PK_CtlCnnFaltaPaciente PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT UQ_CtlCnnFaltaPaciente_IdAgenda UNIQUE (IdUnidade, IdAgenda),
        CONSTRAINT FK_CtlCnnFaltaPaciente_Unidade FOREIGN KEY (IdUnidade) REFERENCES dbo.CtlCnnUnidade (IdUnidade)
    );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_CtlCnnFaltaPaciente_IdPaciente_NumeroFalta' AND object_id = OBJECT_ID(N'dbo.CtlCnnFaltaPaciente'))
    EXEC (N'CREATE NONCLUSTERED INDEX IX_CtlCnnFaltaPaciente_IdPaciente_NumeroFalta
        ON dbo.CtlCnnFaltaPaciente (IdUnidade, IdPaciente, NumeroFalta)
        INCLUDE (DataFalta, StatusAgenda, NomePaciente, IdAgenda);');

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_CtlCnnFaltaPaciente_DataFalta' AND object_id = OBJECT_ID(N'dbo.CtlCnnFaltaPaciente'))
    EXEC (N'CREATE NONCLUSTERED INDEX IX_CtlCnnFaltaPaciente_DataFalta
        ON dbo.CtlCnnFaltaPaciente (IdUnidade, DataFalta)
        INCLUDE (IdPaciente, NumeroFalta, NomePaciente, NomeExecutor, IdAgenda);');

-- Procedimentos de cada falta (procedimentos[] da agenda). Algumas clínicas não preenchem: a falta fica sem linha aqui.
IF OBJECT_ID(N'dbo.CtlCnnFaltaProcedimento', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.CtlCnnFaltaProcedimento (
        IdAgenda            BIGINT NOT NULL,
        IdTipoProcedimento  BIGINT NOT NULL,
        NomeProcedimento    NVARCHAR(200) NULL,
        IdEspecialidade     BIGINT NULL,
        Quantidade          INT NULL,
        IdUnidade           SMALLINT NOT NULL
            CONSTRAINT DF_CtlCnnFaltaProcedimento_IdUnidade DEFAULT 1,
        CONSTRAINT PK_CtlCnnFaltaProcedimento PRIMARY KEY CLUSTERED (IdUnidade, IdAgenda, IdTipoProcedimento),
        CONSTRAINT FK_CtlCnnFaltaProcedimento_Unidade FOREIGN KEY (IdUnidade) REFERENCES dbo.CtlCnnUnidade (IdUnidade)
    );
END;

-- Nomes das listas da API do CNN, gravados pelo bloqueio. Executor: Id = idpessoa (o idPessoaExecutor da agenda).
IF OBJECT_ID(N'dbo.CtlCnnCadastro', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.CtlCnnCadastro (
        Tipo                NVARCHAR(20) NOT NULL,
        Id                  BIGINT NOT NULL,
        Nome                NVARCHAR(200) NULL,
        Extra               NVARCHAR(100) NULL,
        AtualizadoEm        DATETIME2(0) NOT NULL
            CONSTRAINT DF_CtlCnnCadastro_AtualizadoEm DEFAULT SYSUTCDATETIME(),
        IdUnidade           SMALLINT NOT NULL
            CONSTRAINT DF_CtlCnnCadastro_IdUnidade DEFAULT 1,
        CONSTRAINT PK_CtlCnnCadastro PRIMARY KEY CLUSTERED (IdUnidade, Tipo, Id),
        CONSTRAINT CK_CtlCnnCadastro_Tipo CHECK (Tipo IN (N'TIPO_CONSULTA', N'EXECUTOR', N'ROTULO', N'LOCAL_AGENDA', N'ESPECIALIDADE')),
        CONSTRAINT FK_CtlCnnCadastro_Unidade FOREIGN KEY (IdUnidade) REFERENCES dbo.CtlCnnUnidade (IdUnidade)
    );
END;

/* ---------- 3. Controle e auditoria (painel e liberação das 02:00) ---------- */

-- Uma linha por paciente com o estado atual.
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
        IdUnidade           SMALLINT NOT NULL
            CONSTRAINT DF_CtlCnnControlePaciente_IdUnidade DEFAULT 1,
        CONSTRAINT PK_CtlCnnControlePaciente PRIMARY KEY CLUSTERED (IdUnidade, IdPaciente),
        CONSTRAINT CK_CtlCnnControlePaciente_Situacao CHECK (Situacao IN (N'BLOQUEADO', N'LIBERADO')),
        CONSTRAINT CK_CtlCnnControlePaciente_UltimaAcao CHECK (UltimaAcao IN (N'BLOQUEIO', N'LIBERACAO')),
        CONSTRAINT CK_CtlCnnControlePaciente_Origem CHECK (OrigemUltimaAcao IN (N'AUTOMATICO', N'PAINEL', N'CARGA_INICIAL')),
        CONSTRAINT FK_CtlCnnControlePaciente_Unidade FOREIGN KEY (IdUnidade) REFERENCES dbo.CtlCnnUnidade (IdUnidade)
    );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_CtlCnnControlePaciente_Situacao' AND object_id = OBJECT_ID(N'dbo.CtlCnnControlePaciente'))
    EXEC (N'CREATE NONCLUSTERED INDEX IX_CtlCnnControlePaciente_Situacao
        ON dbo.CtlCnnControlePaciente (IdUnidade, Situacao)
        INCLUDE (IdAgendaReferencia);');

-- Auditoria: uma linha por bloqueio ou liberação (automático ou pelo painel). Só recebe INSERT.
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
        IdSolicitacao       BIGINT NULL,
        IdUnidade           SMALLINT NOT NULL
            CONSTRAINT DF_CtlCnnAcaoPaciente_IdUnidade DEFAULT 1,
        CONSTRAINT PK_CtlCnnAcaoPaciente PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT CK_CtlCnnAcaoPaciente_Acao CHECK (Acao IN (N'BLOQUEIO', N'LIBERACAO')),
        CONSTRAINT CK_CtlCnnAcaoPaciente_Origem CHECK (Origem IN (N'AUTOMATICO', N'PAINEL', N'CARGA_INICIAL')),
        CONSTRAINT FK_CtlCnnAcaoPaciente_Unidade FOREIGN KEY (IdUnidade) REFERENCES dbo.CtlCnnUnidade (IdUnidade)
    );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_CtlCnnAcaoPaciente_IdPaciente_CriadoEm' AND object_id = OBJECT_ID(N'dbo.CtlCnnAcaoPaciente'))
    EXEC (N'CREATE NONCLUSTERED INDEX IX_CtlCnnAcaoPaciente_IdPaciente_CriadoEm
        ON dbo.CtlCnnAcaoPaciente (IdUnidade, IdPaciente, CriadoEm DESC);');

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_CtlCnnAcaoPaciente_CriadoEm' AND object_id = OBJECT_ID(N'dbo.CtlCnnAcaoPaciente'))
    EXEC (N'CREATE NONCLUSTERED INDEX IX_CtlCnnAcaoPaciente_CriadoEm
        ON dbo.CtlCnnAcaoPaciente (IdUnidade, CriadoEm DESC)
        INCLUDE (IdPaciente, Acao, Origem, Usuario, Sucesso);');

/* ---------- 4. Solicitações de desbloqueio ---------- */

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
        IdUnidade           SMALLINT NOT NULL
            CONSTRAINT DF_CtlCnnSolicitacao_IdUnidade DEFAULT 1,
        CONSTRAINT PK_CtlCnnSolicitacao PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT CK_CtlCnnSolicitacao_Status CHECK (Status IN (
            N'PENDENTE', N'APROVADA', N'LIBERADA', N'RECUSADA', N'CANCELADA', N'ENCERRADA'
        )),
        CONSTRAINT FK_CtlCnnSolicitacao_Unidade FOREIGN KEY (IdUnidade) REFERENCES dbo.CtlCnnUnidade (IdUnidade)
    );
END;

-- Uma solicitação aberta (pendente ou aprovada) por paciente em cada unidade. As fechadas podem se repetir.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_CtlCnnSolicitacao_Aberta' AND object_id = OBJECT_ID(N'dbo.CtlCnnSolicitacao'))
    EXEC (N'CREATE UNIQUE NONCLUSTERED INDEX UX_CtlCnnSolicitacao_Aberta
        ON dbo.CtlCnnSolicitacao (IdUnidade, IdPaciente)
        WHERE Status IN (N''PENDENTE'', N''APROVADA'');');

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_CtlCnnSolicitacao_Status_SolicitadoEm' AND object_id = OBJECT_ID(N'dbo.CtlCnnSolicitacao'))
    EXEC (N'CREATE NONCLUSTERED INDEX IX_CtlCnnSolicitacao_Status_SolicitadoEm
        ON dbo.CtlCnnSolicitacao (IdUnidade, Status, SolicitadoEm DESC);');

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_CtlCnnSolicitacao_IdPaciente_SolicitadoEm' AND object_id = OBJECT_ID(N'dbo.CtlCnnSolicitacao'))
    EXEC (N'CREATE NONCLUSTERED INDEX IX_CtlCnnSolicitacao_IdPaciente_SolicitadoEm
        ON dbo.CtlCnnSolicitacao (IdUnidade, IdPaciente, SolicitadoEm DESC);');

/* ---------- 5. Usuários do ClinicBoard ---------- */

-- A senha em texto nunca chega aqui: a Vercel gera salt e hash (scrypt) e o n8n só grava.
IF OBJECT_ID(N'dbo.CtlCnnUsuario', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.CtlCnnUsuario (
        IdUsuario           INT IDENTITY(1, 1) NOT NULL,
        Login               NVARCHAR(50) NOT NULL,
        Nome                NVARCHAR(100) NOT NULL,
        Perfil              NVARCHAR(10) NOT NULL,
        Ativo               BIT NOT NULL
            CONSTRAINT DF_CtlCnnUsuario_Ativo DEFAULT 1,
        SenhaSalt           CHAR(32) NOT NULL,
        SenhaHash           CHAR(128) NOT NULL,
        TrocarSenha         BIT NOT NULL
            CONSTRAINT DF_CtlCnnUsuario_TrocarSenha DEFAULT 1,
        VersaoSessao        INT NOT NULL
            CONSTRAINT DF_CtlCnnUsuario_VersaoSessao DEFAULT 1,
        TentativasFalhas    INT NOT NULL
            CONSTRAINT DF_CtlCnnUsuario_TentativasFalhas DEFAULT 0,
        BloqueadoAte        DATETIME2(0) NULL,
        UltimoAcessoEm      DATETIME2(0) NULL,
        CriadoEm            DATETIME2(0) NOT NULL
            CONSTRAINT DF_CtlCnnUsuario_CriadoEm DEFAULT SYSUTCDATETIME(),
        CriadoPor           NVARCHAR(50) NULL,
        AlteradoEm          DATETIME2(0) NULL,
        AlteradoPor         NVARCHAR(50) NULL,
        CONSTRAINT PK_CtlCnnUsuario PRIMARY KEY CLUSTERED (IdUsuario),
        CONSTRAINT UQ_CtlCnnUsuario_Login UNIQUE (Login),
        CONSTRAINT CK_CtlCnnUsuario_Perfil CHECK (Perfil IN (N'LEITOR', N'EDITOR', N'ADMIN'))
    );
END;

-- Auditoria de usuários (criação, perfil, senha, unidades, falhas de login). Só recebe INSERT.
IF OBJECT_ID(N'dbo.CtlCnnUsuarioEvento', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.CtlCnnUsuarioEvento (
        Id                  BIGINT IDENTITY(1, 1) NOT NULL,
        Login               NVARCHAR(50) NOT NULL,
        Evento              NVARCHAR(30) NOT NULL,
        Detalhe             NVARCHAR(500) NULL,
        Por                 NVARCHAR(50) NULL,
        CriadoEm            DATETIME2(0) NOT NULL
            CONSTRAINT DF_CtlCnnUsuarioEvento_CriadoEm DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_CtlCnnUsuarioEvento PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT CK_CtlCnnUsuarioEvento_Evento CHECK (Evento IN (
            N'CRIADO', N'PERFIL_ALTERADO', N'NOME_ALTERADO', N'DESATIVADO', N'REATIVADO',
            N'SENHA_REDEFINIDA', N'SENHA_TROCADA', N'LOGIN_FALHA', N'LOGIN_BLOQUEADO', N'UNIDADES_ALTERADAS'
        ))
    );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_CtlCnnUsuarioEvento_CriadoEm' AND object_id = OBJECT_ID(N'dbo.CtlCnnUsuarioEvento'))
    EXEC (N'CREATE NONCLUSTERED INDEX IX_CtlCnnUsuarioEvento_CriadoEm
        ON dbo.CtlCnnUsuarioEvento (CriadoEm DESC)
        INCLUDE (Login, Evento, Por);');

-- Unidades de cada Leitor e Editor. O Admin acessa todas e não tem linha aqui.
IF OBJECT_ID(N'dbo.CtlCnnUsuarioUnidade', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.CtlCnnUsuarioUnidade (
        IdUsuario           INT NOT NULL,
        IdUnidade           SMALLINT NOT NULL,
        CONSTRAINT PK_CtlCnnUsuarioUnidade PRIMARY KEY CLUSTERED (IdUsuario, IdUnidade),
        CONSTRAINT FK_CtlCnnUsuarioUnidade_Usuario FOREIGN KEY (IdUsuario) REFERENCES dbo.CtlCnnUsuario (IdUsuario),
        CONSTRAINT FK_CtlCnnUsuarioUnidade_Unidade FOREIGN KEY (IdUnidade) REFERENCES dbo.CtlCnnUnidade (IdUnidade)
    );
END;

COMMIT TRANSACTION;

/*
  Permissões do usuário da credencial SQL de PRODUÇÃO do n8n. Troque [usuario_n8n] pelo usuário do banco e rode:

  GRANT SELECT                         ON dbo.CtlCnnUnidade           TO [usuario_n8n];
  GRANT SELECT, INSERT, UPDATE         ON dbo.CtlCnnFaltaPaciente     TO [usuario_n8n];
  GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.CtlCnnFaltaProcedimento TO [usuario_n8n];
  GRANT SELECT, INSERT, UPDATE         ON dbo.CtlCnnCadastro          TO [usuario_n8n];
  GRANT SELECT, INSERT, UPDATE         ON dbo.CtlCnnControlePaciente  TO [usuario_n8n];
  GRANT SELECT, INSERT                 ON dbo.CtlCnnAcaoPaciente      TO [usuario_n8n];
  GRANT SELECT, INSERT, UPDATE         ON dbo.CtlCnnSolicitacao       TO [usuario_n8n];
  GRANT SELECT, INSERT, UPDATE         ON dbo.CtlCnnUsuario           TO [usuario_n8n];
  GRANT SELECT, INSERT                 ON dbo.CtlCnnUsuarioEvento     TO [usuario_n8n];
  GRANT SELECT, INSERT, DELETE         ON dbo.CtlCnnUsuarioUnidade    TO [usuario_n8n];
*/

-- Conferência: 10 tabelas, 2 unidades e os índices criados.
SELECT
    t.name AS Tabela,
    (SELECT COUNT(*) FROM sys.columns c WHERE c.object_id = t.object_id) AS Colunas,
    (SELECT COUNT(*) FROM sys.indexes i WHERE i.object_id = t.object_id AND i.index_id > 0) AS Indices,
    (SELECT SUM(p.rows) FROM sys.partitions p WHERE p.object_id = t.object_id AND p.index_id IN (0, 1)) AS Linhas
FROM sys.tables t
WHERE t.name LIKE N'CtlCnn%'
ORDER BY t.name;

SELECT
    u.IdUnidade,
    u.Codigo,
    u.Nome,
    u.Ativa,
    N'CNN_CID_' + u.Codigo AS VariavelNoN8n
FROM dbo.CtlCnnUnidade u
ORDER BY u.IdUnidade;
