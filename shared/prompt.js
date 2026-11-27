(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PromptText = factory();
})(typeof window === 'object' ? window : globalThis, function () {
  const MAX_TEXT = 65536;
  const MAX_SEND = 262144;
  const MAX_DOCUMENTS = 20;
  const controls = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
  const normalize = (text) => text.replace(/\r\n?/g, '\n');
  const byteLength = (text) => new TextEncoder().encode(text).length;

  function validate(draft, { allowEmpty = false } = {}) {
    if (!draft || typeof draft.text !== 'string' || draft.text.length > MAX_TEXT) throw new Error('Prompt trop long (maximum 64 Ko)');
    const text = normalize(draft.text);
    if (byteLength(text) > MAX_TEXT) throw new Error('Prompt trop long (maximum 64 Ko)');
    if (controls.test(text)) throw new Error('Le prompt contient des caractères de contrôle');
    if (!Array.isArray(draft.documents) || draft.documents.length > MAX_DOCUMENTS) throw new Error('Maximum 20 documents par prompt');
    const documents = draft.documents.map((document) => {
      if (!document || typeof document.path !== 'string' || !document.path.trim() || document.path.length > 4096 ||
          /[\x00-\x1f\x7f]/.test(document.path) || !['path', 'content'].includes(document.mode)) throw new Error('Référence de document invalide');
      return { path: document.path, mode: document.mode };
    });
    if (!allowEmpty && !text.trim() && !documents.length) throw new Error('Rédigez un prompt ou ajoutez un document');
    return { text, documents };
  }

  async function build(draft, readDocument) {
    const { text, documents } = validate(draft);
    const parts = text.trim() ? [text] : [];
    for (const document of documents) {
      if (document.mode === 'path') parts.push(`Document à consulter : ${document.path}`);
      else {
        const content = normalize(await readDocument(document.path));
        if (controls.test(content)) throw new Error('Le document contient des caractères de contrôle : ' + document.path);
        parts.push(`--- Début du document : ${document.path} ---\n${content}\n--- Fin du document ---`);
      }
    }
    const result = parts.join('\n\n');
    if (byteLength(result) > MAX_SEND) throw new Error('Texte à envoyer trop long (maximum 256 Ko) ; utilisez les chemins des documents');
    return result;
  }

  function wire(text, options) {
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_SEND) throw new Error('Texte à envoyer invalide ou trop long');
    if (!options || typeof options.bracketed !== 'boolean' || typeof options.submit !== 'boolean') throw new Error('Options d’envoi invalides');
    const normalized = normalize(text);
    if (byteLength(normalized) > MAX_SEND) throw new Error('Texte à envoyer invalide ou trop long');
    if (controls.test(normalized)) throw new Error('Le prompt contient des caractères de contrôle');
    const pasted = options.bracketed ? normalized : normalized.replace(/\n/g, '\r');
    return (options.bracketed ? '\x1b[200~' + pasted + '\x1b[201~' : pasted) + (options.submit ? '\r' : '');
  }

  function commandAt(text, start, end = start) {
    if (start !== end) return null;
    const match = text.slice(0, start).match(/(?:^|\s)\/([a-z]*)$/i);
    return match ? { start: start - match[1].length - 1, end: start, query: match[1].toLowerCase() } : null;
  }

  return { MAX_TEXT, MAX_SEND, MAX_DOCUMENTS, validate, build, wire, commandAt };
});
