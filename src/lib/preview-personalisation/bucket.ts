/**
 * Where anonymous preview uploads live.
 *
 * In its own module because the actions file is `'use server'`, which may only
 * export async functions — a constant exported from there fails the build.
 *
 * The bucket is PRIVATE. Host storefronts use the cookie-checked asset route;
 * path previews receive expiring signed URLs after server-side validation.
 */
export const PREVIEW_BUCKET = 'preview-uploads';
