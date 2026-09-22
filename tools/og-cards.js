// Genera una tarjeta Open Graph por idioma, 1200x630.
//
// Reconstruida sobre los assets reales de la app (fondo de portada, logo y
// wordmark) en vez de reescribir texto encima del JPEG existente: el texto del
// original esta rasterizado y taparlo dejaria cercos.
const { chromium } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');

// Necesita `playwright-core` y un Chromium. `chromium.executablePath()` sirve
// si Playwright lo instalo; si no, pasa la ruta en CHROMIUM_PATH.
const NAVEGADOR = process.env.CHROMIUM_PATH || require('playwright-core').chromium.executablePath();
const PUBLICO = path.resolve(__dirname, '../frontend/public');
const SALIDA = path.resolve(__dirname, '../docs/screenshots/og');

const TEXTOS = {
  en: ['End-to-end verifiable anonymous voting',
       'Your ballot is encrypted on your device. Only the final total is ever decrypted, and anyone can audit the count.',
       ['Anonymous', 'Verifiable', 'Coercion resistant']],
  es: ['Voto anónimo verificable de extremo a extremo',
       'Tu papeleta se cifra en tu dispositivo. Solo se descifra el total final, y cualquiera puede auditar el recuento.',
       ['Anónimo', 'Verificable', 'Resistente a coacción']],
  fr: ['Vote anonyme vérifiable de bout en bout',
       'Votre bulletin est chiffré sur votre appareil. Seul le total final est déchiffré, et chacun peut auditer le dépouillement.',
       ['Anonyme', 'Vérifiable', 'Résistant à la coercition']],
  de: ['Ende-zu-Ende überprüfbare anonyme Wahl',
       'Ihr Stimmzettel wird auf Ihrem Gerät verschlüsselt. Nur das Endergebnis wird entschlüsselt, und jede Person kann die Auszählung prüfen.',
       ['Anonym', 'Überprüfbar', 'Zwangsresistent']],
  it: ['Voto anonimo verificabile end-to-end',
       'La tua scheda è cifrata sul tuo dispositivo. Si decifra solo il totale finale, e chiunque può verificare lo spoglio.',
       ['Anonimo', 'Verificabile', 'Resistente alla coercizione']],
  pt: ['Voto anónimo verificável de ponta a ponta',
       'O seu boletim é cifrado no seu dispositivo. Só o total final é decifrado, e qualquer pessoa pode auditar a contagem.',
       ['Anónimo', 'Verificável', 'Resistente a coação']],
  nl: ['End-to-end verifieerbaar anoniem stemmen',
       'Je stembiljet wordt op je eigen apparaat versleuteld. Alleen het eindtotaal wordt ontsleuteld, en iedereen kan de telling controleren.',
       ['Anoniem', 'Verifieerbaar', 'Dwangbestendig']],
  ja: ['エンドツーエンドで検証可能な匿名投票',
       '投票用紙はお使いの端末で暗号化されます。復号されるのは最終集計だけで、誰でも集計を検証できます。',
       ['匿名', '検証可能', '強要に強い']],
  ko: ['종단 간 검증 가능한 익명 투표',
       '투표용지는 사용자의 기기에서 암호화됩니다. 복호화되는 것은 최종 집계뿐이며, 누구나 집계를 검증할 수 있습니다.',
       ['익명', '검증 가능', '강요에 강함']],
  zh: ['端到端可验证的匿名投票',
       '选票在你的设备上加密。只有最终总数会被解密，任何人都可以核验计票。',
       ['匿名', '可验证', '抗胁迫']],
  hi: ['एंड-टू-एंड सत्यापन योग्य गुमनाम मतदान',
       'आपका मतपत्र आपके उपकरण पर एन्क्रिप्ट होता है। केवल अंतिम योग ही डिक्रिप्ट होता है, और कोई भी गणना की जाँच कर सकता है।',
       ['गुमनाम', 'सत्यापन योग्य', 'दबाव-प्रतिरोधी']],
};

const escapar = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const aUrl = f => 'file:///' + path.join(PUBLICO, f).replace(/\\/g, '/');

(async () => {
  const plantilla = fs.readFileSync(path.join(__dirname, 'og-card.html'), 'utf8');
  fs.mkdirSync(SALIDA, { recursive: true });

  const navegador = await chromium.launch({ executablePath: NAVEGADOR });
  const contexto = await navegador.newContext({ viewport: { width: 1200, height: 630 } });
  const pagina = await contexto.newPage();

  for (const [idioma, [titular, subtitulo, etiquetas]] of Object.entries(TEXTOS)) {
    const html = plantilla
      .replace('BACKGROUND_URL', aUrl('landing-background.webp'))
      .replace('LOGO_URL', aUrl('votain-logo.webp'))
      .replace('WORDMARK_URL', aUrl('votain-wordmark.svg'))
      .replace('TITULAR', escapar(titular))
      .replace('SUBTITULO', escapar(subtitulo))
      .replace('ETIQUETA1', escapar(etiquetas[0]))
      .replace('ETIQUETA2', escapar(etiquetas[1]))
      .replace('ETIQUETA3', escapar(etiquetas[2]))
      .replace('<html>', `<html lang="${idioma}">`);

    const temporal = path.join(__dirname, `og-${idioma}.html`);
    fs.writeFileSync(temporal, html);
    await pagina.goto('file:///' + temporal.replace(/\\/g, '/'), { waitUntil: 'networkidle' });
    // Las fuentes de Google llegan por red: sin esperarlas, la primera tarjeta
    // sale con la tipografia del sistema y las demas no.
    await pagina.evaluate(() => document.fonts.ready);
    await pagina.waitForTimeout(400);

    await pagina.screenshot({
      path: path.join(SALIDA, `og-card-${idioma}.jpg`),
      type: 'jpeg',
      quality: 90,
    });
    fs.unlinkSync(temporal);
    console.log(`  ${idioma} -> og-card-${idioma}.jpg`);
  }

  await navegador.close();
  console.log(`\n${Object.keys(TEXTOS).length} tarjetas en ${SALIDA}`);
})();
