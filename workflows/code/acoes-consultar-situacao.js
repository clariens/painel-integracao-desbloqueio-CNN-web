// Nó "consultar situação" (workflow CNN Painel - Ações). Monta a consulta do paciente:
// sempre devolve uma linha, com a falta vigente (se houver), as contagens e a linha de controle.
// Vigente = maior NumeroFalta do ciclo; sem falta no ciclo, a falta mais recente de antes dele.
const validar = $('Validar').first().json;
const id = sqlN(validar.id);
const inicio = sqlDate(validar.inicioCiclo);

// Liberação a partir de uma solicitação: traz a solicitação junto (decidir confere paciente, falta e status).
const colunasSolicitacao = validar.idSolicitacao
  ? `,
    s.Id AS SolicitacaoId,
    s.IdPaciente AS SolicitacaoIdPaciente,
    s.Status AS SolicitacaoStatus,
    s.IdAgendaReferencia AS SolicitacaoIdAgenda,
    s.Motivo AS SolicitacaoMotivo,
    s.SolicitadoPor AS SolicitacaoPor`
  : '';
const juntaSolicitacao = validar.idSolicitacao
  ? `
LEFT JOIN dbo.CtlCnnSolicitacao s
    ON s.Id = ${sqlN(validar.idSolicitacao)}`
  : '';

const query = `USE INTEGRACAO;
SET NOCOUNT ON;

SELECT
    CAST(${id} AS bigint) AS IdPaciente,
    v.IdAgenda,
    v.NomePaciente,
    CONVERT(char(10), v.DataFalta, 23) AS DataFalta,
    v.NumeroFalta,
    CAST(CASE WHEN v.DataFalta >= ${inicio} THEN 1 ELSE 0 END AS bit) AS VigenteNoCiclo,
    (SELECT COUNT(*) FROM dbo.CtlCnnFaltaPaciente WHERE IdPaciente = ${id} AND DataFalta >= ${inicio}) AS FaltasCiclo,
    (SELECT COUNT(*) FROM dbo.CtlCnnFaltaPaciente WHERE IdPaciente = ${id}) AS FaltasTotal,
    c.Situacao,
    c.IdAgendaReferencia${colunasSolicitacao}
FROM (SELECT 1 AS base) b
OUTER APPLY (
    SELECT TOP (1) f.IdAgenda, f.NomePaciente, f.DataFalta, f.NumeroFalta
    FROM dbo.CtlCnnFaltaPaciente f
    WHERE f.IdPaciente = ${id}
    ORDER BY
        CASE WHEN f.DataFalta >= ${inicio} THEN 0 ELSE 1 END,
        f.NumeroFalta DESC,
        f.DataFalta DESC,
        f.IdAgenda DESC
) v
LEFT JOIN dbo.CtlCnnControlePaciente c
    ON c.IdPaciente = ${id}${juntaSolicitacao};`;

return [{ json: { query } }];
