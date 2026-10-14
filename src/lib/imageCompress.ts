// Shrinking an image in the browser before it is stored anywhere.
//
// WHY THIS FILE EXISTS
// This lived as a component-local const inside ProductsAdmin, where nothing else
// could reach it — so the next screen that needed to store an image either wrote
// its own copy or stored the file at full size. The option-image upload needs a
// much harder squeeze than the product gallery does (a thumbnail rendered 64 px
// tall, against a 1 MiB document limit shared by 1500 options), and two
// implementations of "make this smaller" would have drifted the first time
// either was touched.
//
// The behaviour is unchanged for its original caller: the defaults are still
// 800 × 800 at quality 0.75, still a JPEG data URL.

/**
 * Draw `file` into a canvas no larger than maxWidth × maxHeight and return it as
 * a base64 JPEG data URL.
 *
 * Rejects rather than resolving when the browser cannot give us a 2D context.
 * The version this replaced resolved the ORIGINAL, uncompressed data URL in that
 * case — silently handing back megabytes to a caller that had asked for
 * kilobytes, which is precisely how a document blows its size limit.
 */
export function compressImageFile(
  file: File,
  maxWidth = 800,
  maxHeight = 800,
  quality = 0.75,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = (err) => reject(err);
    reader.onload = (event) => {
      const img = new Image();
      img.onerror = (err) => reject(err);
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        if (height > maxHeight) {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('This browser could not resize the image.'));
          return;
        }

        // A fresh canvas is TRANSPARENT, and JPEG has no alpha channel: every
        // transparent pixel encodes as BLACK. Product cut-outs and supplier
        // artwork are overwhelmingly transparent PNGs, so a picture that looked
        // right in the file picker was stored on a black rectangle — "the
        // product looks like something is wrong with it", and no amount of
        // fixing the layout would have touched it. Paint the paper first.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
}
