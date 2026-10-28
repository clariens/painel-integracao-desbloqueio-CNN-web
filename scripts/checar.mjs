// `npm run check`: confere os workflows antes de colar no n8n.
// - o código de cada nó Code compila (como corpo de função assíncrona, igual ao n8n);
// - todo $('nó') citado no código e toda conexão apontam para um nó que existe;
// - o JSON está em dia com workflows/code/*.js (senão: rode `npm run inject`).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCode, targets } from "../workflows/code/inject.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const workflowsDir = join(root, "workflows");
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const problemas = [];

for (const file of readdirSync(workflowsDir).filter((name) => name.endsWith(".json"))) {
  const workflow = JSON.parse(readFileSync(join(workflowsDir, file), "utf8"));
  const nomes = new Set(workflow.nodes.map((node) => node.name));

  for (const node of workflow.nodes) {
    const jsCode = node.parameters?.jsCode;
    if (node.type !== "n8n-nodes-base.code" || !jsCode) continue;

    try {
      new AsyncFunction("$", "$input", "$now", "$execution", "items", jsCode);
    } catch (error) {
      problemas.push(`${file} › ${node.name}: não compila (${error.message})`);
    }

    for (const [, citado] of jsCode.matchAll(/\$\(\s*'([^']+)'\s*\)/g)) {
      // lerNo('Validar') é opcional de propósito: só existe no workflow Ações.
      if (!nomes.has(citado) && citado !== "Validar") {
        problemas.push(`${file} › ${node.name}: cita o nó inexistente '${citado}'`);
      }
    }
  }

  for (const [origem, saidas] of Object.entries(workflow.connections || {})) {
    if (!nomes.has(origem)) problemas.push(`${file}: conexão sai de nó inexistente '${origem}'`);
    for (const saida of saidas.main || []) {
      for (const destino of saida || []) {
        if (!nomes.has(destino.node)) problemas.push(`${file}: conexão chega em nó inexistente '${destino.node}'`);
      }
    }
  }

  // Ligações que já sumiram ao copiar do n8n: laço sem volta e nó que não leva a lugar nenhum.
  const saidas = (nome) => (workflow.connections?.[nome]?.main || []).flat().filter(Boolean);
  const entradas = (nome) =>
    Object.values(workflow.connections || {}).flatMap((c) => (c.main || []).flat()).filter((d) => d?.node === nome);
  const FINAIS = new Set(["n8n-nodes-base.respondToWebhook", "n8n-nodes-base.noOp", "n8n-nodes-base.stickyNote", "n8n-nodes-base.executeWorkflow"]);
  const FINAIS_POR_NOME = new Set(["sem faltas"]); // bloqueio: só registra que não houve falta no período

  for (const node of workflow.nodes) {
    if (node.type === "n8n-nodes-base.splitInBatches" && entradas(node.name).length < 2) {
      problemas.push(`${file} › ${node.name}: laço sem a ligação de volta (o último nó do laço tem que voltar para ele)`);
    }
    if (!FINAIS.has(node.type) && !FINAIS_POR_NOME.has(node.name) && saidas(node.name).length === 0) {
      problemas.push(`${file} › ${node.name}: não está ligado a nenhum nó seguinte`);
    }

    // Data fixa na URL da agenda: o bloqueio pararia de ver as faltas novas.
    const url = String(node.parameters?.url || "");
    if (node.type === "n8n-nodes-base.httpRequest" && /data(Inicial|Final)=\d{4}-/.test(url)) {
      problemas.push(`${file} › ${node.name}: data fixa na URL (${url.match(/data(Inicial|Final)=[\d-]+/)[0]}); use a expressão do ciclo`);
    }

    // CID do CNN: sempre da variável do n8n da unidade (Variables ou ambiente), nunca escrito no fluxo.
    for (const header of node.parameters?.headerParameters?.parameters || []) {
      if (header.name === "clinicaNasNuvens-cid" && !/^=\{\{.*\$(vars|env)\[/.test(String(header.value || ""))) {
        problemas.push(`${file} › ${node.name}: header clinicaNasNuvens-cid tem que ler $vars['CNN_CID_' + código da unidade]`);
      }
    }

    // SQL montado no Code: modo Fixed ("{{ $json.query }}"). Com "=" o n8n resolveria a consulta duas vezes.
    const query = node.parameters?.query;
    if (node.type === "n8n-nodes-base.microsoftSql" && typeof query === "string" && query.startsWith("=")) {
      problemas.push(`${file} › ${node.name}: query em modo Expression; use o modo Fixed com {{ $json.query }}`);
    }
  }

  for (const [nome, fontes] of Object.entries(targets[file] || {})) {
    const node = workflow.nodes.find((item) => item.name === nome);
    if (!node) {
      problemas.push(`${file}: inject.mjs aponta para o nó inexistente '${nome}'`);
    } else if (node.parameters.jsCode !== buildCode(fontes)) {
      problemas.push(`${file} › ${nome}: código desatualizado, rode npm run inject`);
    }
  }
}

if (problemas.length) {
  console.error(problemas.map((linha) => `✗ ${linha}`).join("\n"));
  process.exit(1);
}

console.log("✓ workflows ok");
