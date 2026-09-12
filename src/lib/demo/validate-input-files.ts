const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const MAX_MENU_BYTES = 10 * 1024 * 1024;

export function validateMenuFile(file: File): { ok: true } | { ok: false; message: string } {
  const type = file.type.toLowerCase();
  const allowed = type === 'application/pdf' || type.startsWith('image/') || type.startsWith('text/') ||
    type === 'application/json' || /\.(pdf|json|csv|txt|jpe?g|png|gif|webp)$/i.test(file.name);
  if (!allowed) return { ok: false, message: 'Menu must be a PDF, image, JSON, CSV, or text file.' };
  if (file.size > MAX_MENU_BYTES) return { ok: false, message: 'Menu file must be 10MB or smaller.' };
  return { ok: true };
}

export function validateOptionalFiles(formData: FormData): { ok: true } | { ok: false; message: string } {
  const logo = formData.get('logo');
  if (logo instanceof File) {
    if (!logo.type.startsWith('image/')) return { ok: false, message: 'Logo must be an image file.' };
    if (logo.size > MAX_LOGO_BYTES) return { ok: false, message: 'Logo file must be 5MB or smaller.' };
  }

  const menu = formData.get('menu');
  if (menu instanceof File) {
    const result = validateMenuFile(menu);
    if (!result.ok) return result;
  }

  return { ok: true };
}
