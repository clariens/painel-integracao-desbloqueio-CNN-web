// Copia o código de workflows/code/*.js para dentro dos JSON dos workflows (`npm run inject`).
// Cada nó recebe uma lista de arquivos, concatenados na ordem: _regra.js e _sql.js vêm antes do código do nó,
// e assim a regra (prazos, ciclo) e os helpers de SQL têm uma fonte só.
// Depois de rodar: no n8n, apague os nós do workflow e cole o JSON no canvas (mantém id e URL do webhook).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const codeDir = dirname(fileURLToPath(import.meta.url));
const workflowsDir = join(codeDir, "..");

const REGRA = "_regra.js";
const SQL = "_sql.js";

export const targets = {
  "bloqueioPacientesFaltas.json": {
    "separar faltas": [REGRA, "bloqueio-separar-faltas.js"],
    "preparar insert SQL": [REGRA, SQL, "bloqueio-preparar-insert.js"],
    "ids da consulta": [REGRA, "bloqueio-ids-consulta.js"],
    "montar info bloqueio": [REGRA, SQL, "bloqueio-montar-info.js"],
    "montar registro": [REGRA, SQL, "bloqueio-montar-registro.js"],
  },
  "cnn-painel-leitura.json": {
    "Preparar consulta": [REGRA, SQL, "leitura-preparar.js"],
    "Montar resposta": [REGRA, SQL, "leitura-montar-resposta.js"],
  },
  "cnn-painel-acoes.json": {
    Validar: [REGRA, "acoes-validar.js"],
    "separar faltas": [REGRA, "bloqueio-separar-faltas.js"],
    "preparar insert SQL": [REGRA, SQL, "bloqueio-preparar-insert.js"],
    "consultar situação": [REGRA, SQL, "acoes-consultar-situacao.js"],
    decidir: [REGRA, SQL, "acoes-decidir.js"],
    "montar registro": [REGRA, SQL, "acoes-montar-registro.js"],
    "Montar resposta": [REGRA, SQL, "acoes-montar-resposta.js"],
  },
};

const read = (file) => readFileSync(join(codeDir, file), "utf8").replace(/\r\n/g, "\n").trimEnd();

export const buildCode = (sources) => `${sources.map(read).join("\n\n")}\n`;

const main = () => {
  for (const [file, nodes] of Object.entries(targets)) {
    const workflowPath = join(workflowsDir, file);
    const workflow = JSON.parse(readFileSync(workflowPath, "utf8"));

    for (const [name, sources] of Object.entries(nodes)) {
      const node = workflow.nodes.find((item) => item.name === name);
      if (!node) {
        throw new Error(`Nó ${name} não encontrado em ${file}.`);
      }
      node.parameters.jsCode = buildCode(sources);
    }

    writeFileSync(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`);
    console.log(`Fluxo ${file} atualizado.`);
  }
};

// Roda quando chamado direto; scripts/checar.mjs só importa targets e buildCode.
const samePath = (a, b) => resolve(a).toLowerCase() === resolve(b).toLowerCase();
if (process.argv[1] && samePath(fileURLToPath(import.meta.url), process.argv[1])) {
  main();
}
