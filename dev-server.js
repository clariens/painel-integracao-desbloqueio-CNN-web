// Servidor local que imita a Vercel: mesmos rewrites e os mesmos handlers de api/. Só desenvolvimento.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import pacientes from "./api/pacientes.js";
import faltas from "./api/faltas.js";
import acoes from "./api/acoes.js";
import parametros from "./api/parametros.js";
import sessao from "./api/sessao.js";
import senha from "./api/senha.js";
import usuarios from "./api/usuarios.js";
import dashboard from "./api/dashboard.js";
import solicitacoes from "./api/solicitacoes.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 3000);

// Os mesmos cabeçalhos do vercel.json (segurança e no-store da API), para o localhost se comportar como a produção.
const vercel = JSON.parse(await readFile(join(root, "vercel.json"), "utf8"));
const headerRules = (vercel.headers || []).map(({ source, headers }) => ({
  pattern: new RegExp(`^${source.replace(/\(\.\*\)/g, ".*")}$`),
  headers,
}));
const applyHeaders = (res, pathname) => {
  for (const { pattern, headers } of headerRules) {
    if (pattern.test(pathname)) headers.forEach(({ key, value }) => res.setHeader(key, value));
  }
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

// Só o que a Vercel publica: páginas, css e js. Workflows, sql e docs ficam de fora (.vercelignore).
const PUBLIC_PATTERN = /^(?:[\w-]+\.html|css\/[\w.-]+\.css|js\/(?:vendor\/)?[\w.-]+\.js|img\/[\w.-]+\.(?:png|svg))$/;

const pages = {
  "/": "index.html",
  "/pacientes": "index.html",
  "/relatorios": "relatorios.html",
  "/historico": "historico.html",
  "/configuracao": "configuracao.html",
  "/usuarios": "usuarios.html",
  "/solicitacoes": "solicitacoes.html",
  "/dashboard": "dashboard.html",
};

// Mesmas rotas e reescritas do vercel.json: cada trecho do caminho vira um parâmetro em req.query
// (ex.: /api/pacientes/123/liberar → pacientes com id=123 e op=liberar).
const routes = [
  [/^\/api\/pacientes$/, pacientes],
  [/^\/api\/pacientes\/([^/]+)$/, pacientes, ["id"]],
  [/^\/api\/pacientes\/([^/]+)\/(liberar|bloquear)$/, pacientes, ["id", "op"]],
  [/^\/api\/faltas$/, faltas],
  [/^\/api\/acoes$/, acoes],
  [/^\/api\/parametros$/, parametros],
  [/^\/api\/sessao$/, sessao],
  [/^\/api\/senha$/, senha],
  [/^\/api\/usuarios$/, usuarios],
  [/^\/api\/usuarios\/([^/]+)$/, usuarios, ["login"]],
  [/^\/api\/dashboard$/, dashboard],
  [/^\/api\/solicitacoes$/, solicitacoes],
  [/^\/api\/solicitacoes\/([^/]+)$/, solicitacoes, ["id"]],
  [/^\/api\/solicitacoes\/([^/]+)\/(liberar)$/, solicitacoes, ["id", "op"]],
];

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolve(undefined);
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(raw);
      }
    });
    req.on("error", reject);
  });

const sendFile = async (res, relativePath) => {
  const safePath = normalize(relativePath).replace(/\\/g, "/");

  if (!PUBLIC_PATTERN.test(safePath)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Não encontrado");
    return;
  }

  try {
    const content = await readFile(join(root, safePath));
    res.writeHead(200, {
      "Content-Type": mimeTypes[extname(safePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(content);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Não encontrado");
  }
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://localhost:${port}`);
    req.query = Object.fromEntries(url.searchParams);
    req.body = await readBody(req);
    applyHeaders(res, url.pathname);

    // Os trechos do caminho viram req.query.<param>, como fazem as reescritas do vercel.json.
    for (const [pattern, handler, params = []] of routes) {
      const match = url.pathname.match(pattern);
      if (match) {
        params.forEach((nome, i) => {
          req.query[nome] = decodeURIComponent(match[i + 1]);
        });
        await handler(req, res);
        return;
      }
    }

    if (url.pathname.startsWith("/api/")) {
      res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Rota não encontrada." }));
      return;
    }

    await sendFile(res, pages[url.pathname] || url.pathname.replace(/^\/+/, ""));
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    }
    res.end(JSON.stringify({ error: "Falha interna do servidor local." }));
  }
});

server.listen(port, () => {
  console.log(`Painel em http://localhost:${port}/pacientes`);
  console.log(`Leitura: ${process.env.N8N_LEITURA_URL ? "configurada" : "(N8N_LEITURA_URL vazio)"}`);
  console.log(`Ações:   ${process.env.N8N_ACOES_URL ? "configurada" : "(N8N_ACOES_URL vazio)"}`);
  console.log(`Usuários: ${process.env.N8N_USUARIOS_URL ? "configurada" : "(N8N_USUARIOS_URL vazio)"}`);
  console.log(`Solicitações: ${process.env.N8N_SOLICITACOES_URL ? "configurada" : "(N8N_SOLICITACOES_URL vazio)"}`);
  if (!process.env.SESSION_SECRET) console.log("Atenção: SESSION_SECRET vazio, ninguém consegue entrar.");
});
