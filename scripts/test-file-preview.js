// Run with: node scripts/test-file-preview.js
if (!process.versions.electron) require('./electron-test')(__filename);
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const JSZip = require('jszip');
const root = path.join(__dirname, '..');
const temp = process.env.ROBOTCONSOLE_TEST_TEMP;
if (!temp) throw new Error('Run this test with Node so the parent can clean up the Chromium profile.');
console.log('Preview fixture:', temp);
setTimeout(() => { console.error('Preview test timed out'); app.exit(1); }, 60000);
app.setPath('userData', path.join(temp, 'profile'));
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  console.log('Electron ready');
  let win;
  try {
    require('../main/fs-git').register();
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Bonjour DOCX</w:t></w:r></w:p></w:body></w:document>');
    fs.writeFileSync(path.join(temp, 'sample.DOCX'), await zip.generateAsync({ type: 'nodebuffer' }));
    fs.writeFileSync(path.join(temp, 'image.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1sAAAAASUVORK5CYII=', 'base64'));
    fs.writeFileSync(path.join(temp, 'sample.pdf'), '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
    fs.writeFileSync(path.join(temp, 'binary.bin'), Buffer.from([0, 1, 2]));
    fs.writeFileSync(path.join(temp, 'broken.docx'), 'invalid zip');
    fs.writeFileSync(path.join(temp, 'code.js'), 'const answer = 42;');
    const renderer = path.join(root, 'renderer');
    const csp = fs.readFileSync(path.join(renderer, 'index.html'), 'utf8').match(/<meta http-equiv="Content-Security-Policy"[^>]+>/)[0];
    const fixture = path.join(temp, 'test.html');
    fs.writeFileSync(fixture, `<base href="${pathToFileURL(renderer + path.sep).href}">${csp}<link rel="stylesheet" href="styles.css"><link rel="stylesheet" href="tools.css"><link rel="stylesheet" href="explorer.css">`);
    win = new BrowserWindow({ show: false, width: 900, height: 700, webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
    await win.loadFile(fixture);
    console.log('Fixture loaded');
    for (const file of ['../shared/platform.js', 'ui.js', '../node_modules/dompurify/dist/purify.min.js', 'editor.js']) {
      await win.webContents.executeJavaScript(fs.readFileSync(path.join(renderer, file), 'utf8'));
    }
    const result = await win.webContents.executeJavaScript(`(async () => {
      const dir = ${JSON.stringify(temp)};
      const assert = (value, message) => { if (!value) throw new Error(message); };
      const read = (name) => api.readFile(dir + '/' + name);
      assert((await read('code.js')).content === 'const answer = 42;', 'Text reading preserved');
      assert((await read('binary.bin')).kind === 'binary', 'Binary detection preserved');
      assert((await read('sample.DOCX')).html.includes('Bonjour DOCX'), 'DOCX converted');
      let rejected = false;
      try { await read('broken.docx'); } catch { rejected = true; }
      assert(rejected, 'Invalid DOCX rejected');
      const wait = async (test) => {
        for (let i = 0; i < 200; i++) { if (test()) return; await new Promise(r => setTimeout(r, 25)); }
        throw new Error('Timed out waiting for preview');
      };
      for (const [file, selector] of [['image.png', 'img'], ['sample.pdf', 'embed'], ['sample.DOCX', '.file-docx'], ['binary.bin', '.pv-empty'], ['broken.docx', '.pv-empty']]) {
        const pane = document.createElement('div'); pane.className = 'tab-pane active';
        pane.style.height = '500px'; document.body.append(pane);
        const tab = { pane, el: document.createElement('div') };
        TabKinds.editor.mount(tab, { file: dir + '/' + file });
        await wait(() => pane.querySelector(selector) && pane.querySelector('.file-external'));
        assert(getComputedStyle(pane.querySelector('.ed-bar .tb-btn')).display === 'none', 'Save hidden in previews');
        assert(getComputedStyle(pane.querySelector('.ed-bar .icon-btn')).display === 'none', 'Find hidden in previews');
        if (file === 'image.png') await wait(() => pane.querySelector('img').naturalWidth === 1);
        if (file === 'sample.pdf') {
          const embed = pane.querySelector('embed');
          assert(embed.type === 'application/pdf' && embed.src.startsWith('data:application/pdf;base64,'), 'PDF sent to native viewer');
          assert(embed.getBoundingClientRect().height > 300, 'PDF fills its tab');
        }
        assert(await TabKinds.editor.canClose(tab), 'Preview closes without save prompt');
        TabKinds.editor.dispose(tab); pane.remove();
      }
      const host = document.createElement('div');
      FilePreview.render(host, 'unsafe.docx', { kind: 'docx', html: '<script>window.pwned=1</script><a href="javascript:alert(1)">Link</a><img src="https://example.com/track"><p onclick="alert(1)">Safe</p>' });
      assert(!host.querySelector('script, a, [onclick], [src^="https:"]'), 'DOCX active content and external images removed');
      assert(host.textContent.includes('Safe'), 'DOCX text preserved');
      return 'Text, image, PDF, DOCX, binary, corrupt document, tab controls and sanitization passed';
    })()`);
    assert.ok(result);
    console.log(result);
    win.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error);
    win?.destroy();
    app.exit(1);
  }
});
