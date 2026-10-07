// Nó "ids da consulta" (bloqueio às 01:00). Monta a consulta do nó "consultar bloqueios":
// a falta vigente (MAX(NumeroFalta) no ciclo) de cada paciente do lote.
// Fica de fora quem foi liberado pelo painel com essa mesma falta vigente: o bloqueio não desfaz a liberação manual.
// Uma falta nova muda a vigente, e o paciente volta a ser bloqueado normalmente.
const fonteInsert = $('preparar insert SQL');

if (!fonteInsert.isExecuted) {
  return [];
}

const ids = fonteInsert.first()?.json?.idsPacientes ?? [];
const listaIds = Array.isArray(ids)
  ? ids.map((id) => Number(id)).filter((id) => Number.isFinite(id)).join(', ')
  : '';

if (!listaIds) {
  return [];
}

const inicioPeriodo = fonteInsert.first()?.json?.dataInicioPeriodo || inicioCiclo();

const query = `USE INTEGRACAO;

SELECT
    f.IdAgenda,
    f.IdPaciente,
    f.NomePaciente,
    f.DataFalta,
    f.NumeroFalta,
    ctl.Situacao AS SituacaoControle,
    ctl.IdAgendaReferencia
FROM dbo.CtlCnnFaltaPaciente f
LEFT JOIN dbo.CtlCnnControlePaciente ctl
    ON ctl.IdPaciente = f.IdPaciente
INNER JOIN (
    SELECT
        IdPaciente,
        MAX(NumeroFalta) AS NumeroFalta
    FROM dbo.CtlCnnFaltaPaciente
    WHERE IdPaciente IN (${listaIds})
      AND DataFalta >= CONVERT(date, '${inicioPeriodo}', 23)
    GROUP BY IdPaciente
) atual
    ON atual.IdPaciente = f.IdPaciente
   AND atual.NumeroFalta = f.NumeroFalta
WHERE f.DataFalta >= CONVERT(date, '${inicioPeriodo}', 23)
  AND NOT EXISTS (
        SELECT 1
        FROM dbo.CtlCnnControlePaciente c
        WHERE c.IdPaciente = f.IdPaciente
          AND c.Situacao = N'LIBERADO'
          AND c.IdAgendaReferencia = f.IdAgenda
  );`;

return [{
  json: {
    query,
    listaIds,
    idsPacientes: ids,
    dataInicioPeriodo: inicioPeriodo
  }
}];
