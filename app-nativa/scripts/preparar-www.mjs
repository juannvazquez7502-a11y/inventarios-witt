// Prepara www/ de la app nativa (lo corre GitHub Actions desde app-nativa/).
// - La app abre la página publicada en GitHub Pages (server.url): así se actualiza sola, como hoy.
// - www/inventarios-witt/sin-conexion.html es una COPIA del index.html publicado (el FINAL.html armado) que se abre
//   solo si no hay internet y el teléfono todavía no tiene la app guardada (server.errorPath). Vive en el mismo
//   dominio que la página publicada, así que ve los mismos datos guardados en el teléfono y recibe el puente nativo.
// - En esa copia, las librerías de <script src="https://..."> se ponen dentro de la página para que funcionen sin
//   internet (Excel, ZIP, QR, lector de códigos, nube). Si alguna no se puede descargar, se deja la liga como está.
// - Los MP4 de las intros NO se copian (se ven en línea, como hoy).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const RAIZ = "..";            // raíz del repositorio
const WWW = "www";
const ORIGEN = join(RAIZ, "index.html");
const SITIO = "https://juannvazquez7502-a11y.github.io/inventarios-witt/";
// Se ponen dentro de la página (no Tesseract: sin internet tampoco tendría sus archivos de idioma).
const EN_LINEA = /cdn\.sheetjs\.com\/xlsx|npm\/jsQR@|npm\/zxing-wasm@|npm\/jszip@|npm\/@supabase\/supabase-js@/;

if (!existsSync(ORIGEN)) throw new Error("No existe " + ORIGEN + " (el index.html publicado).");
let html = readFileSync(ORIGEN, "utf8");
const bytesAntes = Buffer.byteLength(html);
mkdirSync(join(WWW, "inventarios-witt"), { recursive: true });

const etiquetas = [...html.matchAll(/<script src="(https:\/\/[^"]+)"( defer)?><\/script>/g)];
const informe = [];
for (const m of etiquetas) {
  const [etiqueta, url] = m;
  if (!EN_LINEA.test(url)) { informe.push({ url, enLinea: false, motivo: "se deja en CDN" }); continue; }
  try {
    const r = await fetch(url, { redirect: "follow" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    let js = await r.text();
    if (js.length < 1000) throw new Error("respuesta muy corta");
    // "<!--" junto con "<script" cambiaría cómo el navegador corta el bloque: en ese caso se deja en CDN.
    if (js.includes("<!--") && /<script/i.test(js)) throw new Error("trae <!-- y <script; se deja en CDN");
    js = js.replace(/<\/script/gi, "<\\/script");
    const nuevo = "<script data-origen=\"" + url + "\">\n" + js + "\n</script>";
    html = html.replace(etiqueta, () => nuevo);
    informe.push({ url, enLinea: true, bytes: js.length });
  } catch (e) {
    informe.push({ url, enLinea: false, motivo: String(e.message || e) });
  }
}
writeFileSync(join(WWW, "inventarios-witt", "sin-conexion.html"), html, "utf8");

// www/index.html: no se usa (la app abre server.url), pero Capacitor lo pide. Si algún día se abre, manda a la página.
writeFileSync(join(WWW, "index.html"), `<!doctype html>
<html lang="es-MX"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Inventarios</title><style>html,body{margin:0;height:100%;background:#00574a;color:#fff;font:16px system-ui,sans-serif;display:grid;place-items:center}</style>
</head><body><p>Abriendo Inventarios…</p><script>location.replace(${JSON.stringify(SITIO)});</script></body></html>
`, "utf8");

console.log(JSON.stringify({ origen: ORIGEN, bytesAntes, bytesCopia: Buffer.byteLength(html), librerias: informe }, null, 2));
