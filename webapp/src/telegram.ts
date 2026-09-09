/**
 * Telegram Mini Apps SDK ustidan yupqa qatlam.
 * SDK brauzerda (Telegramdan tashqarida) mavjud bo'lmaydi — hamma chaqiruvlar
 * shu holatga chidamli qilingan.
 */

interface ThemeParams {
  bg_color?: string;
  text_color?: string;
  hint_color?: string;
  link_color?: string;
  button_color?: string;
  button_text_color?: string;
  secondary_bg_color?: string;
  header_bg_color?: string;
  accent_text_color?: string;
  section_bg_color?: string;
  section_header_text_color?: string;
  subtitle_text_color?: string;
  destructive_text_color?: string;
}

interface MainButton {
  text: string;
  isVisible: boolean;
  setText(text: string): MainButton;
  show(): MainButton;
  hide(): MainButton;
  enable(): MainButton;
  disable(): MainButton;
  showProgress(leaveActive?: boolean): MainButton;
  hideProgress(): MainButton;
  onClick(handler: () => void): MainButton;
  offClick(handler: () => void): MainButton;
}

interface BackButton {
  isVisible: boolean;
  show(): BackButton;
  hide(): BackButton;
  onClick(handler: () => void): BackButton;
  offClick(handler: () => void): BackButton;
}

interface HapticFeedback {
  impactOccurred(style: "light" | "medium" | "heavy" | "rigid" | "soft"): HapticFeedback;
  notificationOccurred(type: "error" | "success" | "warning"): HapticFeedback;
  selectionChanged(): HapticFeedback;
}

interface WebApp {
  initData: string;
  colorScheme: "light" | "dark";
  themeParams: ThemeParams;
  isExpanded: boolean;
  viewportStableHeight: number;
  MainButton: MainButton;
  BackButton: BackButton;
  HapticFeedback: HapticFeedback;
  ready(): void;
  expand(): void;
  close(): void;
  enableClosingConfirmation(): void;
  disableVerticalSwipes?(): void;
  onEvent(event: string, handler: () => void): void;
  offEvent(event: string, handler: () => void): void;
  showConfirm?(message: string, callback: (confirmed: boolean) => void): void;
  showAlert?(message: string, callback?: () => void): void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: WebApp };
  }
}

export const webApp: WebApp | undefined =
  typeof window === "undefined" ? undefined : window.Telegram?.WebApp;

/** Telegram ichida ochilganini bildiradi (initData mavjud). */
export const isInsideTelegram = Boolean(webApp?.initData);

const CSS_VAR_MAP: ReadonlyArray<[keyof ThemeParams, string]> = [
  ["bg_color", "--tg-bg"],
  ["text_color", "--tg-text"],
  ["hint_color", "--tg-hint"],
  ["link_color", "--tg-link"],
  ["button_color", "--tg-button"],
  ["button_text_color", "--tg-button-text"],
  ["secondary_bg_color", "--tg-secondary-bg"],
  ["header_bg_color", "--tg-header-bg"],
  ["accent_text_color", "--tg-accent"],
  ["section_bg_color", "--tg-section-bg"],
  ["section_header_text_color", "--tg-section-header"],
  ["subtitle_text_color", "--tg-subtitle"],
  ["destructive_text_color", "--tg-destructive"],
];

/** Telegram tema ranglarini CSS o'zgaruvchilarga yozadi. */
function applyTheme(): void {
  if (!webApp) return;
  const root = document.documentElement;

  for (const [key, cssVar] of CSS_VAR_MAP) {
    const value = webApp.themeParams[key];
    if (value) root.style.setProperty(cssVar, value);
  }

  root.dataset.theme = webApp.colorScheme;
}

/** Ilova ishga tushganda bir marta chaqiriladi. */
export function initTelegram(): void {
  if (!webApp) {
    document.documentElement.dataset.theme = window.matchMedia?.("(prefers-color-scheme: dark)")
      .matches
      ? "dark"
      : "light";
    return;
  }

  webApp.ready();
  webApp.expand();
  webApp.disableVerticalSwipes?.();
  applyTheme();
  webApp.onEvent("themeChanged", applyTheme);
}

export function haptic(kind: "tap" | "success" | "error" | "select"): void {
  const h = webApp?.HapticFeedback;
  if (!h) return;

  switch (kind) {
    case "tap":
      h.impactOccurred("light");
      break;
    case "success":
      h.notificationOccurred("success");
      break;
    case "error":
      h.notificationOccurred("error");
      break;
    case "select":
      h.selectionChanged();
      break;
  }
}

/** Telegramning tasdiq dialogi; mavjud bo'lmasa brauzerning `confirm`i. */
export function confirmAction(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (webApp?.showConfirm) {
      webApp.showConfirm(message, resolve);
      return;
    }
    resolve(window.confirm(message));
  });
}

export function showAlert(message: string): void {
  if (webApp?.showAlert) {
    webApp.showAlert(message);
    return;
  }
  window.alert(message);
}

/**
 * Orqaga tugmasini boshqarish — tahrirlash oynasi ochiq bo'lganda ko'rinadi.
 * Avvalgi ishlov beruvchi har safar uzib qo'yiladi, aks holda Telegram ularni
 * to'plab boradi va bitta bosishda bir nechtasi ishga tushadi.
 */
let currentBackHandler: (() => void) | null = null;

export function setBackButton(handler: (() => void) | null): void {
  const button = webApp?.BackButton;
  if (!button) return;

  if (currentBackHandler) {
    button.offClick(currentBackHandler);
    currentBackHandler = null;
  }

  if (handler) {
    currentBackHandler = handler;
    button.onClick(handler);
    button.show();
  } else {
    button.hide();
  }
}
