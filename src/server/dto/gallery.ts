// Gallery DTOs (milestone M16; docs/adr/0019-galleries.md): the photos of a person's gallery and
// of a school (its logo and its room photos), as the app's own addresses, never a storage key, an
// uploader, a file name or anything of the original file. The public ones pass through these
// schemas (which drop every other field) before they leave a service or enter 'use cache'.

import * as z from 'zod';

/**
 * One photo of a gallery: the 96 px and 512 px squares (the grid), the whole photo (`full`, the
 * viewer; the 512 px square for a photo stored before M16) with its size, and the owner's caption.
 */
export const galleryPhotoSchema = z.object({
  id: z.uuid(),
  small: z.string(),
  large: z.string(),
  full: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  caption: z.string().nullable(),
});
export type GalleryPhotoDto = z.infer<typeof galleryPhotoSchema>;

/** A photo of a person's gallery: also whether it is the profile photo. */
export const personGalleryPhotoSchema = galleryPhotoSchema.extend({ isProfile: z.boolean() });
export type PersonGalleryPhotoDto = z.infer<typeof personGalleryPhotoSchema>;

/** A school's logo: the 96 px and 512 px squares (the whole logo on a transparent ground). */
export const schoolLogoSchema = z.object({ id: z.uuid(), small: z.string(), large: z.string() });
export type SchoolLogoDto = z.infer<typeof schoolLogoSchema>;

/** The public part of a person's gallery (what every viewer of a public person sees). */
export const publicGallerySchema = z.object({
  personId: z.uuid(),
  slug: z.string(),
  /** The Latin display name: the alt text of a photo without a caption. */
  displayName: z.string(),
  photos: z.array(personGalleryPhotoSchema),
});
export type PublicGalleryDto = z.infer<typeof publicGallerySchema>;

export function toPublicGallery(value: PublicGalleryDto): PublicGalleryDto {
  return publicGallerySchema.parse(value);
}
