// Stand-in for 'firebase/app' when the shop runs on its own database
// (DATA_BACKEND=mysql; swapped in by vite.config.ts). There is no Google app to
// start — only the handle the other stand-ins are passed.

export interface FirebaseApp { name: string; options: Record<string, unknown> }
const DEFAULT: FirebaseApp = { name: '[DEFAULT]', options: {} };

export function initializeApp(options: Record<string, unknown> = {}, _name?: string): FirebaseApp {
  DEFAULT.options = options;
  return DEFAULT;
}
export const getApp = (): FirebaseApp => DEFAULT;
export const getApps = (): FirebaseApp[] => [DEFAULT];
