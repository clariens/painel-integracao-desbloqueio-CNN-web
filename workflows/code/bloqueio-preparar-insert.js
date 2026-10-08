// Nó "preparar insert SQL" (bloqueio às 01:00 e botão Bloquear do painel).
// Monta uma query só para o nó "gravar faltas" (o nó Microsoft SQL roda só a query do 1º item), numa transação:
//   1. cadastros (nomes de tipo de consulta, profissional, rótulo, local, especialidade): MERGE em CtlCnnCadastro;
//   2. todas as faltas lidas vão para a tabela temporária #faltas (INSERT de até 1000 linhas por vez);
//   3. falta já gravada: UPDATE dos dados da agenda (tipo de consulta, rótulo, profissional, local, horário),
//      que podem mudar no CNN; dados do paciente só completam o que estiver vazio;
//   4. falta nova: INSERT (NumeroFalta provisório 0, acertado no passo 6);
//   5. procedimentos das faltas lidas: apaga e grava de novo (CtlCnnFaltaProcedimento);
//   6. renumera NumeroFalta por data no ciclo, para os pacientes lidos.
// Profissional: a agenda traz idPessoaExecutor, que é o "idpessoa" da lista /executor-agenda/lista
// (não o "id" do executor; por isso o GET /executor-agenda/{id} antigo nunca achava ninguém).
const inicioPeriodo = inicioCiclo();
const faltas = $('separar faltas').all().filter((item) => !item.json.semFaltas).map((item) => item.json ?? {});

if (!faltas.length) {
  return [];
}

// Pacientes por id (o GET roda uma vez por paciente, no nó "pacientes únicos").
const pacientes = new Map();
for (const item of itensDoNo('GET paciente por id')) {
  const paciente = item.json ?? {};
  const id = Number(paciente.id);
  if (Number.isFinite(id) && !paciente.error && !paciente.message) {
    pacientes.set(id, paciente);
  }
}

// Listas de cadastro. Nó que não existe neste workflow (Ações só lê executores) ou que falhou: lista vazia.
const executores = listaDaApi(itensDoNo('GET executores'));
const executorPorPessoa = new Map();
for (const executor of executores) {
  const idPessoa = Number(executor.idpessoa);
  if (Number.isFinite(idPessoa)) {
    executorPorPessoa.set(idPessoa, executor);
  }
}

const cadastros = [
  ...listaDaApi(itensDoNo('GET tipos de consulta')).map((t) => ({ tipo: 'TIPO_CONSULTA', id: t.id, nome: t.nome, extra: t.reconsulta === true ? 'RECONSULTA' : null })),
  ...executores.map((e) => ({ tipo: 'EXECUTOR', id: e.idpessoa, nome: e.nome, extra: e.tipoExecutor || null })),
  ...listaDaApi(itensDoNo('GET rótulos')).map((r) => ({ tipo: 'ROTULO', id: r.id, nome: r.nome, extra: r.corRotulo || null })),
  ...listaDaApi(itensDoNo('GET locais')).map((l) => ({ tipo: 'LOCAL_AGENDA', id: l.id, nome: l.nome, extra: null })),
  ...listaDaApi(itensDoNo('GET especialidades')).map((e) => ({ tipo: 'ESPECIALIDADE', id: e.id, nome: e.nome, extra: null })),
];

// Procedimentos de uma falta, sem repetir o mesmo tipo (soma a quantidade).
const procedimentosDe = (falta) => {
  const porTipo = new Map();
  for (const proc of Array.isArray(falta.procedimentos) ? falta.procedimentos : []) {
    const idTipo = Number(proc?.idTipoProcedimento);
    if (!Number.isFinite(idTipo)) {
      continue;
    }
    const atual = porTipo.get(idTipo);
    const quantidade = Number(proc.quantidade) || 1;
    if (atual) {
      atual.quantidade += quantidade;
    } else {
      porTipo.set(idTipo, { idTipo, nome: proc.nome, idEspecialidade: proc.idEspecialidade, quantidade });
    }
  }
  return [...porTipo.values()];
};

