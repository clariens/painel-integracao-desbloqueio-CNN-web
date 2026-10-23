// Nó "Preparar consulta" (workflow CNN Painel - Leitura). Lê body.action, valida os parâmetros e monta o SQL.
// Cada SELECT leva a coluna _secao: o nó SQL junta os resultados num só array, e a resposta separa por ela.
const unwrap = (valor) => {
  if (typeof valor === 'string') {
    try {
      return JSON.parse(valor);
    } catch (erro) {
      return {};
    }
  }

  return valor && typeof valor === 'object' && !Array.isArray(valor) ? valor : {};
};

const item = unwrap($input.first().json);
const body = { ...item, ...unwrap(item.body) };
const action = String(body.action || '').trim();

const erro = (statusCode, mensagem) => [{
  json: { action: 'error', statusCode, response: { error: mensagem } }
}];
const safeDate = (valor) => (/^\d{4}-\d{2}-\d{2}$/.test(String(valor || '')) ? String(valor) : '');
const escolha = (valor, permitidos) => (permitidos.includes(String(valor || '')) ? String(valor) : '');

const inicio = inicioCiclo();
const hoje = hojeSp();
const dias = (coluna) => sqlDiasCase(coluna);

// Nomes gravados pelo bloqueio (01:00) a partir das listas da API. Executor: Id = idpessoa da agenda.
const nomeCadastro = (tipo, coluna) =>
  `(SELECT TOP (1) cad.Nome FROM dbo.CtlCnnCadastro cad WHERE cad.Tipo = N'${tipo}' AND cad.Id = ${coluna})`;
const profissionalDe = (alias) => `COALESCE(${nomeCadastro('EXECUTOR', `${alias}.IdPessoaExecutor`)}, ${alias}.NomeExecutor)`;
// Procedimentos da falta numa string ("Retorno, Exame"). FOR XML PATH funciona em qualquer versão (STRING_AGG só a partir de 2017).
const procedimentosDe = (colunaAgenda) => `STUFF((
        SELECT N', ' + ISNULL(fp.NomeProcedimento, N'Procedimento ' + CAST(fp.IdTipoProcedimento AS nvarchar(20)))
        FROM dbo.CtlCnnFaltaProcedimento fp
        WHERE fp.IdAgenda = ${colunaAgenda}
        ORDER BY fp.NomeProcedimento
        FOR XML PATH(''), TYPE
    ).value('.', 'nvarchar(max)'), 1, 2, N'')`;
const camposAgenda = (alias) => `${profissionalDe(alias)} AS Profissional,
    ${nomeCadastro('TIPO_CONSULTA', `${alias}.IdTipoConsulta`)} AS TipoConsulta,
    ${nomeCadastro('ROTULO', `${alias}.IdRotulo`)} AS Rotulo,
    ${procedimentosDe(`${alias}.IdAgenda`)} AS Procedimentos`;
const cabecalho = `USE INTEGRACAO;
SET NOCOUNT ON;
DECLARE @inicio DATE = ${sqlDate(inicio)};
DECLARE @hoje DATE = ${sqlDate(hoje)};`;

