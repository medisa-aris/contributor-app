/**
 * Memuat api.js dari Document Server OnlyOffice milik sendiri (bukan CDN publik).
 * Skrip ini wajib berasal dari server yang sama dengan editor, jadi tidak dibundel lewat npm.
 */

export interface DocEditorInstance {
  destroyEditor(): void;
}

export interface DocsApiGlobal {
  DocEditor: new (elementId: string, config: Record<string, unknown>) => DocEditorInstance;
}

declare global {
  interface Window {
    DocsAPI?: DocsApiGlobal;
  }
}

const pending = new Map<string, Promise<DocsApiGlobal>>();

export function loadDocsApi(documentServerUrl: string): Promise<DocsApiGlobal> {
  const src = `${documentServerUrl.replace(/\/+$/, '')}/web-apps/apps/api/documents/api.js`;
  const cached = pending.get(src);
  if (cached) return cached;
  const promise = new Promise<DocsApiGlobal>((resolve, reject) => {
    if (window.DocsAPI) {
      resolve(window.DocsAPI);
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () =>
      window.DocsAPI ? resolve(window.DocsAPI) : reject(new Error('DocsAPI tidak tersedia'));
    script.onerror = () => {
      pending.delete(src);
      script.remove();
      reject(new Error('Document Server tidak dapat dijangkau'));
    };
    document.head.appendChild(script);
  });
  pending.set(src, promise);
  return promise;
}
