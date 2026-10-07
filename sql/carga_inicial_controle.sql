/*
  Carga inicial de dbo.CtlCnnControlePaciente. Rodar UMA vez, no corte da liberação automática:
    1. execute a liberação automática (liberacaoPacientesFaltas) manualmente pela última vez;
    2. desative esse workflow no n8n;
    3. rode este script no banco INTEGRACAO.

  Para cada paciente com falta no ciclo atual, grava a situação que a automação deixou:
    - prazo da falta vigente ainda correndo  -> BLOQUEADO
    - prazo da falta vigente já vencido      -> LIBERADO (foi solto pela liberação automática)
  Origem = CARGA_INICIAL, sem linha de auditoria (não houve PATCH).

  Só insere quem ainda não tem linha no controle: rodar de novo não muda nada.
  Prazos 60/90/180 e início do ciclo em 1/8: os mesmos de workflows/code/_regra.js.
*/

SET NOCOUNT ON;

DECLARE @hoje DATE = CAST(DATEADD(HOUR, -3, SYSUTCDATETIME()) AS DATE); -- America/Sao_Paulo (sem horário de verão)
DECLARE @inicio DATE = DATEFROMPARTS(CASE WHEN MONTH(@hoje) >= 8 THEN YEAR(@hoje) ELSE YEAR(@hoje) - 1 END, 8, 1);

;WITH Ciclo AS (
    SELECT
        f.IdPaciente,
        f.IdAgenda,
        f.NomePaciente,
        f.DataFalta,
        f.NumeroFalta,
        ROW_NUMBER() OVER (
            PARTITION BY f.IdPaciente
            ORDER BY f.NumeroFalta DESC, f.DataFalta DESC, f.IdAgenda DESC
        ) AS Ordem
    FROM dbo.CtlCnnFaltaPaciente f
    WHERE f.DataFalta >= @inicio
),
Vigente AS (
    SELECT
        IdPaciente,
        IdAgenda,
        NomePaciente,
        DataFalta,
        NumeroFalta,
        DATEADD(
            DAY,
            CASE WHEN NumeroFalta >= 3 THEN 180 WHEN NumeroFalta = 2 THEN 90 ELSE 60 END,
            DataFalta
        ) AS DataFimBloqueio
    FROM Ciclo
    WHERE Ordem = 1
)
INSERT INTO dbo.CtlCnnControlePaciente (
    IdPaciente,
    NomePaciente,
    Situacao,
    IdAgendaReferencia,
    NumeroFalta,
    DataInicioBloqueio,
    DataFimBloqueio,
    UltimaAcao,
    OrigemUltimaAcao,
    UltimaAcaoPor,
    MotivoUltimaAcao
)
SELECT
    v.IdPaciente,
    v.NomePaciente,
    CASE WHEN v.DataFimBloqueio >= @hoje THEN N'BLOQUEADO' ELSE N'LIBERADO' END,
    v.IdAgenda,
    v.NumeroFalta,
    v.DataFalta,
    v.DataFimBloqueio,
    CASE WHEN v.DataFimBloqueio >= @hoje THEN N'BLOQUEIO' ELSE N'LIBERACAO' END,
    N'CARGA_INICIAL',
    N'carga-inicial',
    N'Situação deixada pela automação antes do painel.'
FROM Vigente v
WHERE NOT EXISTS (
    SELECT 1
    FROM dbo.CtlCnnControlePaciente c
    WHERE c.IdPaciente = v.IdPaciente
);

SELECT Situacao, COUNT(*) AS Pacientes
FROM dbo.CtlCnnControlePaciente
GROUP BY Situacao

ORDER BY Situacao;