if (action === 'pacientes') {
  const query = `${cabecalho}
DECLARE @inicioMes DATE = DATEFROMPARTS(YEAR(@hoje), MONTH(@hoje), 1);

;WITH Alvo AS (
    SELECT IdPaciente FROM dbo.CtlCnnFaltaPaciente WHERE DataFalta >= @inicio
    UNION
    SELECT IdPaciente FROM dbo.CtlCnnControlePaciente WHERE Situacao = N'BLOQUEADO'
),
Faltas AS (
    SELECT
        f.IdPaciente,
        f.IdAgenda,
        f.NomePaciente,
        f.DataFalta,
        f.NumeroFalta,
        f.NomeExecutor,
        f.IdPessoaExecutor,
        f.IdTipoConsulta,
        f.IdRotulo,
        ROW_NUMBER() OVER (
            PARTITION BY f.IdPaciente
            ORDER BY CASE WHEN f.DataFalta >= @inicio THEN 0 ELSE 1 END, f.NumeroFalta DESC, f.DataFalta DESC, f.IdAgenda DESC
        ) AS Ordem,
        SUM(CASE WHEN f.DataFalta >= @inicio THEN 1 ELSE 0 END) OVER (PARTITION BY f.IdPaciente) AS FaltasCiclo,
        COUNT(*) OVER (PARTITION BY f.IdPaciente) AS FaltasTotal
    FROM dbo.CtlCnnFaltaPaciente f
    INNER JOIN Alvo a
        ON a.IdPaciente = f.IdPaciente
)
SELECT
    N'paciente' AS _secao,
    v.IdPaciente,
    v.NomePaciente,
    v.IdAgenda,
    CONVERT(char(10), v.DataFalta, 23) AS DataFalta,
    v.NumeroFalta,
    ${camposAgenda('v')},
    v.FaltasCiclo,
    v.FaltasTotal,
    ${dias('v.NumeroFalta')} AS DiasBloqueio,
    CONVERT(char(10), DATEADD(DAY, ${dias('v.NumeroFalta')}, v.DataFalta), 23) AS DataFimBloqueio,
    c.Situacao,
    c.IdAgendaReferencia,
    c.UltimaAcao,
    c.OrigemUltimaAcao,
    c.UltimaAcaoPor,
    c.UltimaAcaoEm,
    s.Id AS SolicitacaoId,
    s.Status AS SolicitacaoStatus,
    s.IdAgendaReferencia AS SolicitacaoIdAgenda,
    s.SolicitadoPor AS SolicitacaoPor,
    s.SolicitadoEm AS SolicitacaoEm
FROM Faltas v
LEFT JOIN dbo.CtlCnnControlePaciente c
    ON c.IdPaciente = v.IdPaciente
LEFT JOIN dbo.CtlCnnSolicitacao s
    ON s.IdPaciente = v.IdPaciente
   AND s.Status IN (N'PENDENTE', N'APROVADA')
WHERE v.Ordem = 1;

SELECT
    N'totais' AS _secao,
    (SELECT COUNT(*) FROM dbo.CtlCnnFaltaPaciente WHERE DataFalta >= @inicio) AS FaltasCiclo,
    (SELECT COUNT(*) FROM dbo.CtlCnnFaltaPaciente WHERE DataFalta >= @inicioMes) AS FaltasMes,
    (SELECT MAX(DataColeta) FROM dbo.CtlCnnFaltaPaciente) AS UltimaColeta,
    (SELECT MAX(CriadoEm) FROM dbo.CtlCnnAcaoPaciente WHERE Origem = N'AUTOMATICO' AND Acao = N'BLOQUEIO') AS UltimoBloqueioAutomatico,
    (SELECT MAX(CriadoEm) FROM dbo.CtlCnnAcaoPaciente WHERE Origem = N'AUTOMATICO' AND Acao = N'LIBERACAO') AS UltimaLiberacaoAutomatica,
    (SELECT COUNT(*) FROM dbo.CtlCnnControlePaciente) AS LinhasControle,
    (SELECT COUNT(*) FROM dbo.CtlCnnSolicitacao WHERE Status = N'PENDENTE') AS SolicitacoesPendentes,
    (SELECT COUNT(*) FROM dbo.CtlCnnSolicitacao WHERE Status = N'APROVADA') AS SolicitacoesAprovadas;`;

  return [{ json: { action, query, inicio, hoje } }];
}

if (action === 'paciente') {
  const id = Number(body.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return erro(400, 'Paciente inválido.');
  }

  const query = `${cabecalho}
DECLARE @id BIGINT = ${sqlN(id)};

SELECT
    N'falta' AS _secao,
    IdAgenda,
    NomePaciente,
    CpfCnpj,
    CONVERT(char(10), DataFalta, 23) AS DataFalta,
    CONVERT(char(5), HoraInicio, 108) AS HoraInicio,
    NumeroFalta,
    ${camposAgenda('f')},
    TipoExecutor,
    StatusAgenda,
    DataColeta
FROM dbo.CtlCnnFaltaPaciente f
WHERE IdPaciente = @id
ORDER BY DataFalta DESC, IdAgenda DESC;

SELECT TOP (200)
    N'acao' AS _secao,
    Id,
    Acao,
    Origem,
    Usuario,
    Motivo,
    IdAgendaReferencia,
    NumeroFalta,
    CONVERT(char(10), DataFimBloqueio, 23) AS DataFimBloqueio,
    Antecipada,
    AtivoAntes,
    Sucesso,
    HttpStatus,
    RespostaApi,
    IdSolicitacao,
    CriadoEm
FROM dbo.CtlCnnAcaoPaciente
WHERE IdPaciente = @id
ORDER BY CriadoEm DESC, Id DESC;

SELECT TOP (50)
    N'solicitacao' AS _secao,
    Id,
    IdAgendaReferencia,
    NumeroFalta,
    Motivo,
    SolicitadoPor,
    SolicitadoEm,
    Status,
    DecididoPor,
    DecididoEm,
    MotivoDecisao,
    LiberadoPor,
    LiberadoEm
FROM dbo.CtlCnnSolicitacao
WHERE IdPaciente = @id
ORDER BY SolicitadoEm DESC, Id DESC;

SELECT
    N'controle' AS _secao,
    Situacao,
    IdAgendaReferencia,
    NumeroFalta,
    CONVERT(char(10), DataFimBloqueio, 23) AS DataFimBloqueio,
    UltimaAcao,
    OrigemUltimaAcao,
    UltimaAcaoPor,
    MotivoUltimaAcao,
    UltimaAcaoEm
FROM dbo.CtlCnnControlePaciente
WHERE IdPaciente = @id;`;

  return [{ json: { action, query, id, inicio, hoje } }];
}

