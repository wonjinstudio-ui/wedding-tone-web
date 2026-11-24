/// <reference lib="webworker" />
// 브라우저에서 사진을 긴 변 2400px로 줄이고, 원본 EXIF(촬영 시각·카메라 색온도 메이커노트)를 그대로 붙인다.
// 회전은 픽셀에 적용하고 EXIF 회전 태그는 1로 바꾼다(엔진이 다시 돌리지 않게). DESIGN.md 12절 ③
export type ResizeIn = { id: number; file: File; edge: number; quality: number };
export type ResizeOut = { id: number; blob?: Blob; width?: number; height?: number; hadExif?: boolean; error?: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function findExif(b: Uint8Array): Uint8Array | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 < b.length && b[i] === 0xff) {
    const m = b[i + 1];
    if (m === 0xda || m === 0xd9) break;                       // 그림 데이터 시작 → EXIF 없음
    const len = (b[i + 2] << 8) | b[i + 3];
    if (m === 0xe1 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66) {
      return b.slice(i, i + 2 + len);                          // FFE1 + 길이 + "Exif\0\0" + TIFF
    }
    i += 2 + len;
  }
  return null;
}

function orientationTo1(seg: Uint8Array): Uint8Array {
  const s = seg.slice();
  const t = 10;                                                // 마커2 + 길이2 + "Exif\0\0"6
  const le = s[t] === 0x49;
  const dv = new DataView(s.buffer, s.byteOffset, s.byteLength);
  const u16 = (o: number) => dv.getUint16(o, le);
  const u32 = (o: number) => dv.getUint32(o, le);
  const ifd0 = t + u32(t + 4);
  if (ifd0 + 2 > s.length) return s;
  const n = u16(ifd0);
  for (let k = 0; k < n; k++) {
    const e = ifd0 + 2 + k * 12;
    if (e + 12 > s.length) break;
    if (u16(e) === 0x0112) dv.setUint16(e + 8, 1, le);
  }
  return s;
}

function withExif(jpg: Uint8Array, exif: Uint8Array): Uint8Array {
  let i = 2;
  if (jpg[2] === 0xff && jpg[3] === 0xe0) i = 4 + ((jpg[4] << 8) | jpg[5]);   // 캔버스가 넣은 JFIF(APP0) 빼기
  const out = new Uint8Array(2 + exif.length + (jpg.length - i));
  out.set([0xff, 0xd8], 0);
  out.set(exif, 2);
  out.set(jpg.subarray(i), 2 + exif.length);
  return out;
}

ctx.onmessage = async (e: MessageEvent<ResizeIn>) => {
  const { id, file, edge, quality } = e.data;
  try {
    const head = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());   // EXIF는 앞쪽 64KB 안
    const exif = findExif(head);
    const full = await createImageBitmap(file, { imageOrientation: "from-image" });
    const k = Math.min(1, edge / Math.max(full.width, full.height));
    const w = Math.round(full.width * k), h = Math.round(full.height * k);
    const small = k < 1 ? await createImageBitmap(full, { resizeWidth: w, resizeHeight: h, resizeQuality: "high" }) : full;
    const canvas = new OffscreenCanvas(w, h);
    const g = canvas.getContext("2d")!;
    g.drawImage(small, 0, 0);
    full.close();
    if (small !== full) small.close();
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
    let bytes: Uint8Array = new Uint8Array(await blob.arrayBuffer());
    if (exif) bytes = withExif(bytes, orientationTo1(exif));
    ctx.postMessage({ id, blob: new Blob([bytes as BlobPart], { type: "image/jpeg" }), width: w, height: h, hadExif: !!exif } satisfies ResizeOut);
  } catch (err) {
    ctx.postMessage({ id, error: err instanceof Error ? err.message : String(err) } satisfies ResizeOut);
  }
};