// A mesma falta pode aparecer duas vezes se a agenda mudar entre uma página e outra: fica a última.
const porAgenda = new Map();
for (const falta of faltas) {
  if (sqlN(falta.id) !== 'NULL') {
    porAgenda.set(Number(falta.id), falta);
  }
}

const linhaFalta = (falta) => {
  const paciente = pacientes.get(Number(falta.idPaciente)) || null;
  const contato = paciente?.contato ?? {};
  const executor = executorPorPessoa.get(Number(falta.idPessoaExecutor)) || null;

  return `(${[
    sqlN(falta.id),
    sqlN(falta.idPaciente),
    sqlS(paciente ? paciente.nome : null, 200),
    sqlS(paciente ? paciente.cpfcnpj : null, 20),
    sqlS(contato.email || falta.emailPaciente, 200),
    sqlS(contato.telefoneCelular || falta.telefoneCelularPaciente, 30),
    sqlDate(falta.dataFalta || falta.data),
    sqlTime(falta.horaInicio),
    sqlTime(falta.horaFim),
    sqlS(falta.status, 50),
    sqlN(falta.idPessoaExecutor),
    sqlN(executor ? executor.id : null),
    sqlS(executor ? executor.nome : null, 200),
    sqlS(executor ? executor.tipoExecutor : null, 50),
    sqlN(falta.idLocalAgenda),
    sqlN(falta.idTipoConsulta),
    sqlN(falta.idRotulo),
    sqlS(falta.observacoes, 500),
  ].join(', ')})`;
};

const emBlocos = (linhas, tamanho, montar) => {
  const blocos = [];
  for (let i = 0; i < linhas.length; i += tamanho) {
    blocos.push(montar(linhas.slice(i, i + tamanho)));
  }
  return blocos.join('\n');
};

const linhasFaltas = [...porAgenda.values()].map(linhaFalta);
const linhasProcedimentos = [...porAgenda.values()].flatMap((falta) =>
  procedimentosDe(falta).map((proc) =>
    `(${sqlN(falta.id)}, ${sqlN(proc.idTipo)}, ${sqlS(proc.nome, 200)}, ${sqlN(proc.idEspecialidade)}, ${sqlN(proc.quantidade)})`
  )
);

const idsPacientes = [...new Set(faltas.map((falta) => Number(falta.idPaciente)).filter((id) => Number.isFinite(id)))];

