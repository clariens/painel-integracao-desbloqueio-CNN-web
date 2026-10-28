// Nó "montar unidades" (bloqueio às 01:00, fluxo principal). Um item por unidade ativa (dbo.CtlCnnUnidade):
// o nó "bloquear unidade" roda o subfluxo "Bloqueio por unidade" uma vez para cada item, uma unidade por vez.
// Falha de uma unidade (CID não configurado, CNN fora do ar) não impede a outra.
const consulta = $input.all();
const falha = erroSql(consulta);

if (falha) {
  throw new Error(`Falha ao ler as unidades (dbo.CtlCnnUnidade): ${falha}`);
}

return linhasSql(consulta).flatMap((linha) => {
  const unidade = lerUnidade({ idUnidade: linha.IdUnidade, codigoUnidade: linha.Codigo });
  if (!unidade) {
    return [];
  }

  return [{
    json: {
      ...unidade,
      nomeUnidade: linha.Nome || unidade.codigoUnidade,
      cidConfigurado: Boolean(cidDaUnidade(unidade.codigoUnidade))
    }
  }];
});
