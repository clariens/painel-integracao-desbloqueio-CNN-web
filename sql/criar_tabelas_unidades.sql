/*
  Unidades (multiunidade). Rodar no banco INTEGRACAO (SSMS ou nó executeQuery do n8n), DEPOIS dos outros
  scripts (bloqueio, painel, solicitações e usuários) e ANTES de colar os workflows novos.
  Pode rodar mais de uma vez: cada passo confere antes de agir e nada é apagado.
  Sem GO: o driver do n8n não entende GO (isso é do SSMS).

  - dbo.CtlCnnUnidade: as unidades (clínicas do CNN). O CID de cada uma NÃO fica aqui: fica na variável
    CNN_CID_<Codigo> das Variables do n8n (ex.: CNN_CID_ZARNS_SALVADOR).
  - dbo.CtlCnnUsuarioUnidade: as unidades que cada usuário LEITOR/EDITOR acessa. O ADMIN acessa todas e não tem linha.
  - IdUnidade nas tabelas de dados (faltas, procedimentos, cadastros, controle, auditoria e solicitações).
    O que já existe vira Salvador (IdUnidade = 1, o DEFAULT).
  - Chaves e índices passam a começar por IdUnidade: o mesmo IdPaciente/IdAgenda pode existir nas duas clínicas.
  - Usuários LEITOR/EDITOR sem unidade ficam ligados a Salvador.
*/

SET XACT_ABORT ON;

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
    (CAST(2 AS SMALLINT), N'ZARNS_POUSO_ALEGRE', N'Clínica Escola Zarns Pouso Alegre')
) AS novas (IdUnidade, Codigo, Nome)
WHERE NOT EXISTS (SELECT 1 FROM dbo.CtlCnnUnidade u WHERE u.IdUnidade = novas.IdUnidade);

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

-- IdUnidade nas tabelas de dados. NOT NULL com DEFAULT 1: as linhas que já existem ficam em Salvador.
DECLARE @tabelas TABLE (Tabela SYSNAME PRIMARY KEY);
INSERT INTO @tabelas (Tabela) VALUES
    (N'CtlCnnFaltaPaciente'),
    (N'CtlCnnFaltaProcedimento'),
    (N'CtlCnnCadastro'),
    (N'CtlCnnControlePaciente'),
    (N'CtlCnnAcaoPaciente'),
    (N'CtlCnnSolicitacao');

DECLARE @tabela SYSNAME, @sql NVARCHAR(MAX);
DECLARE tabelas CURSOR LOCAL FAST_FORWARD FOR SELECT Tabela FROM @tabelas;
OPEN tabelas;
FETCH NEXT FROM tabelas INTO @tabela;
WHILE @@FETCH_STATUS = 0
BEGIN
    IF COL_LENGTH(N'dbo.' + @tabela, N'IdUnidade') IS NULL
    BEGIN
        SET @sql = N'ALTER TABLE dbo.' + QUOTENAME(@tabela) + N' ADD IdUnidade SMALLINT NOT NULL '
            + N'CONSTRAINT ' + QUOTENAME(N'DF_' + @tabela + N'_IdUnidade') + N' DEFAULT 1 WITH VALUES;';
        EXEC sys.sp_executesql @sql;
    END;

    IF OBJECT_ID(N'dbo.FK_' + @tabela + N'_Unidade', N'F') IS NULL
    BEGIN
        SET @sql = N'ALTER TABLE dbo.' + QUOTENAME(@tabela) + N' ADD CONSTRAINT ' + QUOTENAME(N'FK_' + @tabela + N'_Unidade')
            + N' FOREIGN KEY (IdUnidade) REFERENCES dbo.CtlCnnUnidade (IdUnidade);';
        EXEC sys.sp_executesql @sql;
    END;

    FETCH NEXT FROM tabelas INTO @tabela;
END;
CLOSE tabelas;
DEALLOCATE tabelas;

