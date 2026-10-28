// Nó "preparar consulta" (liberação automática às 02:00). Monta a consulta de quem cumpriu o prazo.
// Só entra quem o PRÓPRIO sistema bloqueou: controle BLOQUEADO para a falta vigente de agora.
// Paciente inativo no CNN por outro motivo (baixa cadastral, por exemplo) não tem essa linha e nunca é reativado.
// Todas as unidades ativas numa consulta só: cada linha traz IdUnidade e o código (o header do CNN lê o CID por ele).
const inicio = inicioCiclo();
const hoje = hojeSp();

const query = `USE INTEGRACAO;
SET NOCOUNT ON;
DECLARE @inicio DATE = ${sqlDate(inicio)};
DECLARE @hoje DATE = ${sqlDate(hoje)};

;WITH Vigente AS (
    SELECT
        f.IdUnidade,
        f.IdPaciente,
        f.IdAgenda,
        f.NomePaciente,
        f.DataFalta,
        f.NumeroFalta,
        ROW_NUMBER() OVER (
            PARTITION BY f.IdUnidade, f.IdPaciente
            ORDER BY CASE WHEN f.DataFalta >= @inicio THEN 0 ELSE 1 END, f.NumeroFalta DESC, f.DataFalta DESC, f.IdAgenda DESC
        ) AS Ordem
    FROM dbo.CtlCnnFaltaPaciente f
    WHERE EXISTS (
        SELECT 1
        FROM dbo.CtlCnnControlePaciente b
        WHERE b.IdUnidade = f.IdUnidade
          AND b.IdPaciente = f.IdPaciente
          AND b.Situacao = N'BLOQUEADO'
    )
)
SELECT
    c.IdUnidade,
    u.Codigo AS CodigoUnidade,
    c.IdPaciente,
    COALESCE(c.NomePaciente, v.NomePaciente) AS NomePaciente,
    v.IdAgenda,
    CONVERT(char(10), v.DataFalta, 23) AS DataFalta,
    v.NumeroFalta,
    ${sqlDiasCase('v.NumeroFalta')} AS DiasBloqueio,
    CONVERT(char(10), DATEADD(DAY, ${sqlDiasCase('v.NumeroFalta')}, v.DataFalta), 23) AS DataFimBloqueio
FROM dbo.CtlCnnControlePaciente c
INNER JOIN dbo.CtlCnnUnidade u
    ON u.IdUnidade = c.IdUnidade
   AND u.Ativa = 1
INNER JOIN Vigente v
    ON v.IdUnidade = c.IdUnidade
   AND v.IdPaciente = c.IdPaciente
   AND v.Ordem = 1
WHERE c.Situacao = N'BLOQUEADO'
  AND c.IdAgendaReferencia = v.IdAgenda
  AND DATEADD(DAY, ${sqlDiasCase('v.NumeroFalta')}, v.DataFalta) < @hoje
ORDER BY c.IdUnidade, v.DataFalta, c.IdPaciente;`;

return [{ json: { query, hoje } }];
