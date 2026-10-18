// Gera os .docx de docs/word a partir dos .md de docs/ (`npm run word` na raiz do repositório).
// - Cada .md vira um .docx com capa, sumário, cabeçalho e rodapé; "00 - Documentação completa.docx" junta todos.
// - Blocos ```mermaid viram imagens (renderizadas no Chrome/Edge via puppeteer-core).
// - Links entre documentos viram texto (o Word não navega entre .md); links http continuam clicáveis.
// Requer Chrome ou Edge instalado. Caminho diferente: variável CHROME_PATH.
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { marked } from "marked";
import puppeteer from "puppeteer-core";
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = join(aqui, "..", "..", "..");
const docs = join(raiz, "docs");
const saida = join(docs, "word");

// Ordem e nomes dos arquivos gerados.
const DOCUMENTOS = [
  { arquivo: "visao-geral.md", titulo: "Visão geral do sistema", saida: "01 - Visão geral (não técnica).docx" },
  { arquivo: "seguranca-resumo.md", titulo: "Segurança: resumo para a liderança", saida: "02 - Segurança (resumo para a liderança).docx" },
  { arquivo: "regras.md", titulo: "Regras de negócio", saida: "03 - Regras de negócio.docx" },
  { arquivo: "README.md", titulo: "Índice e mapa da documentação", saida: "04 - Índice.docx" },
  { arquivo: "arquitetura.md", titulo: "Arquitetura", saida: "05 - Arquitetura.docx" },
  { arquivo: "front-end.md", titulo: "Painel (interface)", saida: "06 - Painel (interface).docx" },
  { arquivo: "bloqueio.md", titulo: "Workflow de bloqueio (01:00)", saida: "07 - Fluxo de bloqueio.docx" },
  { arquivo: "fluxos/leitura.md", titulo: "Workflow CNN Painel - Leitura", saida: "08 - Fluxo de leitura.docx" },
  { arquivo: "fluxos/acoes.md", titulo: "Workflow CNN Painel - Ações", saida: "09 - Fluxo de ações (liberar e bloquear).docx" },
  { arquivo: "fluxos/usuarios.md", titulo: "Workflow CNN Painel - Usuários", saida: "10 - Fluxo de usuários.docx" },
  { arquivo: "api-cnn.md", titulo: "Integração com a API do CNN", saida: "11 - Integração com a API CNN.docx" },
  { arquivo: "banco-de-dados.md", titulo: "Banco de dados", saida: "12 - Banco de dados.docx" },
  { arquivo: "script-sql.md", titulo: "Scripts SQL", saida: "13 - Scripts SQL.docx" },
  { arquivo: "operacao.md", titulo: "Operação", saida: "14 - Operação.docx" },
  { arquivo: "seguranca.md", titulo: "Segurança (técnica)", saida: "15 - Segurança (técnica).docx" },
  { arquivo: "liberacao.md", titulo: "Liberação automática (desativada)", saida: "16 - Liberação automática (desativada).docx" },
  { arquivo: "../CHANGELOG.md", titulo: "Histórico de mudanças", saida: "17 - Histórico de mudanças.docx" },
];
const COMPLETO = "00 - Documentação completa.docx";

// Cores Clariens (as mesmas do painel).
const AZUL = "1C1FC8";
const ROXO = "7B1FE4";
const CINZA = "5B5F73";
const FONTE = "Calibri";
const FONTE_MONO = "Consolas";
const LARGURA_MAX_IMG = 620; // px (cabe na página A4 com margens de 2 cm)
const ALTURA_MAX_IMG = 900;

const hoje = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long", year: "numeric", timeZone: "America/Sao_Paulo" }).format(new Date());

// ---------- Mermaid → PNG ----------
const chrome =
  process.env.CHROME_PATH ||
  ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(existsSync);
if (!chrome) throw new Error("Chrome/Edge não encontrado. Defina CHROME_PATH.");

