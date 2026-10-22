// Minimal typings for the parts of noVNC's RFB client BrowserLab uses (the package ships none).
declare module '@novnc/novnc' {
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, url: string, options?: { shared?: boolean; credentials?: Record<string, string> });
    scaleViewport: boolean;
    resizeSession: boolean;
    focusOnClick: boolean;
    viewOnly: boolean;
    disconnect(): void;
    focus(): void;
    clipboardPasteFrom(text: string): void;
    toBlob(callback: (blob: Blob | null) => void, type?: string, quality?: number): void;
    addEventListener(type: string, listener: (e: any) => void): void;
  }
}