if (action === 'faltas') {
  const de = safeDate(body.de) || inicio;
  const ate = safeDate(body.ate) || hoje;

  if (de > ate) {
    return erro(400, 'A data inicial é depois da final.');
  }

  const filtro = `DataFalta >= @de AND DataFalta <= @ate`;
  const filtroF = `f.DataFalta >= @de AND f.DataFalta <= @ate`;
  // Agrupa por um cadastro: nome do CNN, ou "(sem ...)" quando a falta não tem o campo, ou o id quando o nome ainda não veio.
  const porCadastro = (secao, tipo, coluna, vazio, top) => `SELECT TOP (${top}) N'${secao}' AS _secao,
       CASE WHEN f.${coluna} IS NULL THEN N'${vazio}' ELSE ISNULL(cad.Nome, N'Código ' + CAST(f.${coluna} AS nvarchar(20))) END AS Nome,
       COUNT(*) AS Faltas, COUNT(DISTINCT f.IdPaciente) AS Pacientes
FROM dbo.CtlCnnFaltaPaciente f
LEFT JOIN dbo.CtlCnnCadastro cad
    ON cad.Tipo = N'${tipo}' AND cad.Id = f.${coluna}
WHERE ${filtroF}
GROUP BY f.${coluna}, cad.Nome
ORDER BY COUNT(*) DESC;`;
  // 1900-01-01 foi segunda-feira: (dias desde então) % 7 dá 0 = segunda ... 6 = domingo, sem depender de DATEFIRST.
  const query = `${cabecalho}
DECLARE @de DATE = ${sqlDate(de)};
DECLARE @ate DATE = ${sqlDate(ate)};

-- ComProcedimento é uma subconsulta à parte: o SQL Server não aceita EXISTS dentro de SUM().
SELECT N'total' AS _secao, COUNT(*) AS Faltas, COUNT(DISTINCT IdPaciente) AS Pacientes,
       (SELECT COUNT(*)
        FROM dbo.CtlCnnFaltaPaciente fc
        WHERE fc.DataFalta >= @de AND fc.DataFalta <= @ate
          AND EXISTS (SELECT 1 FROM dbo.CtlCnnFaltaProcedimento fp WHERE fp.IdAgenda = fc.IdAgenda)) AS ComProcedimento
FROM dbo.CtlCnnFaltaPaciente
WHERE ${filtro};

SELECT N'mes' AS _secao, CONVERT(char(7), DataFalta, 23) AS Mes, COUNT(*) AS Faltas, COUNT(DISTINCT IdPaciente) AS Pacientes
FROM dbo.CtlCnnFaltaPaciente
WHERE ${filtro}
GROUP BY CONVERT(char(7), DataFalta, 23);

SELECT N'diaSemana' AS _secao, DATEDIFF(DAY, '19000101', DataFalta) % 7 AS DiaSemana, COUNT(*) AS Faltas
FROM dbo.CtlCnnFaltaPaciente
WHERE ${filtro}
GROUP BY DATEDIFF(DAY, '19000101', DataFalta) % 7;

SELECT TOP (30) N'profissional' AS _secao, Profissional, COUNT(*) AS Faltas, COUNT(DISTINCT IdPaciente) AS Pacientes
FROM (
    SELECT f.IdPaciente,
           CASE WHEN f.IdPessoaExecutor IS NULL AND f.NomeExecutor IS NULL THEN N'(sem profissional)'
                ELSE COALESCE(cad.Nome, f.NomeExecutor, N'Código ' + CAST(f.IdPessoaExecutor AS nvarchar(20))) END AS Profissional
    FROM dbo.CtlCnnFaltaPaciente f
    LEFT JOIN dbo.CtlCnnCadastro cad
        ON cad.Tipo = N'EXECUTOR' AND cad.Id = f.IdPessoaExecutor
    WHERE ${filtroF}
) porProfissional
GROUP BY Profissional
ORDER BY COUNT(*) DESC;

${porCadastro('tipoConsulta', 'TIPO_CONSULTA', 'IdTipoConsulta', '(sem tipo de consulta)', 30)}

${porCadastro('rotulo', 'ROTULO', 'IdRotulo', '(sem rótulo)', 20)}

SELECT TOP (30) N'procedimento' AS _secao,
       ISNULL(MAX(fp.NomeProcedimento), N'Procedimento ' + CAST(fp.IdTipoProcedimento AS nvarchar(20))) AS Nome,
       COUNT(DISTINCT f.IdAgenda) AS Faltas, COUNT(DISTINCT f.IdPaciente) AS Pacientes
FROM dbo.CtlCnnFaltaProcedimento fp
INNER JOIN dbo.CtlCnnFaltaPaciente f
    ON f.IdAgenda = fp.IdAgenda
WHERE ${filtroF}
GROUP BY fp.IdTipoProcedimento
ORDER BY COUNT(DISTINCT f.IdAgenda) DESC;

SELECT N'periodo' AS _secao, Periodo, Ordem, COUNT(*) AS Faltas, COUNT(DISTINCT IdPaciente) AS Pacientes
FROM (
    SELECT IdPaciente,
           CASE WHEN HoraInicio IS NULL THEN N'Sem horário'
                WHEN HoraInicio < '12:00' THEN N'Manhã'
                WHEN HoraInicio < '18:00' THEN N'Tarde'
                ELSE N'Noite' END AS Periodo,
           CASE WHEN HoraInicio IS NULL THEN 4
                WHEN HoraInicio < '12:00' THEN 1
                WHEN HoraInicio < '18:00' THEN 2
                ELSE 3 END AS Ordem
    FROM dbo.CtlCnnFaltaPaciente
    WHERE ${filtro}
) porPeriodo
GROUP BY Periodo, Ordem;

SELECT N'reincidencia' AS _secao, Quantidade, COUNT(*) AS Pacientes
FROM (
    SELECT IdPaciente, CASE WHEN COUNT(*) >= ${maiorFaltaRegra} THEN ${maiorFaltaRegra} ELSE COUNT(*) END AS Quantidade
    FROM dbo.CtlCnnFaltaPaciente
    WHERE ${filtro}
    GROUP BY IdPaciente
) porPaciente
GROUP BY Quantidade;

SELECT TOP (20) N'reincidente' AS _secao, IdPaciente, MAX(NomePaciente) AS NomePaciente,
       COUNT(*) AS Faltas, CONVERT(char(10), MAX(DataFalta), 23) AS UltimaFalta
FROM dbo.CtlCnnFaltaPaciente
WHERE ${filtro}
GROUP BY IdPaciente
HAVING COUNT(*) >= 2
ORDER BY COUNT(*) DESC, MAX(DataFalta) DESC;

SELECT TOP (5001) N'linha' AS _secao, f.IdAgenda, f.IdPaciente, f.NomePaciente,
       CONVERT(char(10), f.DataFalta, 23) AS DataFalta, CONVERT(char(5), f.HoraInicio, 108) AS HoraInicio,
       f.NumeroFalta,
       ${camposAgenda('f')}
FROM dbo.CtlCnnFaltaPaciente f
WHERE ${filtroF}
ORDER BY DataFalta DESC, IdAgenda DESC;`;

  return [{ json: { action, query, de, ate, inicio, hoje } }];
}