const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
const pagina = await browser.newPage();
await pagina.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 3 });
await pagina.setContent(`<!doctype html><html><body style="margin:0;background:#fff"><div id="alvo" style="display:inline-block;padding:12px;background:#fff"></div></body></html>`);
await pagina.addScriptTag({ path: join(aqui, "node_modules", "mermaid", "dist", "mermaid.min.js") });
await pagina.evaluate((cores) => {
  window.mermaid.initialize({
    startOnLoad: false,
    theme: "base",
    fontFamily: "Segoe UI, Calibri, Arial, sans-serif",
    themeVariables: {
      primaryColor: "#EEE8FD",
      primaryBorderColor: cores.roxo,
      primaryTextColor: "#1A1A2E",
      lineColor: cores.azul,
      secondaryColor: "#E6E7FB",
      tertiaryColor: "#F6F4FE",
      fontSize: "15px",
    },
    // Tamanho natural (sem encolher para caber na tela): a escala para a página é feita depois.
    flowchart: { htmlLabels: true, curve: "basis", useMaxWidth: false },
    sequence: { mirrorActors: false, useMaxWidth: false },
    er: { useMaxWidth: false },
    state: { useMaxWidth: false },
  });
}, { roxo: `#${ROXO}`, azul: `#${AZUL}` });

const imagens = new Map();
let contador = 0;
const renderizar = async (codigo) => {
  const id = `m${++contador}`;
  const tamanho = await pagina.evaluate(async (id, codigo) => {
    const alvo = document.getElementById("alvo");
    const { svg } = await window.mermaid.render(id, codigo);
    alvo.innerHTML = svg;
    const r = alvo.getBoundingClientRect();
    return { w: Math.ceil(r.width), h: Math.ceil(r.height) };
  }, id, codigo);
  return { tamanho, png: await (await pagina.$("#alvo")).screenshot({ type: "png" }) };
};

