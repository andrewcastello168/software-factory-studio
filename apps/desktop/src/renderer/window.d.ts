import type { StudioBridge } from '@factory/contracts';

declare global {
  interface Window {
    studio?: StudioBridge;
  }
}
