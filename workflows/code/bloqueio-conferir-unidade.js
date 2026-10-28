// Nó "conferir unidade" (subfluxo "Bloqueio por unidade"). Recebe { idUnidade, codigoUnidade } do fluxo principal
// (nó "Unidade") e para logo se a unidade for inválida ou se o CID dela não estiver configurado no n8n:
// sem CID, todas as chamadas ao CNN seriam recusadas.
const unidade = lerUnidade($('Unidade').first().json);

if (!unidade) {
  throw new Error('Unidade inválida: o subfluxo precisa de idUnidade e codigoUnidade (chamado pelo fluxo principal do bloqueio).');
}

if (!cidDaUnidade(unidade.codigoUnidade)) {
  throw new Error(semCidMensagem(unidade.codigoUnidade));
}

return [{ json: { ...unidade, nomeUnidade: $('Unidade').first().json.nomeUnidade || unidade.codigoUnidade } }];
