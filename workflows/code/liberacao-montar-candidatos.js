// Nó "montar candidatos" (liberação automática às 02:00). Um item por paciente com o prazo cumprido.
// Ninguém (ou falha no SQL): um item { nadaALiberar: true } com o motivo, para a execução mostrar e terminar.
const consulta = $input.all();
const falha = erroSql(consulta);
const hoje = $('preparar consulta').first().json.hoje;

if (falha) {
  return [{ json: { nadaALiberar: true, hoje, erro: falha, mensagem: `Falha ao consultar quem cumpriu o prazo: ${falha}` } }];
}

const vistos = new Set();
const saida = [];

for (const linha of linhasSql(consulta)) {
  const idPaciente = Number(linha.IdPaciente);
  if (!Number.isSafeInteger(idPaciente) || idPaciente <= 0 || vistos.has(idPaciente)) {
    continue;
  }
  vistos.add(idPaciente);

  const numeroFalta = Number(linha.NumeroFalta) || 1;
  const diasBloqueio = Number(linha.DiasBloqueio) || diasPorFalta(numeroFalta);
  const dataInicio = dataIso(linha.DataFalta);

  saida.push({
    json: {
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

if (!saida.length) {
  return [{ json: { nadaALiberar: true, hoje, mensagem: `Ninguém com o prazo cumprido hoje (${hoje}).` } }];
}

return saida;
