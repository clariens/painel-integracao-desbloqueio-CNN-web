/*
  LIMPEZA TOTAL DOS DADOS (só em desenvolvimento). Apaga, sem volta:
    - faltas, procedimentos e cadastros coletados do CNN;
    - controle (situação de cada paciente), auditoria de ações e solicitações;
    - todos os usuários que NÃO são admin (com as unidades deles) e todo o histórico de eventos de usuário.

  Fica: as unidades (dbo.CtlCnnUnidade) e os usuários com perfil ADMIN.
  Os números (Id) recomeçam do 1 nas tabelas esvaziadas.

  Antes de rodar:
    1. desative no n8n os fluxos das 01:00 (bloqueio) e 02:00 (liberação), para não rodarem no meio;
    2. confira se está no banco certo (INTEGRACAO do ambiente de desenvolvimento).
  Depois: reative os fluxos. A coleta das 01:00 recomeça do início do ciclo (_regra.js).

  O script não faz nada se não houver pelo menos um admin ativo (para ninguém ficar sem acesso).
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

IF NOT EXISTS (SELECT 1 FROM dbo.CtlCnnUsuario WHERE Perfil = N'ADMIN' AND Ativo = 1)
BEGIN
    RAISERROR(N'Nenhum admin ativo: limpeza cancelada.', 16, 1);
    RETURN;
END;

-- Antes
SELECT N'antes' AS Momento,
    (SELECT COUNT(*) FROM dbo.CtlCnnFaltaPaciente)      AS Faltas,
    (SELECT COUNT(*) FROM dbo.CtlCnnFaltaProcedimento)  AS Procedimentos,
    (SELECT COUNT(*) FROM dbo.CtlCnnCadastro)           AS Cadastros,
    (SELECT COUNT(*) FROM dbo.CtlCnnControlePaciente)   AS Controle,
    (SELECT COUNT(*) FROM dbo.CtlCnnAcaoPaciente)       AS Acoes,
    (SELECT COUNT(*) FROM dbo.CtlCnnSolicitacao)        AS Solicitacoes,
    (SELECT COUNT(*) FROM dbo.CtlCnnUsuario)            AS Usuarios,
    (SELECT COUNT(*) FROM dbo.CtlCnnUsuarioUnidade)     AS UsuarioUnidades,
    (SELECT COUNT(*) FROM dbo.CtlCnnUsuarioEvento)      AS EventosUsuario;

BEGIN TRANSACTION;

    DELETE FROM dbo.CtlCnnAcaoPaciente;
    DELETE FROM dbo.CtlCnnSolicitacao;
    DELETE FROM dbo.CtlCnnControlePaciente;
    DELETE FROM dbo.CtlCnnFaltaProcedimento;
    DELETE FROM dbo.CtlCnnFaltaPaciente;
    DELETE FROM dbo.CtlCnnCadastro;

    DELETE FROM dbo.CtlCnnUsuarioEvento;
    DELETE uu
    FROM dbo.CtlCnnUsuarioUnidade uu
    JOIN dbo.CtlCnnUsuario u ON u.IdUsuario = uu.IdUsuario
    WHERE u.Perfil <> N'ADMIN';
    DELETE FROM dbo.CtlCnnUsuario WHERE Perfil <> N'ADMIN';

COMMIT TRANSACTION;

-- Ids recomeçam do 1 (precisa de permissão de dono/ddladmin; sem ela, só avisa e os dados já estão limpos).
BEGIN TRY
    DBCC CHECKIDENT ('dbo.CtlCnnFaltaPaciente', RESEED, 0) WITH NO_INFOMSGS;
    DBCC CHECKIDENT ('dbo.CtlCnnAcaoPaciente', RESEED, 0) WITH NO_INFOMSGS;
    DBCC CHECKIDENT ('dbo.CtlCnnSolicitacao', RESEED, 0) WITH NO_INFOMSGS;
    DBCC CHECKIDENT ('dbo.CtlCnnUsuarioEvento', RESEED, 0) WITH NO_INFOMSGS;
END TRY
BEGIN CATCH
    PRINT N'Aviso: os Ids não foram reiniciados (' + ERROR_MESSAGE() + N'). Os dados foram limpos mesmo assim.';
END CATCH;

-- Depois (tudo zerado, menos Usuarios e UsuarioUnidades, que ficam só com os admins)
SELECT N'depois' AS Momento,
    (SELECT COUNT(*) FROM dbo.CtlCnnFaltaPaciente)      AS Faltas,
    (SELECT COUNT(*) FROM dbo.CtlCnnFaltaProcedimento)  AS Procedimentos,
    (SELECT COUNT(*) FROM dbo.CtlCnnCadastro)           AS Cadastros,
    (SELECT COUNT(*) FROM dbo.CtlCnnControlePaciente)   AS Controle,
    (SELECT COUNT(*) FROM dbo.CtlCnnAcaoPaciente)       AS Acoes,
    (SELECT COUNT(*) FROM dbo.CtlCnnSolicitacao)        AS Solicitacoes,
    (SELECT COUNT(*) FROM dbo.CtlCnnUsuario)            AS Usuarios,
    (SELECT COUNT(*) FROM dbo.CtlCnnUsuarioUnidade)     AS UsuarioUnidades,
    (SELECT COUNT(*) FROM dbo.CtlCnnUsuarioEvento)      AS EventosUsuario;

SELECT Login, Nome, Perfil, Ativo FROM dbo.CtlCnnUsuario;
