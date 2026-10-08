// Nó "pacientes únicos" (bloqueio às 01:00 e botão Bloquear do painel).
// Um item por paciente: "GET paciente por id" roda uma vez por paciente, e não uma vez por falta.
// O GET traz nome, CPF e contato (gravados com a falta) e o "ativo" usado em "montar info bloqueio".
const vistos = new Set();
const saida = [];

for (const item of $input.all()) {
  const idPaciente = Number(item.json?.idPaciente);
  if (!Number.isFinite(idPaciente) || vistos.has(idPaciente)) {
    continue;
  }
  vistos.add(idPaciente);
  saida.push({ json: { idPaciente } });
}

return saida;
