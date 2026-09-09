/**
 * `PUBLIC_URL` ni normallashtirish.
 *
 * Railway va Render domenni **sxemasiz** beradi — masalan
 * `${{RAILWAY_PUBLIC_DOMAIN}}` → `app-production.up.railway.app`. Telegram esa
 * webhook uchun ham, Mini App tugmasi uchun ham to'liq `https://...` manzilni
 * talab qiladi va sxemasiz qiymatga `bad webhook: Invalid URL` deb javob beradi.
 *
 * Shuning uchun sxema yo'q bo'lsa `https://` ni o'zimiz qo'shamiz.
 */

export type PublicUrlResult =
  | { ok: true; url: string; warning?: string }
  | { ok: false; error: string };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]);

export function normalizePublicUrl(raw: string | null | undefined): PublicUrlResult | null {
  if (raw === null || raw === undefined) return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Oxirdagi `/` ni bu yerda kesmaymiz: `http://` kabi qiymat `http:` ga
  // aylanib, sxema aniqlanmay qolardi. Yo'l qismi pastda, parse qilingandan
  // keyin tozalanadi.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { ok: false, error: `PUBLIC_URL manzil sifatida o'qilmadi: "${raw}"` };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, error: `PUBLIC_URL faqat http yoki https bo'lishi mumkin: "${raw}"` };
  }

  if (!parsed.hostname) {
    return { ok: false, error: `PUBLIC_URL da domen yo'q: "${raw}"` };
  }

  // Yo'l qismi saqlanadi (reverse proxy ostida `/bot` kabi prefiks bo'lishi mumkin),
  // lekin oxiridagi `/` olib tashlanadi — keyin manzillar ikkilanmasin.
  const path = parsed.pathname.replace(/\/+$/, "");
  const url = `${parsed.origin}${path}`;

  const isLocal = LOCAL_HOSTS.has(parsed.hostname);
  if (parsed.protocol !== "https:" && !isLocal) {
    return {
      ok: true,
      url,
      warning:
        `PUBLIC_URL HTTPS emas (${url}). Telegram webhook va Mini App ` +
        `faqat HTTPS manzil bilan ishlaydi.`,
    };
  }

  return { ok: true, url };
}
