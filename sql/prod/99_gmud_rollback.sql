/*
  ClinicBoard — ROLLBACK da GMUD de produção (01_gmud_criar_estrutura.sql).

  Apaga as 10 tabelas do sistema. Só para desfazer a GMUD LOGO DEPOIS de rodar, antes de o sistema entrar em uso:
  se alguma tabela já tiver dados de uso (faltas, ações, solicitações ou mais de 1 usuário), o script para
  sem apagar nada. Uma transação só: ou apaga tudo, ou nada.
*/

USE INTEGRACAO;

SET NOCOUNT ON;
SET XACT_ABORT ON;

IF EXISTS (SELECT 1 FROM dbo.CtlCnnFaltaPaciente)
   OR EXISTS (SELECT 1 FROM dbo.CtlCnnAcaoPaciente)
   OR EXISTS (SELECT 1 FROM dbo.CtlCnnSolicitacao)
   OR EXISTS (SELECT 1 FROM dbo.CtlCnnControlePaciente)
   OR (SELECT COUNT(*) FROM dbo.CtlCnnUsuario) > 1
BEGIN
    RAISERROR (N'Rollback cancelado: as tabelas já têm dados de uso. Nada foi apagado.', 16, 1);
    RETURN;
END;

BEGIN TRANSACTION;

-- Ordem: primeiro quem aponta (FK), por último as tabelas apontadas.
IF OBJECT_ID(N'dbo.CtlCnnUsuarioUnidade', N'U') IS NOT NULL DROP TABLE dbo.CtlCnnUsuarioUnidade;
IF OBJECT_ID(N'dbo.CtlCnnUsuarioEvento', N'U') IS NOT NULL DROP TABLE dbo.CtlCnnUsuarioEvento;
IF OBJECT_ID(N'dbo.CtlCnnUsuario', N'U') IS NOT NULL DROP TABLE dbo.CtlCnnUsuario;
IF OBJECT_ID(N'dbo.CtlCnnSolicitacao', N'U') IS NOT NULL DROP TABLE dbo.CtlCnnSolicitacao;
IF OBJECT_ID(N'dbo.CtlCnnAcaoPaciente', N'U') IS NOT NULL DROP TABLE dbo.CtlCnnAcaoPaciente;
IF OBJECT_ID(N'dbo.CtlCnnControlePaciente', N'U') IS NOT NULL DROP TABLE dbo.CtlCnnControlePaciente;
IF OBJECT_ID(N'dbo.CtlCnnCadastro', N'U') IS NOT NULL DROP TABLE dbo.CtlCnnCadastro;
IF OBJECT_ID(N'dbo.CtlCnnFaltaProcedimento', N'U') IS NOT NULL DROP TABLE dbo.CtlCnnFaltaProcedimento;
IF OBJECT_ID(N'dbo.CtlCnnFaltaPaciente', N'U') IS NOT NULL DROP TABLE dbo.CtlCnnFaltaPaciente;
IF OBJECT_ID(N'dbo.CtlCnnUnidade', N'U') IS NOT NULL DROP TABLE dbo.CtlCnnUnidade;

COMMIT TRANSACTION;

SELECT COUNT(*) AS TabelasRestantes FROM sys.tables WHERE name LIKE N'CtlCnn%';
