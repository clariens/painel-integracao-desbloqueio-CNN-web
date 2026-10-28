// Nó "montar candidatos" (liberação automática às 02:00). Um item por paciente com o prazo cumprido.
// Ninguém (ou falha no SQL): um item { nadaALiberar: true } com o motivo, para a execução mostrar e terminar.
// Unidade sem CID configurado no n8n fica de fora (sem CID o CNN recusa) e aparece no resumo.
const consulta = $input.all();
const falha = erroSql(consulta);
const hoje = $('preparar consulta').first().json.hoje;

if (falha) {
  return [{ json: { nadaALiberar: true, hoje, erro: falha, mensagem: `Falha ao consultar quem cumpriu o prazo: ${falha}` } }];
}

const vistos = new Set();
const saida = [];
const semCid = new Set();

for (const linha of linhasSql(consulta)) {
  const idPaciente = Number(linha.IdPaciente);
  const unidade = lerUnidade({ idUnidade: linha.IdUnidade, codigoUnidade: linha.CodigoUnidade });
  const chave = `${unidade?.idUnidade}:${idPaciente}`;
  if (!unidade || !Number.isSafeInteger(idPaciente) || idPaciente <= 0 || vistos.has(chave)) {
    continue;
  }
  vistos.add(chave);

  if (!cidDaUnidade(unidade.codigoUnidade)) {
    semCid.add(unidade.codigoUnidade);
    continue;
  }

  const numeroFalta = Number(linha.NumeroFalta) || 1;
  const diasBloqueio = Number(linha.DiasBloqueio) || diasPorFalta(numeroFalta);
  const dataInicio = dataIso(linha.DataFalta);

  saida.push({
    json: {
      ...unidade,
      idPaciente,
      nomePaciente: linha.NomePaciente || null,
      idAgenda: linha.IdAgenda ?? null,
      numeroFalta,
      diasBloqueio,
      dataInicioBloqueio: dataInicio,
      dataFimBloqueio: dataIso(linha.DataFimBloqueio) || somarDias(dataInicio, diasBloqueio),
      mensagem: `Liberar ${linha.NomePaciente || idPaciente}: prazo de ${diasBloqueio} dias da falta ${numeroFalta} cumprido.`
    }
  });
}

const avisoCid = semCid.size ? ` Unidades sem CID (não liberadas): ${[...semCid].map(semCidMensagem).join(' ')}` : '';

if (!saida.length) {
  return [{ json: { nadaALiberar: true, hoje, semCid: [...semCid], mensagem: `Ninguém com o prazo cumprido hoje (${hoje}).${avisoCid}` } }];
}

return saida;
