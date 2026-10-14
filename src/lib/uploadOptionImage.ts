// The little illustration on an option card, put there by the shop owner.
//
// WHY THIS FILE EXISTS
// Both option editors offered one way to give an option a picture: paste a URL.
// An owner with a photo of the paper stock on their desk had nowhere to put it.
//
// The hard part is not the button, it is WHERE the bytes go. The global option
// library is ONE Firestore document holding every field and every option — about
// 440 KB at the shipped catalogue, against Firestore's 1 MiB per-document limit,
// and it is copied verbatim into each product document that uses those fields.
// A base64 thumbnail is 60–120 KB, so five or six of them would exhaust the
// document and Firestore would then reject the WHOLE save — losing every edit
// the owner had made in that modal, with an error that does not say why.
//
// So: the image goes to Firebase Storage and the document stores a ~250-byte
// URL. The inline fallback exists only for the case where Storage is
// unreachable, and it is capped hard enough that it cannot cause the failure
// above.

import { auth } from '../firebase';
import { uploadFile } from './uploadFile';
import { compressImageFile } from './imageCompress';

/** Option cards render the image 64 px tall, so this is already generous. */
const FALLBACK_MAX_PX = 320;
const FALLBACK_QUALITY = 0.6;

/**
 * The most base64 we will ever put in the option library, per image.
 *
 * Twenty of these still leaves the document comfortably inside its limit, which
 * is the point: the fallback must never be the thing that breaks the save.
 */
const FALLBACK_MAX_CHARS = 30_000;

export interface OptionImageResult {
  /** What to store in `option.imageUrl`. */
  url: string;
  /** True when Storage was unavailable and the bytes are inline. */
  inline: boolean;
}

/**
 * Put one image where an option card can show it, and return what to store.
 *
 * Deliberately does NOT sign in anonymously when there is no session, which is
 * what the shopper-facing uploader does. An anonymous sign-in fires
 * onAuthStateChanged, which rewrites the app's user profile as a plain customer
 * — and the admin dashboard is behind an admin-only route, so the owner would be
 * thrown out of the screen halfway through editing.
 */
export async function uploadOptionImage(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<OptionImageResult> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Choose an image file (PNG, JPG, WebP or SVG).');
  }

  const uid = auth.currentUser?.uid;
  if (uid) {
    try {
      const up = await uploadFile(file, { userId: uid, folder: 'option-images', onProgress });
      return { url: up.url, inline: false };
    } catch (err) {
      console.warn('Storage upload unavailable for the option image — embedding instead:', err);
    }
  }

  // Storage was unreachable, or this is a session with no Firebase user (the
  // dev-only demo admin). Embed, but only something genuinely small.
  const dataUrl = await compressImageFile(file, FALLBACK_MAX_PX, FALLBACK_MAX_PX, FALLBACK_QUALITY);
  if (dataUrl.length > FALLBACK_MAX_CHARS) {
    throw new Error(
      'This image is too large to store without cloud storage. Use a smaller one, or paste a link to it instead.',
    );
  }
  return { url: dataUrl, inline: true };
}
