// ===== Unidade da execução (fonte única: workflows/code/_unidade.js) =====
// Cada unidade (clínica do CNN) tem um IdUnidade (chave em todas as tabelas) e um código (dbo.CtlCnnUnidade).
// O CID do CNN de cada unidade fica na variável do n8n CNN_CID_<código> (ex.: CNN_CID_ZARNS_SALVADOR), na tela
// Variables ($vars) ou no ambiente do servidor ($env), nunca no fluxo: os headers "clinicaNasNuvens-cid" leem por ela.
const CODIGO_UNIDADE = /^[A-Z0-9_]{1,40}$/;

// { idUnidade, codigoUnidade } de quem chamou (a Vercel no webhook, ou o fluxo principal no subfluxo do bloqueio).
const lerUnidade = (origem) => {
  const idUnidade = Number(origem?.idUnidade);
  const codigoUnidade = String(origem?.codigoUnidade ?? '').trim();
  if (!Number.isSafeInteger(idUnidade) || idUnidade <= 0 || idUnidade > 32767 || !CODIGO_UNIDADE.test(codigoUnidade)) {
    return null;
  }
  return { idUnidade, codigoUnidade };
};

// Unidade desta execução: nó "Unidade" (subfluxo do bloqueio) ou "Validar" (workflow Ações).
const unidadeAtual = () => {
  for (const nome of ['Unidade', 'Validar']) {
    try {
      const unidade = lerUnidade($(nome).first().json);
      if (unidade) {
        return unidade;
      }
    } catch (erro) {
      // o nó não existe (ou não rodou) neste workflow
    }
  }
  throw new Error('Unidade não informada nesta execução (idUnidade e codigoUnidade).');
};

// CID da unidade: Variables do n8n ($vars, tela Variables) e, se não tiver, variável de ambiente do servidor ($env).
// Vazio: a chamada ao CNN não pode seguir.
const cidDaUnidade = (codigoUnidade) => {
  const nome = `CNN_CID_${codigoUnidade}`;
  for (const ler of [() => $vars[nome], () => $env[nome]]) {
    try {
      const valor = String(ler() ?? '').trim();
      if (valor) {
        return valor;
      }
    } catch (erro) {
      // $vars indisponível, ou N8N_BLOCK_ENV_ACCESS_IN_NODE=true bloqueando o $env
    }
  }
  return '';
};

const semCidMensagem = (codigoUnidade) =>
  `CID da unidade ${codigoUnidade} não configurado no n8n (variável CNN_CID_${codigoUnidade} em Variables).`;
// ===== fim da unidade =====