// Na página do Word cabem ~620 px de largura. Fluxograma ou diagrama de estados largo é refeito na vertical
// (o .md continua horizontal, que fica melhor na tela); diagrama de sequência é compactado (texto quebrado).
const versaoVertical = (codigo) => {
  if (/^\s*flowchart\s+(LR|RL)\b/.test(codigo)) return codigo.replace(/^(\s*flowchart\s+)(LR|RL)\b/, "$1TD");
  if (/^\s*stateDiagram/.test(codigo) && /^\s*direction\s+LR\s*$/m.test(codigo)) return codigo.replace(/^\s*direction\s+LR\s*$/m, "    direction TB");
  if (/^\s*sequenceDiagram/.test(codigo) && !/%%\{init/.test(codigo)) {
    return `%%{init: {"sequence": {"wrap": true, "width": 120, "actorMargin": 24, "messageMargin": 28, "boxMargin": 6}} }%%\n${codigo}`;
  }
  return null;
};

const mermaidPng = async (codigo) => {
  const chave = createHash("sha1").update(codigo).digest("hex");
  if (imagens.has(chave)) return imagens.get(chave);
  let { tamanho, png } = await renderizar(codigo);
  // Escala que cabe na página: até 620 px de largura e 900 px de altura (A4 com margens).
  const escalaDe = (tam) => Math.min(1, LARGURA_MAX_IMG / tam.w, ALTURA_MAX_IMG / tam.h);
  const vertical = tamanho.w > LARGURA_MAX_IMG * 1.4 ? versaoVertical(codigo) : null;
  if (vertical) {
    const nova = await renderizar(vertical);
    // Fica com a orientação que deixa o diagrama maior (mais legível) na página.
    if (escalaDe(nova.tamanho) > escalaDe(tamanho)) ({ tamanho, png } = nova);
  }
  const escala = escalaDe(tamanho);
  const img = { png, largura: Math.round(tamanho.w * escala), altura: Math.round(tamanho.h * escala) };
  // Ainda muito largo: fica pequeno na página (dá para ampliar no Word, a imagem é em alta resolução).
  if (escala < 0.6) console.warn(`  ! diagrama largo (${tamanho.w}px, reduzido a ${Math.round(escala * 100)}%): ${codigo.split("\n").slice(0, 2).join(" | ").slice(0, 90)}`);
  imagens.set(chave, img);
  return img;
};

// ---------- Markdown → elementos do Word ----------
const runsInline = (tokens = [], estilo = {}) => {
  const runs = [];
  for (const t of tokens) {
    switch (t.type) {
      case "strong":
        runs.push(...runsInline(t.tokens, { ...estilo, bold: true }));
        break;
      case "em":
        runs.push(...runsInline(t.tokens, { ...estilo, italics: true }));
        break;
      case "del":
        runs.push(...runsInline(t.tokens, { ...estilo, strike: true }));
        break;
      case "codespan":
        runs.push(new TextRun({ text: decode(t.text), font: FONTE_MONO, size: 18, color: "6A1BBF", shading: { type: ShadingType.CLEAR, fill: "F1ECFB", color: "auto" }, ...estilo }));
        break;
      case "link": {
        const filhos = runsInline(t.tokens, { ...estilo, color: AZUL, underline: /^https?:/.test(t.href) ? {} : undefined });
        if (/^https?:/.test(t.href)) runs.push(new ExternalHyperlink({ link: t.href, children: filhos }));
        else runs.push(...filhos); // link entre .md: só o texto
        break;
      }
      case "br":
        runs.push(new TextRun({ break: 1 }));
        break;
      case "text":
      case "escape":
        if (t.tokens?.length) runs.push(...runsInline(t.tokens, estilo));
        else runs.push(new TextRun({ text: decode(t.text), ...estilo }));
        break;
      case "html":
        if (/<br\s*\/?>/i.test(t.text)) runs.push(new TextRun({ break: 1 }));
        break;
      default:
        if (t.text) runs.push(new TextRun({ text: decode(t.text), ...estilo }));
    }
  }
  return runs;
};

const decode = (s) =>
  String(s ?? "")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");

let instanciaLista = 1;
const lista = (token, nivel, instancia) => {
  const saida = [];
  const ordenada = token.ordered;
  const inst = instancia ?? instanciaLista++;
  for (const item of token.items) {
    let primeiro = true;
    for (const t of item.tokens) {
      if (t.type === "list") {
        saida.push(...lista(t, nivel + 1));
      } else if (t.type === "text" || t.type === "paragraph") {
        saida.push(
          new Paragraph({
            children: runsInline(t.tokens ?? [{ type: "text", text: t.text }]),
            numbering: primeiro ? { reference: ordenada ? "numeros" : "marcadores", level: Math.min(nivel, 3), instance: ordenada ? inst : undefined } : undefined,
            indent: primeiro ? undefined : { left: 720 * (nivel + 1) },
            spacing: { after: 60 },
          }),
        );
        primeiro = false;
      } else {
        saida.push(...blocos([t]));
      }
    }
  }
  return saida;
};

const LARGURA_TEXTO = 9638; // twips: A4 (11906) menos as margens de 2 cm

// Largura de cada coluna proporcional ao texto mais longo dela (com piso e teto),
// para uma coluna "#" não ocupar o mesmo espaço que uma de descrição.
const largurasColunas = (token) => {
  const pesos = token.header.map((h, i) => {
    const textos = [h.text, ...token.rows.map((linha) => linha[i]?.text ?? "")];
    const maior = Math.max(...textos.map((t) => Math.min(t.replace(/[*`]/g, "").length, 70)));
    return Math.max(maior, 6) ** 0.85;
  });
  const total = pesos.reduce((a, b) => a + b, 0);
  return pesos.map((p) => Math.round((p / total) * LARGURA_TEXTO));
};

const celula = (conteudo, { cabecalho = false, par = false, largura } = {}) =>
  new TableCell({
    width: largura ? { size: largura, type: WidthType.DXA } : undefined,
    children: [
      new Paragraph({
        children: runsInline(conteudo.tokens ?? [{ type: "text", text: conteudo.text }], cabecalho ? { bold: true, color: "FFFFFF" } : {}),
        spacing: { before: 40, after: 40 },
      }),
    ],
    shading: cabecalho ? { type: ShadingType.CLEAR, fill: AZUL, color: "auto" } : par ? { type: ShadingType.CLEAR, fill: "F6F4FE", color: "auto" } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
  });

const borda = { style: BorderStyle.SINGLE, size: 4, color: "D9D6EA" };
const tabela = (token) => {
  const larguras = largurasColunas(token);
  return new Table({
    width: { size: LARGURA_TEXTO, type: WidthType.DXA },
    columnWidths: larguras,
    layout: TableLayoutType.FIXED,
    borders: { top: borda, bottom: borda, left: borda, right: borda, insideHorizontal: borda, insideVertical: borda },
    rows: [
      new TableRow({ tableHeader: true, children: token.header.map((h, j) => celula(h, { cabecalho: true, largura: larguras[j] })) }),
      ...token.rows.map(
        (linha, i) => new TableRow({ cantSplit: true, children: linha.map((c, j) => celula(c, { par: i % 2 === 1, largura: larguras[j] })) }),
      ),
    ],
  });
};

const pendentes = []; // imagens Mermaid a resolver (async) antes de montar o documento
const blocos = (tokens) => {
  const saida = [];
  for (const t of tokens) {
    switch (t.type) {
      case "heading": {
        const nivel = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4][Math.min(t.depth, 4) - 1];
        saida.push(new Paragraph({ heading: nivel, children: runsInline(t.tokens) }));
        break;
      }
      case "paragraph":
        // "Voltar ao índice" só faz sentido no GitHub.
        if (/^Voltar ao /.test(t.text)) {
          const resto = t.text.replace(/^Voltar ao \[índice\]\([^)]*\)\.?\s*/, "");
          if (!resto) break;
          saida.push(new Paragraph({ children: runsInline(marked.lexer(resto)[0]?.tokens ?? []), spacing: { after: 120 } }));
          break;
        }
        saida.push(new Paragraph({ children: runsInline(t.tokens), spacing: { after: 120 } }));
        break;
      case "list":
        saida.push(...lista(t, 0));
        saida.push(new Paragraph({ spacing: { after: 60 }, children: [] }));
        break;
      case "table":
        saida.push(tabela(t));
        saida.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
        break;
      case "code":
        if (t.lang === "mermaid") {
          const marcador = { mermaid: t.text };
          pendentes.push(marcador);
          saida.push(marcador);
        } else {
          saida.push(
            ...t.text.split("\n").map(
              (linha, i, todas) =>
                new Paragraph({
                  children: [new TextRun({ text: linha || " ", font: FONTE_MONO, size: 17, color: "2B2B3A" })],
                  shading: { type: ShadingType.CLEAR, fill: "F3F3F7", color: "auto" },
                  spacing: { before: i === 0 ? 80 : 0, after: i === todas.length - 1 ? 160 : 0, line: 260 },
                  indent: { left: 200, right: 200 },
                }),
            ),
          );
        }
        break;
      case "blockquote":
        for (const filho of t.tokens) {
          saida.push(
            new Paragraph({
              children: runsInline(filho.tokens ?? [{ type: "text", text: filho.text }], { italics: true, color: CINZA }),
              border: { left: { style: BorderStyle.SINGLE, size: 18, color: ROXO, space: 8 } },
              shading: { type: ShadingType.CLEAR, fill: "F6F4FE", color: "auto" },
              indent: { left: 240 },
              spacing: { before: 80, after: 120 },
            }),
          );
        }
        break;
      case "hr":
      case "space":
      case "html":
        break;
      default:
        if (t.text) saida.push(new Paragraph({ children: [new TextRun(decode(t.text))] }));
    }
  }
  return saida;
};

// Troca os marcadores Mermaid pelas imagens já renderizadas.
const resolverImagens = async (elementos) => {
  const final = [];
  for (const el of elementos) {
    if (el && el.mermaid) {
      try {
        const img = await mermaidPng(el.mermaid);
        final.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 120, after: 200 },
            children: [new ImageRun({ type: "png", data: img.png, transformation: { width: img.largura, height: img.altura } })],
          }),
        );
      } catch (erro) {
        final.push(new Paragraph({ children: [new TextRun({ text: `[diagrama não renderizado: ${erro.message.split("\n")[0]}]`, italics: true, color: "B00020" })] }));
      }
    } else {
      final.push(el);
    }
  }
  return final;
};

const lerDoc = (doc) => {
  let texto = readFileSync(join(docs, doc.arquivo), "utf8").replace(/\r\n/g, "\n");
  // O título do .md é trocado pelo título do documento (capa e sumário ficam consistentes).
  texto = texto.replace(/^# .*\n/, "");
  return [new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new TextRun(doc.titulo)] }), ...blocos(marked.lexer(texto))];
};

// ---------- capa, cabeçalho, rodapé, estilos ----------
const logo = readFileSync(join(raiz, "img", "logo-clariens-preto.png"));
const capa = (titulo, subtitulo) => [
  new Paragraph({ spacing: { before: 1800 }, alignment: AlignmentType.CENTER, children: [new ImageRun({ type: "png", data: logo, transformation: { width: 240, height: 89 } })] }),
  new Paragraph({ spacing: { before: 1200 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Bloqueio por faltas CNN", bold: true, size: 56, color: AZUL, font: FONTE })] }),
  new Paragraph({ spacing: { before: 200 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: titulo, size: 36, color: ROXO, font: FONTE })] }),
  ...(subtitulo ? [new Paragraph({ spacing: { before: 120 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: subtitulo, size: 24, color: CINZA, font: FONTE })] })] : []),
  new Paragraph({ spacing: { before: 2400 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: `Atualizado em ${hoje}`, size: 22, color: CINZA, font: FONTE })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Clariens Educação · Uso interno", size: 20, color: CINZA, font: FONTE })] }),
  new Paragraph({ children: [new PageBreak()] }),
  new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Sumário")] }),
  new Paragraph({ children: [new TextRun({ text: "Se o sumário aparecer vazio, clique nele com o botão direito e escolha \"Atualizar campo\".", italics: true, size: 18, color: CINZA })] }),
  new TableOfContents("Sumário", { hyperlink: true, headingStyleRange: "1-2" }),
];

const cabecalho = new Header({
  children: [
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: ROXO, space: 4 } },
      children: [new TextRun({ text: "Clariens Educação · Bloqueio por faltas CNN", size: 16, color: CINZA, font: FONTE })],
    }),
  ],
});
const rodape = new Footer({
  children: [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ children: ["Página ", PageNumber.CURRENT, " de ", PageNumber.TOTAL_PAGES], size: 16, color: CINZA, font: FONTE })],
    }),
  ],
});

const nivelLista = (formato, texto) =>
  [0, 1, 2, 3].map((nivel) => ({
    level: nivel,
    format: formato,
    text: typeof texto === "function" ? texto(nivel) : texto,
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 720 * (nivel + 1), hanging: 360 } } },
  }));

const montar = async (titulo, subtitulo, elementos) =>
  new Document({
    creator: "Clariens Educação",
    title: `Bloqueio por faltas CNN · ${titulo}`,
    description: "Gerado de docs/*.md por docs/word/gerador",
    features: { updateFields: true },
    styles: {
      default: { document: { run: { font: FONTE, size: 21, color: "1F2333" }, paragraph: { spacing: { line: 288 } } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 36, bold: true, color: AZUL, font: FONTE }, paragraph: { spacing: { before: 240, after: 200 }, border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: ROXO, space: 6 } } } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 28, bold: true, color: ROXO, font: FONTE }, paragraph: { spacing: { before: 320, after: 120 }, keepNext: true } },
        { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 24, bold: true, color: AZUL, font: FONTE }, paragraph: { spacing: { before: 240, after: 100 }, keepNext: true } },
        { id: "Heading4", name: "Heading 4", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 22, bold: true, color: CINZA, font: FONTE }, paragraph: { spacing: { before: 200, after: 80 }, keepNext: true } },
      ],
    },
    numbering: {
      config: [
        { reference: "marcadores", levels: nivelLista(LevelFormat.BULLET, (n) => ["•", "◦", "▪", "–"][n]) },
        { reference: "numeros", levels: nivelLista(LevelFormat.DECIMAL, (n) => `%${n + 1}.`) },
      ],
    },
    sections: [
      {
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134, header: 567, footer: 567 } } },
        headers: { default: cabecalho },
        footers: { default: rodape },
        children: [...capa(titulo, subtitulo), ...(await resolverImagens(elementos))],
      },
    ],
  });

// ---------- gerar ----------
const gerados = [];
const todos = [];
for (const doc of DOCUMENTOS) {
  // Objetos do docx não são reaproveitados entre documentos: o completo lê o .md de novo.
  todos.push(...lerDoc(doc));
  const documento = await montar(doc.titulo, null, lerDoc(doc));
  writeFileSync(join(saida, doc.saida), await Packer.toBuffer(documento));
  gerados.push(doc.saida);
  console.log("✓", doc.saida);
}
const completo = await montar("Documentação completa", "Visão geral, regras, arquitetura, fluxos, banco de dados e operação", todos);
writeFileSync(join(saida, COMPLETO), await Packer.toBuffer(completo));
gerados.push(COMPLETO);
console.log("✓", COMPLETO);

// Remove .docx antigos que não são mais gerados (nomes de versões anteriores).
for (const nome of readdirSync(saida)) {
  if (nome.endsWith(".docx") && !gerados.includes(nome)) {
    unlinkSync(join(saida, nome));
    console.log("removido (versão antiga):", nome);
  }
}

await browser.close();
console.log(`\n${gerados.length} arquivos em docs/word · ${imagens.size} diagramas`);
