import i18next from 'i18next';
import FsBackend from 'i18next-fs-backend';
import LanguageDetector from 'i18next-electron-language-detector';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize i18next and export the ready promise
const i18nReady = i18next
  .use(FsBackend)
  .use(LanguageDetector)
  .init({
    lng: 'es', // Force Spanish as default language
    fallbackLng: 'en',
    supportedLngs: ['en', 'es'],
    ns: 'translation',
    defaultNS: 'translation',
    backend: {
      // Path is now relative to the /core directory
      loadPath: path.join(__dirname, '..', 'locales', '{{lng}}', '{{ns}}.json'),
    },
    detection: {
      // Order and from where user language should be detected
      order: ['store', 'electron', 'os', 'htmlTag'],
      // Cache the language in the app's user data path
      caches: ['store'],
    },
  });

// Ensure i18next is ready before proceeding
i18nReady.then(() => {
  console.log(`[i18n] Initialized with language: ${i18next.language}`);
  console.log(`[i18n] Available languages: ${i18next.languages.join(', ')}`);
}).catch((error) => {
  console.error('[i18n] Failed to initialize:', error);
});

// Attach the ready promise to i18next for compatibility
i18next.ready = i18nReady;

export default i18next;