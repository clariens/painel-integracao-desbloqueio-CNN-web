// Nó "resumo" (workflow Liberar todos os bloqueados). Saída "done" do laço: uma linha por paciente,
// com o resultado do "registrar liberação" (IdAcao, Sucesso). Conta quantos deram certo.
const config = $('preparar consulta').first().json;
let liberados = 0;
let falhas = 0;
let semAuditoria = 0;

for (const item of $input.all()) {
  if (item.json?.error !== undefined) {
    semAuditoria += 1;
    continue;
  }
  const linha = linhasSql([item])[0] || {};
  if (linha.Sucesso === true || linha.Sucesso === 1) {
    liberados += 1;
  } else {
    falhas += 1;
  }
}

return [{
  json: {
    liberados,
    falhas,
    semAuditoria,
    unidade: config.codigoUnidade || 'todas',
    mensagem: `${liberados} liberado(s), ${falhas} com falha no CNN${semAuditoria ? `, ${semAuditoria} sem gravar na auditoria (veja o nó "registrar liberação")` : ''}. As falhas ficam na auditoria com Sucesso = 0.`
  }
}];
