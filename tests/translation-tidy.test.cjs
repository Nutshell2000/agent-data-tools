const assert = require('node:assert/strict');
const { test } = require('node:test');
const { build } = require('esbuild');

// 16 Nov 2026: M2M100 answers with tokenizer spacing ("Hola , mundo !"); subtitles and dubbing tidy it.
test('translation tidy: punctuation back against the word, French spacing kept', async () => {
  const b = await build({ entryPoints: ['src/lib/translation-tidy.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  const { tidyTranslation: t } = m.exports;
  assert.equal(t('Hola , mundo !', 'es'), 'Hola, mundo!');
  assert.equal(t('¿ Qué tal ?', 'es'), '¿Qué tal?');
  assert.equal(t('Välkommen till kursen .', 'sv'), 'Välkommen till kursen.');
  assert.equal(t('Er sagte ( leise ) : nein', 'de'), 'Er sagte (leise): nein');
  assert.equal(t("l ' homme est là !", 'fr'), "l'homme est là !");
  assert.equal(t('Bonjour , le monde : oui', 'fr'), 'Bonjour, le monde : oui');
  assert.equal(t('  plain text  ', 'it'), 'plain text');
  assert.equal(t('3 , 5 %', 'en'), '3, 5%');
});
