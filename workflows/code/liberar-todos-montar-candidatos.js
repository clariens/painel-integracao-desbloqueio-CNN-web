// Nó "montar candidatos" (workflow Liberar todos os bloqueados). Um item por paciente bloqueado.
// Simulação (simular = true) ou ninguém bloqueado: um item só, com o resumo e a lista, e nada é enviado ao CNN.
const config = $('preparar consulta').first().json;
const consulta = $input.all();
const falha = erroSql(consulta);

if (falha) {
  throw new Error(`Falha ao consultar os pacientes bloqueados: ${falha}`);
}

const vistos = new Set();
const candidatos = [];
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
  candidatos.push({
    ...unidade,
    idPaciente,
    nomePaciente: linha.NomePaciente || null,
    // A falta do bloqueio continua como referência: com LIBERADO para ela, o bloqueio das 01:00 não bloqueia de novo.
    idAgenda: linha.IdAgendaReferencia ?? null,
    numeroFalta,
    diasBloqueio: diasPorFalta(numeroFalta),
    dataInicioBloqueio: dataIso(linha.DataInicioBloqueio),
    dataFimBloqueio: dataIso(linha.DataFimBloqueio),
  });
}

const porUnidade = {};
for (const candidato of candidatos) {
  porUnidade[candidato.codigoUnidade] = (porUnidade[candidato.codigoUnidade] || 0) + 1;
}

const avisoCid = semCid.size ? ` Ficaram de fora: ${[...semCid].map(semCidMensagem).join(' ')}` : '';

if (config.simular || !candidatos.length) {
  return [{
    json: {
      liberar: false,
      simulacao: config.simular,
      total: candidatos.length,
      porUnidade,
      semCid: [...semCid],
      mensagem: !candidatos.length
        ? `Nenhum paciente bloqueado${config.codigoUnidade ? ` em ${config.codigoUnidade}` : ''}.${avisoCid}`
        : `SIMULAÇÃO: ${candidatos.length} paciente(s) seriam liberados. Nada foi enviado ao CNN. Para liberar, mude "simular" para false no nó "configurar".${avisoCid}`,
      pacientes: candidatos.map((c) => ({
        unidade: c.codigoUnidade,
        idPaciente: c.idPaciente,
        nome: c.nomePaciente,
        fimDoPrazo: c.dataFimBloqueio,
      })),
    }
  }];
}

return candidatos.map((candidato) => ({ json: { ...candidato, liberar: true } }));
