// Is this IP address one the server must refuse to fetch from?
//
// WHY THIS FILE EXISTS
// The media library can copy an image from a URL the caller supplies, which is
// the definition of server-side request forgery. Admin-only is not enough on its
// own: an admin account is one stolen password away from being someone else, and
// the thing on the other side of these addresses is the host's own network — the
// cPanel admin interface on 127.0.0.1, another customer on the same private
// subnet, and above all 169.254.169.254, the cloud metadata service that hands
// out credentials to anything that asks.
//
// It lives on its own, and away from server.ts, because a security check nobody
// can test is a security check nobody has checked. See
// scripts/test-private-address.mjs.
//
// The caller must resolve the hostname first and test EVERY address it resolves
// to. Testing the hostname text instead is the classic hole: `localtest.me`,
// `127.0.0.1.nip.io` and thousands of others are public names that resolve to
// the loopback address.

const PRIVATE_V4: RegExp[] = [
  /^10\./,                                        // RFC1918
  /^192\.168\./,                                  // RFC1918
  /^172\.(1[6-9]|2\d|3[01])\./,                   // RFC1918, 172.16–172.31
  /^127\./,                                       // loopback
  /^0\./,                                         // "this network"
  /^169\.254\./,                                  // link-local — cloud metadata
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,     // RFC6598 carrier-grade NAT
  /^192\.0\.0\./,                                 // IETF protocol assignments
  /^198\.1[89]\./,                                // benchmarking
  /^22[4-9]\./, /^2[3-4]\d\./, /^25[0-5]\./,      // multicast and reserved
];

/**
 * @param address a numeric address, never a hostname
 * @param family  4 or 6, as node's dns.lookup reports it
 */
export function isPrivateAddress(address: string, family: number): boolean {
  const a = String(address ?? '').trim().toLowerCase();
  if (!a) return true; // nothing to check means nothing to trust

  if (family === 6) {
    if (a === '::1' || a === '::') return true;
    // An IPv4 address written as IPv6. ::ffff:127.0.0.1 reaches the loopback.
    const mapped = a.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (mapped) return isPrivateAddress(mapped[1], 4);
    // The same thing in hex form, ::ffff:7f00:1
    const hexMapped = a.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexMapped) {
      const n = (parseInt(hexMapped[1], 16) << 16) | parseInt(hexMapped[2], 16);
      const dotted = [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
      return isPrivateAddress(dotted, 4);
    }
    if (a.startsWith('fe80')) return true;        // link-local
    if (/^f[cd]/.test(a)) return true;            // unique local, fc00::/7
    return false;
  }

  return PRIVATE_V4.some((re) => re.test(a));
}
