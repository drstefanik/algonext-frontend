const LEGACY_FRAME_HOST = "http://46.224.249.136:9000";
const PUBLIC_FRAME_HOST = "https://s3.nextgroupintl.com";

export function normalizeFrameUrl(url: string): string {
  if (url.startsWith(LEGACY_FRAME_HOST)) {
    return url.replace(LEGACY_FRAME_HOST, PUBLIC_FRAME_HOST);
  }
  return url;
}
