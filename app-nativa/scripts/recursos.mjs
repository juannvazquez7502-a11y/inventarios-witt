// Arma assets/ para @capacitor/assets con los íconos del repositorio (icono-512.png e icono-maskable-512.png).
// - Ícono: icono-512 (normal) y, para el ícono adaptable de Android, el maskable encima de un fondo del mismo verde.
// - Splash: el logo maskable al centro sobre el mismo verde (claro y oscuro iguales).
// El verde se toma de la esquina del ícono, para que no se note ninguna orilla.
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const RAIZ = "..";
const ICONO = join(RAIZ, "icono-512.png");
const MASK = join(RAIZ, "icono-maskable-512.png");
for (const f of [ICONO, MASK]) if (!existsSync(f)) throw new Error("No existe " + f);
mkdirSync("assets", { recursive: true });

const { data } = await sharp(MASK).removeAlpha().extract({ left: 2, top: 2, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
const fondo = { r: data[0], g: data[1], b: data[2], alpha: 1 };
const hex = "#" + [data[0], data[1], data[2]].map(n => n.toString(16).padStart(2, "0")).join("");

await sharp(ICONO).resize(1024, 1024, { kernel: "lanczos3" }).png().toFile("assets/icon-only.png");
await sharp(MASK).resize(1024, 1024, { kernel: "lanczos3" }).png().toFile("assets/icon-foreground.png");
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: fondo } }).png().toFile("assets/icon-background.png");
const logo = await sharp(MASK).resize(1100, 1100, { kernel: "lanczos3" }).png().toBuffer();
for (const n of ["splash.png", "splash-dark.png"]) {
  await sharp({ create: { width: 2732, height: 2732, channels: 4, background: fondo } })
    .composite([{ input: logo, gravity: "center" }]).png().toFile(join("assets", n));
}
console.log(JSON.stringify({ verde: hex, archivos: ["icon-only", "icon-foreground", "icon-background", "splash", "splash-dark"] }));
// Para el paso siguiente (capacitor-assets ... --iconBackgroundColor / --splashBackgroundColor).
if (process.env.GITHUB_ENV) {
  const { appendFileSync } = await import("node:fs");
  appendFileSync(process.env.GITHUB_ENV, "VERDE_ICONO=" + hex + "\n");
}