const query = `USE INTEGRACAO;
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
${sqlCadastros(cadastros)}

IF OBJECT_ID(N'tempdb..#faltas') IS NOT NULL
    DROP TABLE #faltas;

CREATE TABLE #faltas (
    IdAgenda BIGINT NOT NULL PRIMARY KEY,
    IdPaciente BIGINT NOT NULL,
    NomePaciente NVARCHAR(200) NULL,
    CpfCnpj NVARCHAR(20) NULL,
    EmailPaciente NVARCHAR(200) NULL,
    TelefonePaciente NVARCHAR(30) NULL,
    DataFalta DATE NOT NULL,
    HoraInicio TIME(0) NULL,
    HoraFim TIME(0) NULL,
    StatusAgenda NVARCHAR(50) NOT NULL,
    IdPessoaExecutor BIGINT NULL,
    IdExecutorAgenda BIGINT NULL,
    NomeExecutor NVARCHAR(200) NULL,
    TipoExecutor NVARCHAR(50) NULL,
    IdLocalAgenda BIGINT NULL,
    IdTipoConsulta BIGINT NULL,
    IdRotulo BIGINT NULL,
    Observacoes NVARCHAR(500) NULL
);

${emBlocos(linhasFaltas, 1000, (bloco) => `INSERT INTO #faltas VALUES
    ${bloco.join(',\n    ')};`)}

UPDATE destino
SET
    HoraInicio = origem.HoraInicio,
    HoraFim = origem.HoraFim,
    IdPessoaExecutor = origem.IdPessoaExecutor,
    IdExecutorAgenda = COALESCE(origem.IdExecutorAgenda, destino.IdExecutorAgenda),
    NomeExecutor = COALESCE(origem.NomeExecutor, destino.NomeExecutor),
    TipoExecutor = COALESCE(origem.TipoExecutor, destino.TipoExecutor),
    IdLocalAgenda = origem.IdLocalAgenda,
    IdTipoConsulta = origem.IdTipoConsulta,
    IdRotulo = origem.IdRotulo,
    Observacoes = origem.Observacoes,
    NomePaciente = COALESCE(destino.NomePaciente, origem.NomePaciente),
    CpfCnpj = COALESCE(destino.CpfCnpj, origem.CpfCnpj),
    EmailPaciente = COALESCE(destino.EmailPaciente, origem.EmailPaciente),
    TelefonePaciente = COALESCE(destino.TelefonePaciente, origem.TelefonePaciente)
FROM dbo.CtlCnnFaltaPaciente AS destino
INNER JOIN #faltas AS origem
    ON origem.IdAgenda = destino.IdAgenda;

INSERT INTO dbo.CtlCnnFaltaPaciente (
    IdAgenda, IdPaciente, NomePaciente, CpfCnpj, EmailPaciente, TelefonePaciente,
    DataFalta, HoraInicio, HoraFim, StatusAgenda,
    IdPessoaExecutor, IdExecutorAgenda, NomeExecutor, TipoExecutor,
    IdLocalAgenda, IdTipoConsulta, IdRotulo, Observacoes, NumeroFalta
)
SELECT
    origem.IdAgenda, origem.IdPaciente, origem.NomePaciente, origem.CpfCnpj, origem.EmailPaciente, origem.TelefonePaciente,
    origem.DataFalta, origem.HoraInicio, origem.HoraFim, origem.StatusAgenda,
    origem.IdPessoaExecutor, origem.IdExecutorAgenda, origem.NomeExecutor, origem.TipoExecutor,
    origem.IdLocalAgenda, origem.IdTipoConsulta, origem.IdRotulo, origem.Observacoes, 0
FROM #faltas AS origem
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.CtlCnnFaltaPaciente f WHERE f.IdAgenda = origem.IdAgenda
);

DECLARE @novas INT = @@ROWCOUNT;

DELETE p
FROM dbo.CtlCnnFaltaProcedimento AS p
INNER JOIN #faltas AS origem
    ON origem.IdAgenda = p.IdAgenda;

${emBlocos(linhasProcedimentos, 1000, (bloco) => `INSERT INTO dbo.CtlCnnFaltaProcedimento (IdAgenda, IdTipoProcedimento, NomeProcedimento, IdEspecialidade, Quantidade)
VALUES
    ${bloco.join(',\n    ')};`)}

-- Reordena NumeroFalta por data dentro do ciclo (uma falta antiga pode chegar depois de uma nova; as novas entram com 0).
;WITH Numeracao AS (
    SELECT
        Id,
        ROW_NUMBER() OVER (
            PARTITION BY IdPaciente
            ORDER BY DataFalta, IdAgenda
        ) AS NumeroCalculado
    FROM dbo.CtlCnnFaltaPaciente
    WHERE IdPaciente IN (SELECT DISTINCT IdPaciente FROM #faltas)
      AND DataFalta >= CONVERT(date, '${inicioPeriodo}', 23)
)
UPDATE destino
SET NumeroFalta = origem.NumeroCalculado
FROM dbo.CtlCnnFaltaPaciente AS destino
INNER JOIN Numeracao AS origem
    ON origem.Id = destino.Id
WHERE destino.NumeroFalta <> origem.NumeroCalculado;

DROP TABLE #faltas;

COMMIT TRANSACTION;

SELECT CAST(${porAgenda.size} AS int) AS faltasLidas, @novas AS faltasNovas, CAST(${cadastros.length} AS int) AS cadastrosLidos;`;

return [{
  json: {
    query,
    quantidadeFaltas: porAgenda.size,
    quantidadeCadastros: cadastros.length,
    dataInicioPeriodo: inicioPeriodo,
    idsPacientes,
    listaIds: idsPacientes.join(', ')
  }
}];