if (action === 'acoes') {
  const de = safeDate(body.de);
  const ate = safeDate(body.ate);
  const acao = escolha(body.acao, ['BLOQUEIO', 'LIBERACAO']);
  const origem = escolha(body.origem, ['AUTOMATICO', 'PAINEL', 'CARGA_INICIAL']);
  const resultado = escolha(body.resultado, ['ok', 'falha']);
  const usuario = String(body.usuario || '').trim().slice(0, 100);
  const paciente = Number(body.paciente);
  const pageSize = 50;
  const page = Math.min(Math.max(Number.parseInt(String(body.page || '1'), 10) || 1, 1), 10000);

  if (de && ate && de > ate) {
    return erro(400, 'A data inicial é depois da final.');
  }

  // CriadoEm é UTC; São Paulo é UTC-3 o ano todo (sem horário de verão desde 2019).
  const condicoes = ['1 = 1'];
  if (de) condicoes.push(`CriadoEm >= DATEADD(HOUR, 3, CAST(${sqlDate(de)} AS datetime2))`);
  if (ate) condicoes.push(`CriadoEm < DATEADD(HOUR, 3, DATEADD(DAY, 1, CAST(${sqlDate(ate)} AS datetime2)))`);
  if (acao) condicoes.push(`Acao = ${sqlS(acao)}`);
  if (origem) condicoes.push(`Origem = ${sqlS(origem)}`);
  if (resultado) condicoes.push(`Sucesso = ${resultado === 'ok' ? 1 : 0}`);
  if (usuario) condicoes.push(`Usuario = ${sqlS(usuario, 100)}`);
  if (Number.isSafeInteger(paciente) && paciente > 0) condicoes.push(`IdPaciente = ${sqlN(paciente)}`);
  const where = condicoes.join('\n  AND ');

  const query = `USE INTEGRACAO;
SET NOCOUNT ON;

SELECT
    N'contagem' AS _secao,
    COUNT(*) AS Total,
    ISNULL(SUM(CASE WHEN Acao = N'BLOQUEIO' THEN 1 ELSE 0 END), 0) AS Bloqueios,
    ISNULL(SUM(CASE WHEN Acao = N'LIBERACAO' THEN 1 ELSE 0 END), 0) AS Liberacoes,
    ISNULL(SUM(CASE WHEN Antecipada = 1 THEN 1 ELSE 0 END), 0) AS Antecipadas,
    ISNULL(SUM(CASE WHEN Sucesso = 0 THEN 1 ELSE 0 END), 0) AS Falhas
FROM dbo.CtlCnnAcaoPaciente
WHERE ${where};

SELECT
    N'acao' AS _secao,
    Id,
    IdPaciente,
    NomePaciente,
    Acao,
    Origem,
    Usuario,
    Motivo,
    IdAgendaReferencia,
    NumeroFalta,
    CONVERT(char(10), DataFimBloqueio, 23) AS DataFimBloqueio,
    Antecipada,
    Sucesso,
    HttpStatus,
    RespostaApi,
    IdExecucaoN8n,
    IdSolicitacao,
    CriadoEm
FROM dbo.CtlCnnAcaoPaciente
WHERE ${where}
ORDER BY CriadoEm DESC, Id DESC
OFFSET ${(page - 1) * pageSize} ROWS FETCH NEXT ${pageSize} ROWS ONLY;

SELECT N'usuario' AS _secao, Usuario, COUNT(*) AS Acoes
FROM dbo.CtlCnnAcaoPaciente
GROUP BY Usuario
ORDER BY Usuario;`;

  return [{ json: { action, query, page, pageSize } }];
}