/*
  Chaves e índices com IdUnidade na frente. Mesmo nome de antes, para os scripts antigos (que conferem pelo nome)
  não recriarem a versão sem unidade. Se o índice existe sem IdUnidade, é apagado e recriado; se já tem, nada muda.
  Tipo: PK (chave primária), UQ (constraint UNIQUE) ou IX (índice).
*/
DECLARE @indices TABLE (
    Ordem       INT IDENTITY(1, 1) PRIMARY KEY,
    Tabela      SYSNAME NOT NULL,
    Nome        SYSNAME NOT NULL,
    Tipo        CHAR(2) NOT NULL,
    Definicao   NVARCHAR(1000) NOT NULL
);
INSERT INTO @indices (Tabela, Nome, Tipo, Definicao) VALUES
    (N'CtlCnnFaltaPaciente', N'UQ_CtlCnnFaltaPaciente_IdAgenda', 'UQ',
        N'UNIQUE (IdUnidade, IdAgenda)'),
    (N'CtlCnnFaltaPaciente', N'IX_CtlCnnFaltaPaciente_IdPaciente_NumeroFalta', 'IX',
        N'NONCLUSTERED INDEX # ON dbo.CtlCnnFaltaPaciente (IdUnidade, IdPaciente, NumeroFalta) INCLUDE (DataFalta, StatusAgenda, NomePaciente, IdAgenda)'),
    (N'CtlCnnFaltaPaciente', N'IX_CtlCnnFaltaPaciente_DataFalta', 'IX',
        N'NONCLUSTERED INDEX # ON dbo.CtlCnnFaltaPaciente (IdUnidade, DataFalta) INCLUDE (IdPaciente, NumeroFalta, NomePaciente, NomeExecutor, IdAgenda)'),
    (N'CtlCnnFaltaProcedimento', N'PK_CtlCnnFaltaProcedimento', 'PK',
        N'PRIMARY KEY CLUSTERED (IdUnidade, IdAgenda, IdTipoProcedimento)'),
    (N'CtlCnnCadastro', N'PK_CtlCnnCadastro', 'PK',
        N'PRIMARY KEY CLUSTERED (IdUnidade, Tipo, Id)'),
    (N'CtlCnnControlePaciente', N'PK_CtlCnnControlePaciente', 'PK',
        N'PRIMARY KEY CLUSTERED (IdUnidade, IdPaciente)'),
    (N'CtlCnnControlePaciente', N'IX_CtlCnnControlePaciente_Situacao', 'IX',
        N'NONCLUSTERED INDEX # ON dbo.CtlCnnControlePaciente (IdUnidade, Situacao) INCLUDE (IdAgendaReferencia)'),
    (N'CtlCnnAcaoPaciente', N'IX_CtlCnnAcaoPaciente_IdPaciente_CriadoEm', 'IX',
        N'NONCLUSTERED INDEX # ON dbo.CtlCnnAcaoPaciente (IdUnidade, IdPaciente, CriadoEm DESC)'),
    (N'CtlCnnAcaoPaciente', N'IX_CtlCnnAcaoPaciente_CriadoEm', 'IX',
        N'NONCLUSTERED INDEX # ON dbo.CtlCnnAcaoPaciente (IdUnidade, CriadoEm DESC) INCLUDE (IdPaciente, Acao, Origem, Usuario, Sucesso)'),
    (N'CtlCnnSolicitacao', N'UX_CtlCnnSolicitacao_Aberta', 'IX',
        N'UNIQUE NONCLUSTERED INDEX # ON dbo.CtlCnnSolicitacao (IdUnidade, IdPaciente) WHERE Status IN (N''PENDENTE'', N''APROVADA'')'),
    (N'CtlCnnSolicitacao', N'IX_CtlCnnSolicitacao_Status_SolicitadoEm', 'IX',
        N'NONCLUSTERED INDEX # ON dbo.CtlCnnSolicitacao (IdUnidade, Status, SolicitadoEm DESC)'),
    (N'CtlCnnSolicitacao', N'IX_CtlCnnSolicitacao_IdPaciente_SolicitadoEm', 'IX',
        N'NONCLUSTERED INDEX # ON dbo.CtlCnnSolicitacao (IdUnidade, IdPaciente, SolicitadoEm DESC)');

