// Nó "decidir" (liberação automática às 02:00). Roda para cada paciente do laço, depois do GET no CNN:
//   - inativo no CNN -> enviar PATCH { ativo: true };
//   - já ativo (alguém liberou direto no CNN) -> só registrar, sem PATCH;
//   - GET falhou ou paciente não existe -> não envia nada; a falha fica na auditoria (Sucesso = 0).
let alvo = {};
try {
  alvo = $('loop liberações').itemMatching(0).json;
} catch (erro) {
  alvo = $('loop liberações').first().json;
}

const resposta = lerRespostaHttp($input.first().json);
const paciente = resposta.body && typeof resposta.body === 'object' ? resposta.body : {};
const ativoAntes = typeof paciente.ativo === 'boolean' ? paciente.ativo : null;
const consultou = resposta.ok && paciente.id != null && ativoAntes !== null;

return [{
  json: {
    ...alvo,
    nomePaciente: paciente.nome || alvo.nomePaciente || null,
    ativoAntes,
    enviar: consultou && ativoAntes === false,
    apenasRegistrar: consultou && ativoAntes === true,
    falhaConsulta: consultou
      ? null
      : resposta.statusCode === 404
        ? 'Paciente não encontrado no CNN (HTTP 404).'
        : `Não foi possível consultar o paciente no CNN${resposta.statusCode ? ` (HTTP ${resposta.statusCode})` : ''}: ${(resposta.erro || resposta.texto || 'sem resposta').slice(0, 300)}`,
    httpConsulta: resposta.statusCode
  }
}];
