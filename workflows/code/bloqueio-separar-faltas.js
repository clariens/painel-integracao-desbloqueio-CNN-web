// Nó "separar faltas" (bloqueio às 01:00 e botão Bloquear do painel).
// No workflow Ações, o nó "Validar" informa o paciente: só as faltas dele passam,
// mesmo que a API ignore o filtro codigoPaciente da agenda.
const lerNo = (nome) => {
  try {
    return $(nome).first().json;
  } catch (erro) {
    return null;
  }
};

const inicioPeriodo = inicioCiclo();
const hoje = hojeSp();
const pacienteFiltro = Number(lerNo('Validar')?.id) || null;
const faltas = [];

for (const item of items) {
  const pagina = item.json ?? {};
  const lista = Array.isArray(pagina.lista) ? pagina.lista : [];

  for (const agendamento of lista) {
    if (agendamento.status !== 'FALTOU') {
      continue;
    }

    if (!agendamento.idPaciente || !agendamento.id) {
      continue;
    }

    if (pacienteFiltro && Number(agendamento.idPaciente) !== pacienteFiltro) {
      continue;
    }

    const dataFalta = String(agendamento.data ?? '').slice(0, 10);
    if (dataFalta < inicioPeriodo || dataFalta > hoje) {
      continue;
    }

    faltas.push({
      json: {
        ...agendamento,
        dataFalta,
        dataInicioPeriodo: inicioPeriodo,
        dataColetaReferencia: hoje
      }
    });
  }
}

faltas.sort((a, b) => {
  const porData = String(a.json.dataFalta).localeCompare(String(b.json.dataFalta));
  if (porData !== 0) {
    return porData;
  }

  return Number(a.json.id) - Number(b.json.id);
});

if (!faltas.length) {
  return [{ json: { semFaltas: true, dataInicioPeriodo: inicioPeriodo, dataFalta: hoje } }];
}

return faltas;
