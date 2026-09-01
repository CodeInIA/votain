import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Browser APIs jsdom does not implement, stubbed so components can mount.
vi.stubGlobal('ResizeObserver', class {
  observe() {}
  unobserve() {}
  disconnect() {}
});

vi.stubGlobal('IntersectionObserver', class {
  readonly root: Element | Document | null = null;
  readonly rootMargin: string = '';
  readonly thresholds: ReadonlyArray<number> = [];
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
});

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// One translation mock for every test: `t` returns the key, so assertions read
// as keys and a wording change never breaks a test.
vi.mock('react-i18next', () => ({
  // The real plugin, minimally: without it, importing src/i18n/config throws,
  // so no test could touch a module that reads translations outside a component.
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { 
      changeLanguage: () => new Promise(() => {}),
      language: 'en'
    },
  }),
}));