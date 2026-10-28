/*
  Usuários do painel e eventos de usuário. Rodar no banco INTEGRACAO (SSMS ou nó executeQuery do n8n).
  Pode rodar mais de uma vez: cada passo confere antes de agir e nada é apagado.
  Sem GO: o driver do n8n não entende GO (isso é do SSMS).

  - dbo.CtlCnnUsuario: um usuário por linha, com perfil (LEITOR, EDITOR, ADMIN) e o hash scrypt da senha.
    A senha em texto nunca chega aqui: a Vercel gera salt e hash e o n8n só grava.
  - dbo.CtlCnnUsuarioEvento: auditoria de usuários (criação, perfil, senha, falhas de login). Só recebe INSERT.

  O primeiro admin é inserido à mão: rode `npm run admin` e cole no SSMS o INSERT que ele imprime.
*/

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
            N'SENHA_REDEFINIDA', N'SENHA_TROCADA', N'LOGIN_FALHA', N'LOGIN_BLOQUEADO'
        ))
    );
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = N'IX_CtlCnnUsuarioEvento_CriadoEm'
      AND object_id = OBJECT_ID(N'dbo.CtlCnnUsuarioEvento')
)
BEGIN
    EXEC (N'
        CREATE NONCLUSTERED INDEX IX_CtlCnnUsuarioEvento_CriadoEm
            ON dbo.CtlCnnUsuarioEvento (CriadoEm DESC)
            INCLUDE (Login, Evento, Por);
    ');
END;

/*
  Permissões do login usado pela credencial "TST Araguari - Integracao" no n8n (troque o nome do usuário do banco):

  GRANT SELECT, INSERT, UPDATE ON dbo.CtlCnnUsuario TO [usuario_n8n];
  GRANT SELECT, INSERT ON dbo.CtlCnnUsuarioEvento TO [usuario_n8n];
*/

SELECT
    DB_NAME() AS Banco,
    t.name AS Tabela,
    (SELECT COUNT(*) FROM sys.columns c WHERE c.object_id = t.object_id) AS QuantidadeColunas
FROM sys.tables t
WHERE t.object_id IN (
    OBJECT_ID(N'dbo.CtlCnnUsuario'),
    OBJECT_ID(N'dbo.CtlCnnUsuarioEvento')
)
ORDER BY t.name;
