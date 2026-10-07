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
