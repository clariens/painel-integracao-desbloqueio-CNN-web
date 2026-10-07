// Nó "montar info bloqueio" (bloqueio às 01:00). Um item por paciente com falta no período analisado
// (início do ciclo até hoje), sem olhar o prazo: o prazo 60/90/180 só diz quando o paciente pode ser liberado.
//   - ativo no CNN (ou sem resposta do GET) -> bloquear (PATCH);
//   - já inativo no CNN e sem bloqueio registrado para esta falta -> só registrar (sem PATCH);
//   - já inativo e já registrado -> nada a fazer.
// Quem foi liberado ou isento no painel por esta mesma falta nem chega aqui (filtro em "ids da consulta").
// Sem ninguém: um item { nadaABloquear: true } com o resumo do porquê.
const ativoPorPaciente = new Map();

try {
  for (const item of $('GET paciente por id').all()) {
    const paciente = item.json ?? {};
    const id = Number(paciente.id);

    if (!Number.isFinite(id) || paciente.error || paciente.message) {
      continue;
    }

    if (typeof paciente.ativo === 'boolean') {
      ativoPorPaciente.set(id, paciente.ativo);
    }
  }
} catch (erro) {
  // GET paciente nao rodou neste ramo
}

const hoje = hojeSp();
const linhas = linhasSql(items);
const resumo = { analisados: linhas.length, jaRegistrado: 0, invalidos: 0 };

const saida = linhas.flatMap((linha) => {
  const numeroFalta = Number(linha.NumeroFalta ?? linha.numeroFalta ?? 0);
  const idPaciente = Number(linha.IdPaciente ?? linha.idPaciente);

  if (!Number.isFinite(idPaciente) || numeroFalta < 1) {
    resumo.invalidos += 1;
    return [];
  }

  // O prazo não decide o bloqueio; vai para o controle como "liberável a partir de".
  const diasBloqueio = diasPorFalta(numeroFalta);
  const nomePaciente = linha.NomePaciente ?? linha.nomePaciente ?? null;
  const dataInicio = dataIso(linha.DataFalta ?? linha.dataFalta);
  const dataFim = somarDias(dataInicio, diasBloqueio);

  const idAgenda = linha.IdAgenda ?? linha.idAgenda ?? null;
  const bloqueioRegistrado =
    linha.SituacaoControle === 'BLOQUEADO' && String(linha.IdAgendaReferencia ?? '') === String(idAgenda ?? '');

  const jaInativo = ativoPorPaciente.get(idPaciente) === false;
  if (jaInativo && bloqueioRegistrado) {
    resumo.jaRegistrado += 1;
    return [];
  }

  return [{
    json: {
      acao: 'BLOQUEAR',
      apenasRegistrar: jaInativo,
      ativo: false,
      ativoAntes: ativoPorPaciente.has(idPaciente) ? ativoPorPaciente.get(idPaciente) : null,
      idPaciente,
      nomePaciente,
      numeroFalta,
      nivelBloqueio: Math.min(numeroFalta, maiorFaltaRegra),
      diasBloqueio,
      dataInicioBloqueio: dataInicio,
      dataFimBloqueio: dataFim,
      idAgenda,
      mensagem: jaInativo
        ? `Registrar bloqueio de ${nomePaciente ?? idPaciente} (já inativo no CNN, falta ${numeroFalta}); liberável a partir de ${dataFim}.`
        : `Bloquear paciente ${nomePaciente ?? idPaciente} (falta ${numeroFalta}); liberável a partir de ${dataFim}.`
    }
  }];
});

// Ninguém para bloquear: devolve um item de resumo em vez de lista vazia, para a execução
// mostrar o motivo e seguir até o fim (o IF "há o que bloquear?" desvia para "nada a bloquear").
if (!saida.length) {
  return [{
    json: {
      nadaABloquear: true,
      hoje,
      ...resumo,
      mensagem: `Nada a bloquear hoje (${hoje}): ${resumo.analisados} paciente(s) com falta no período; `
        + `${resumo.jaRegistrado} já inativo(s) no CNN e registrado(s).`
    }
  }];
}

return saida;