if (action === 'parametros') {
  const query = `USE INTEGRACAO;
SET NOCOUNT ON;

SELECT
    N'status' AS _secao,
    (SELECT MAX(DataColeta) FROM dbo.CtlCnnFaltaPaciente) AS UltimaColeta,
    (SELECT MAX(CriadoEm) FROM dbo.CtlCnnAcaoPaciente WHERE Origem = N'AUTOMATICO' AND Acao = N'BLOQUEIO') AS UltimoBloqueioAutomatico,
    (SELECT MAX(CriadoEm) FROM dbo.CtlCnnAcaoPaciente WHERE Origem = N'AUTOMATICO' AND Acao = N'LIBERACAO') AS UltimaLiberacaoAutomatica,
    (SELECT MAX(CriadoEm) FROM dbo.CtlCnnAcaoPaciente WHERE Origem = N'PAINEL') AS UltimaAcaoPainel,
    (SELECT COUNT(*) FROM dbo.CtlCnnControlePaciente) AS LinhasControle,
    (SELECT COUNT(*) FROM dbo.CtlCnnFaltaPaciente) AS LinhasFaltas;

SELECT N'cadastro' AS _secao, Tipo, COUNT(*) AS Quantidade, MAX(AtualizadoEm) AS AtualizadoEm
FROM dbo.CtlCnnCadastro
GROUP BY Tipo;`;

  return [{ json: { action, query, inicio, hoje } }];
}

return erro(400, 'Ação desconhecida.');
