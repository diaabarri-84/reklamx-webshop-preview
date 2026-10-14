/**
 * Download the customer's artwork.
 *
 * Handles data:, blob:, http(s): and app-relative URLs. Returns true when a file
 * was actually downloaded and false when there is nothing to download — it never
 * invents a substitute.
 */
export async function triggerFileDownload(fileUrl?: string | null, fileName: string = 'print_file.pdf', fileSpecs?: any) {
  const cleanFileName = fileName || 'uploaded_print_file.pdf';

  // 1. If valid Data URL, Blob URL, HTTP/HTTPS URL, or relative URL exists
  if (fileUrl && typeof fileUrl === 'string' && fileUrl.trim().length > 0) {
    try {
      // Data URLs or Blob URLs: fetch to Blob and create object URL to bypass browser top-level data URL navigation blocks
      if (fileUrl.startsWith('data:') || fileUrl.startsWith('blob:')) {
        const res = await fetch(fileUrl);
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = cleanFileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
        return true;
      }

      // HTTP / HTTPS / Relative URLs: fetch as Blob to enforce cross-origin download attribute
      if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://') || fileUrl.startsWith('/')) {
        try {
          const res = await fetch(fileUrl);
          if (res.ok) {
            const blob = await res.blob();
            const objectUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = objectUrl;
            a.download = cleanFileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
            return true;
          }
        } catch (corsErr) {
          console.warn('CORS or fetch error downloading file, falling back to direct anchor click:', corsErr);
          const a = document.createElement('a');
          a.href = fileUrl;
          a.download = cleanFileName;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          return true;
        }
      }
    } catch (err) {
      console.warn('Direct file URL download error, falling back to spec Blob download:', err);
    }
  }

  // 2. There is no artwork.
  //
  // This used to GENERATE a file: a text blob saved under the customer's real
  // filename, with the real MIME type, containing a random "Verification Hash"
  // and the line "Checksum Status: VERIFIED & READIED FOR PRINT PRODUCTION".
  // Someone in production downloading that would believe they had the customer's
  // approved artwork. Refusing is the only safe answer.
  console.warn(`No artwork stored for "${cleanFileName}" — nothing to download.`);
  return false;
}
