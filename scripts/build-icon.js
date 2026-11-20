// Génère build/icon.png et build/icon.ico à partir de build/icon.svg (lancer avec electron)
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'build');

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(dir, 'icon.svg'), 'utf8');
  const win = new BrowserWindow({ width: 256, height: 256, show: false, frame: false, transparent: true, useContentSize: true });
  const html = `<html><body style="margin:0;background:transparent;overflow:hidden">${svg.replace('<svg ', '<svg width="256" height="256" ')}</body></html>`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 300));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 256, height: 256 });
  const base = img.resize({ width: 256, height: 256, quality: 'best' });
  fs.writeFileSync(path.join(dir, 'icon.png'), base.toPNG());

  // ICO contenant des images PNG (16 à 256 px)
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = sizes.map((s) => (s === 256 ? base : base.resize({ width: s, height: s, quality: 'best' })).toPNG());
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((s, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(s === 256 ? 0 : s, e); header.writeUInt8(s === 256 ? 0 : s, e + 1);
    header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(pngs[i].length, e + 8); header.writeUInt32LE(offset, e + 12);
    offset += pngs[i].length;
  });
  fs.writeFileSync(path.join(dir, 'icon.ico'), Buffer.concat([header, ...pngs]));
  console.log('icône générée');
  app.quit();
});
