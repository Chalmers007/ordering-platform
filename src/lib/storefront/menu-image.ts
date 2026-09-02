/** Storage path -> public URL. Client-safe: it only builds a string from the
 *  public Supabase URL, and the bucket is public by design. */
export function menuImageUrl(imagePath: string | null): string | null {
  if (!imagePath) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base}/storage/v1/object/public/menu-images/${imagePath}`;
}
