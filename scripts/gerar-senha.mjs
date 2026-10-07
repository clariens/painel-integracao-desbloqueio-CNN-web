// Gera a entrada de um usuário para DASHBOARD_USERS: `npm run senha -- joao`.
// A senha é pedida no terminal e nunca fica gravada; só o salt e o hash vão para a variável.
import crypto from "node:crypto";
import { createInterface } from "node:readline";
import { hashPassword } from "../lib/auth.js";

const user = process.argv[2] || "";

if (!/^[A-Za-z0-9._-]{2,50}$/.test(user)) {
  console.error("Uso: npm run senha -- <usuario>   (letras, números, ponto, _ ou -; 2 a 50 caracteres)");
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
const ask = (question) => new Promise((resolve) => rl.question(question, resolve));

// Esconde o que é digitado depois do prompt.
rl._writeToOutput = function writeToOutput(text) {
  if (rl.line === undefined || text.includes("Senha")) {
    rl.output.write(text);
  }
};

const password = await ask("Senha (mínimo 10 caracteres): ");
rl.output.write("\n");
const confirm = await ask("Repita a senha: ");
rl.output.write("\n");
rl.close();

if (password.length < 10) {
  console.error("Senha curta demais.");
  process.exit(1);
}

if (password !== confirm) {
  console.error("As senhas não conferem.");
  process.exit(1);
}

const salt = crypto.randomBytes(16).toString("hex");
console.log("\nAcrescente em DASHBOARD_USERS (separando usuários por vírgula):\n");
console.log(`${user}:${salt}:${hashPassword(password, salt)}`);
