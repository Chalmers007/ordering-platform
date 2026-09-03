/**
 * Where anonymous preview uploads live.
 *
 * In its own module because the actions file is `'use server'`, which may only
 * export async functions — a constant exported from there fails the build.
 *
 * The bucket is PRIVATE. Files are read only through the asset route, which
 * checks the session cookie first.
 */
export const PREVIEW_BUCKET = 'preview-uploads';
