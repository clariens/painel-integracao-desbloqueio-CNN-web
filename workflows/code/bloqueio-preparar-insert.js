// Nó "preparar insert SQL" (bloqueio às 01:00 e botão Bloquear do painel).
// Monta o lote inteiro do nó "gravar faltas": um IF NOT EXISTS + INSERT por falta e a renumeração do ciclo.
const ehRespostaValida = (payload, campoId) => {
  return Boolean(payload && payload[campoId] != null && !payload.error && !payload.message);
};

const inicioPeriodo = inicioCiclo();
const faltas = $('separar faltas').all().filter((item) => !item.json.semFaltas);
const pacientes = $('GET paciente por id').all();
const executores = $input.all();

if (!faltas.length) {
  return [];
}

const inserts = faltas.map((item, indice) => {
  const falta = item.json ?? {};
  const paciente = pacientes[indice]?.json ?? {};
  const executor = executores[indice]?.json ?? {};
  const pacienteOk = ehRespostaValida(paciente, 'id');
  const executorOk = ehRespostaValida(executor, 'id');
  const contato = pacienteOk ? (paciente.contato ?? {}) : {};

  return `
IF NOT EXISTS (
    SELECT 1
    FROM dbo.CtlCnnFaltaPaciente
    WHERE IdAgenda = ${sqlN(falta.id)}
)
BEGIN
    INSERT INTO dbo.CtlCnnFaltaPaciente (
        IdAgenda,
        IdPaciente,
        NomePaciente,
        CpfCnpj,
        EmailPaciente,
        TelefonePaciente,
        DataFalta,
        HoraInicio,
        HoraFim,
        StatusAgenda,
        IdPessoaExecutor,
        IdExecutorAgenda,
        NomeExecutor,
        TipoExecutor,
        IdLocalAgenda,
        IdTipoConsulta,
        Observacoes,
        NumeroFalta
    )
    SELECT
        ${sqlN(falta.id)},
        ${sqlN(falta.idPaciente)},
        ${sqlS(pacienteOk ? paciente.nome : null, 200)},
        ${sqlS(pacienteOk ? paciente.cpfcnpj : null, 20)},
        ${sqlS(contato.email || falta.emailPaciente, 200)},
        ${sqlS(contato.telefoneCelular || falta.telefoneCelularPaciente, 30)},
        ${sqlDate(falta.dataFalta || falta.data)},
        ${sqlTime(falta.horaInicio)},
        ${sqlTime(falta.horaFim)},
        ${sqlS(falta.status, 50)},
        ${sqlN(falta.idPessoaExecutor)},
        ${sqlN(executorOk ? executor.id : null)},
        ${sqlS(executorOk ? executor.nome : null, 200)},
        ${sqlS(executorOk ? executor.tipoExecutor : null, 50)},
        ${sqlN(falta.idLocalAgenda)},
        ${sqlN(falta.idTipoConsulta)},
        ${sqlS(falta.observacoes, 500)},
        ISNULL((
            SELECT COUNT(1)
            FROM dbo.CtlCnnFaltaPaciente
            WHERE IdPaciente = ${sqlN(falta.idPaciente)}
              AND DataFalta >= CONVERT(date, '${inicioPeriodo}', 23)
        ), 0) + 1;
END`;
}).join('\n');

const idsPacientes = [...new Set(
  faltas
    .map((item) => Number(item.json.idPaciente))
    .filter((id) => Number.isFinite(id))
)];
const listaIds = idsPacientes.join(', ');

// Depois dos inserts, reordena NumeroFalta por data dentro do ciclo (uma falta antiga pode chegar depois de uma nova).
const query = `USE INTEGRACAO;
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;

${inserts}

;WITH Numeracao AS (
    SELECT
        Id,
        ROW_NUMBER() OVER (
            PARTITION BY IdPaciente
            ORDER BY DataFalta, IdAgenda
        ) AS NumeroCalculado
    FROM dbo.CtlCnnFaltaPaciente
    WHERE IdPaciente IN (${listaIds})
      AND DataFalta >= CONVERT(date, '${inicioPeriodo}', 23)
)
UPDATE destino
SET NumeroFalta = origem.NumeroCalculado
FROM dbo.CtlCnnFaltaPaciente AS destino
INNER JOIN Numeracao AS origem
    ON origem.Id = destino.Id
WHERE destino.NumeroFalta <> origem.NumeroCalculado;

COMMIT TRANSACTION;

SELECT CAST(${faltas.length} AS int) AS faltasProcessadas;`;

return [{
  json: {
    query,
    quantidadeFaltas: faltas.length,
    dataInicioPeriodo: inicioPeriodo,
    idsPacientes,
    listaIds
  }
}];
