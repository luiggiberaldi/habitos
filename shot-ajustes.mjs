import { chromium } from "playwright";
const browser = await chromium.launch({ executablePath: "/opt/meta-chromium/chrome", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
// seed con settings incompleto (el caso que rompía antes)
await page.addInitScript(() => {
  window.localStorage.setItem("habitos-app-v1", JSON.stringify({
    habits: [], completions: [],
    settings: { notificaciones: false, tema: "oscuro" }, // sin horasDescanso
    version: 1,
  }));
});
await page.goto("http://localhost:3100/ajustes", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.screenshot({ path: "/tmp/ajustes-top.png" });
// scroll a la zona de peligro
await page.locator("text=Zona de peligro").scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await page.screenshot({ path: "/tmp/ajustes-peligro.png" });
// abrir el modal
await page.click("text=Reiniciar la app");
await page.waitForTimeout(400);
await page.screenshot({ path: "/tmp/modal-reinicio.png" });
// armar el doble toque
await page.click("text=Borrar todo");
await page.waitForTimeout(300);
await page.screenshot({ path: "/tmp/modal-armado.png" });
console.log("errores:", errs.length ? errs : "ninguno");
await browser.close();