DECLARE @nome SYSNAME, @tipo CHAR(2), @definicao NVARCHAR(1000), @existe BIT, @temUnidade BIT;
DECLARE indices CURSOR LOCAL FAST_FORWARD FOR SELECT Tabela, Nome, Tipo, Definicao FROM @indices ORDER BY Ordem;
OPEN indices;
FETCH NEXT FROM indices INTO @tabela, @nome, @tipo, @definicao;
WHILE @@FETCH_STATUS = 0
BEGIN
    SELECT
        @existe = CASE WHEN i.index_id IS NULL THEN 0 ELSE 1 END,
        @temUnidade = CASE WHEN EXISTS (
            SELECT 1
            FROM sys.index_columns ic
            INNER JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
            WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND c.name = N'IdUnidade'
        ) THEN 1 ELSE 0 END
    FROM (SELECT 1 AS um) AS x
    LEFT JOIN sys.indexes i ON i.object_id = OBJECT_ID(N'dbo.' + @tabela) AND i.name = @nome;

    IF @existe = 0 OR @temUnidade = 0
    BEGIN
        BEGIN TRANSACTION;

        IF @existe = 1
        BEGIN
            SET @sql = CASE WHEN @tipo IN ('PK', 'UQ')
                THEN N'ALTER TABLE dbo.' + QUOTENAME(@tabela) + N' DROP CONSTRAINT ' + QUOTENAME(@nome) + N';'
                ELSE N'DROP INDEX ' + QUOTENAME(@nome) + N' ON dbo.' + QUOTENAME(@tabela) + N';'
            END;
            EXEC sys.sp_executesql @sql;
        END;

        SET @sql = CASE WHEN @tipo IN ('PK', 'UQ')
            THEN N'ALTER TABLE dbo.' + QUOTENAME(@tabela) + N' ADD CONSTRAINT ' + QUOTENAME(@nome) + N' ' + @definicao + N';'
            ELSE N'CREATE ' + REPLACE(@definicao, N'#', QUOTENAME(@nome)) + N';'
        END;
        EXEC sys.sp_executesql @sql;

        COMMIT TRANSACTION;
    END;

    FETCH NEXT FROM indices INTO @tabela, @nome, @tipo, @definicao;
END;
CLOSE indices;
DEALLOCATE indices;

-- Evento novo na auditoria de usuários: troca das unidades de um usuário.
IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = N'CK_CtlCnnUsuarioEvento_Evento'
      AND parent_object_id = OBJECT_ID(N'dbo.CtlCnnUsuarioEvento')
      AND definition LIKE N'%UNIDADES_ALTERADAS%'
)
BEGIN
    BEGIN TRANSACTION;
    IF OBJECT_ID(N'dbo.CK_CtlCnnUsuarioEvento_Evento', N'C') IS NOT NULL
        ALTER TABLE dbo.CtlCnnUsuarioEvento DROP CONSTRAINT CK_CtlCnnUsuarioEvento_Evento;
    ALTER TABLE dbo.CtlCnnUsuarioEvento ADD CONSTRAINT CK_CtlCnnUsuarioEvento_Evento CHECK (Evento IN (
        N'CRIADO', N'PERFIL_ALTERADO', N'NOME_ALTERADO', N'DESATIVADO', N'REATIVADO',
        N'SENHA_REDEFINIDA', N'SENHA_TROCADA', N'LOGIN_FALHA', N'LOGIN_BLOQUEADO', N'UNIDADES_ALTERADAS'
    ));
    COMMIT TRANSACTION;
END;

-- Quem já existe (LEITOR/EDITOR) e ainda não tem unidade continua vendo o que via: Salvador.
INSERT INTO dbo.CtlCnnUsuarioUnidade (IdUsuario, IdUnidade)
SELECT u.IdUsuario, 1
FROM dbo.CtlCnnUsuario u
WHERE u.Perfil <> N'ADMIN'
  AND NOT EXISTS (SELECT 1 FROM dbo.CtlCnnUsuarioUnidade uu WHERE uu.IdUsuario = u.IdUsuario);

/*
  Permissões do login usado pela credencial SQL do n8n (troque o nome do usuário do banco):

  GRANT SELECT ON dbo.CtlCnnUnidade TO [usuario_n8n];
  GRANT SELECT, INSERT, DELETE ON dbo.CtlCnnUsuarioUnidade TO [usuario_n8n];
*/

SELECT
    u.IdUnidade,
    u.Codigo,
    u.Nome,
    u.Ativa,
    N'CNN_CID_' + u.Codigo AS VariavelNoN8n,
    (SELECT COUNT(*) FROM dbo.CtlCnnUsuarioUnidade uu WHERE uu.IdUnidade = u.IdUnidade) AS UsuariosLigados
FROM dbo.CtlCnnUnidade u
ORDER BY u.IdUnidade;
