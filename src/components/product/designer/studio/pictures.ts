/**
 * Pictures from the customer's device into the studio: checked, cut down to what
 * any print file can use (studioObjects.ts preparePicture), registered with the
 * engine under a new id. Shared by the Uploads panel and a drop onto the board.
 */
import type { TranslationKey } from '../../../../lib/translations';
import { MAX_PICTURE_BYTES, OWNER_PICTURE_LIMITS, newImageId, preparePicture } from './studioObjects';
import type { StudioEngine } from './engine';

export const PICTURE_TYPES = /^image\/(jpeg|png|webp)$/i;
export const PICTURE_ACCEPT = 'image/jpeg,image/png,image/webp';

export async function takePictures(
  files: Iterable<File>,
  engine: StudioEngine,
  { owner = false }: { owner?: boolean } = {},
): Promise<{ ids: string[]; problems: TranslationKey[] }> {
  const ids: string[] = [];
  const problems = new Set<TranslationKey>();
  for (const file of files) {
    if (!PICTURE_TYPES.test(file.type)) {
      problems.add('dsgPictureType');
      continue;
    }
    if (file.size > MAX_PICTURE_BYTES) {
      problems.add('dsgPictureTooBig');
      continue;
    }
    try {
      const picture = await preparePicture(file, owner ? OWNER_PICTURE_LIMITS : undefined);
      const id = newImageId();
      engine.registerPicture(id, picture, true);
      ids.push(id);
    } catch {
      // HEIC on Android, a broken file: the browser cannot open it.
      problems.add('dsgPictureUnreadable');
    }
  }
  return { ids, problems: [...problems] };
}
