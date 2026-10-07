// Nó "Montar resposta" (workflow CNN Painel - Ações). Devolve o resultado do PATCH;
// se a gravação da auditoria falhou, avisa junto (o CNN já foi alterado e isso não se desfaz aqui).
const { resultado } = $('montar registro').first().json;
const registro = $input.all();
const falhaSql = erroSql(registro);
const idAcao = linhasSql(registro)[0]?.IdAcao ?? null;

const response = { ...resultado.response };

if (falhaSql) {
  response.avisoAuditoria = 'A ação foi enviada ao CNN, mas não foi gravada na auditoria. Avise o suporte.';
  if (resultado.statusCode >= 400) {
    response.error = `${response.error} (e a auditoria também falhou)`;
  }
} else if (idAcao !== null) {
  response.idAcao = idAcao;
}

return [{ json: { statusCode: resultado.statusCode, response } }];
