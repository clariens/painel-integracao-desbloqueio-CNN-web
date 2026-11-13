// Nó "preparar consulta" (workflow Liberar todos os bloqueados, rodado à mão).
// Lê o nó "configurar" e monta a consulta de quem o sistema bloqueou: controle com Situacao = BLOQUEADO.
// Inativo no CNN por outro motivo (sem linha BLOQUEADO no controle) nunca entra.
const config = $('configurar').first().json;

const codigo = String(config.unidade ?? '').trim().toUpperCase();
if (codigo && !/^[A-Z0-9_]{1,40}$/.test(codigo)) {
  throw new Error('Unidade inválida em "configurar": use o código (ex.: ZARNS_SALVADOR) ou deixe vazio para todas.');
}

const motivo = String(config.motivo ?? '').replace(/\s+/g, ' ').trim();
if (motivo.length < 5 || motivo.length > 400) {
  throw new Error('Preencha o motivo em "configurar" (de 5 a 400 caracteres): ele vai para a auditoria.');
}

const usuario = String(config.usuario ?? '').trim() || 'liberacao-em-massa';
if (!/^[A-Za-z0-9._-]{2,50}$/.test(usuario)) {
  throw new Error('Usuário inválido em "configurar": letras, números, ponto, hífen ou sublinhado (2 a 50).');
}

// Só libera de verdade com simular = false. Qualquer outro valor (ou vazio) é simulação.
const simular = !(config.simular === false || String(config.simular).trim().toLowerCase() === 'false');

const query = `USE INTEGRACAO;
SET NOCOUNT ON;

SELECT
    c.IdUnidade,
    u.Codigo AS CodigoUnidade,
    c.IdPaciente,
    c.NomePaciente,
    c.IdAgendaReferencia,
    c.NumeroFalta,
    CONVERT(char(10), c.DataInicioBloqueio, 23) AS DataInicioBloqueio,
    CONVERT(char(10), c.DataFimBloqueio, 23) AS DataFimBloqueio
FROM dbo.CtlCnnControlePaciente c
INNER JOIN dbo.CtlCnnUnidade u
    ON u.IdUnidade = c.IdUnidade
WHERE c.Situacao = N'BLOQUEADO'
  AND u.Ativa = 1${codigo ? `\n  AND u.Codigo = ${sqlS(codigo, 40)}` : ''}
ORDER BY c.IdUnidade, c.NomePaciente, c.IdPaciente;`;

return [{ json: { query, simular, codigoUnidade: codigo || null, motivo, usuario, hoje: hojeSp() } }];
