"""화면 확인용 가짜 사진 만들기 (2026-11-23).

고객 사진의 '픽셀'은 쓰지 않는다. 색·도형으로 그린 가짜 장면에, 실제 결혼식 원본의 촬영 정보(EXIF: 촬영 시각·카메라·
화이트밸런스 메이커노트)만 옮겨 붙인다 → 엔진이 조명 구역을 진짜처럼 나눌 수 있고, 화면 스크린숏에는 고객 얼굴이 나오지 않는다.

  python make_fake_photos.py <결혼식 wsnap.db> <출력 폴더> [장수=80]
원본과 같은 크기(5760×3840 등)로 만들어 브라우저 업로드(2400px 축소·EXIF 유지)까지 시험할 수 있게 한다.
"""
import math
import sqlite3
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


def scene(w, h, cct, seed):
    rng = np.random.default_rng(seed)
    # 색온도에 맞춘 빛 색(낮으면 주황, 높으면 푸름)
    t = np.clip((cct - 3000) / 3500, 0, 1)
    light = np.array([1.0, 0.82 + 0.12 * t, 0.62 + 0.36 * t])
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    g = 0.25 + 0.55 * (1 - yy / h) * (0.7 + 0.3 * np.sin(xx / w * math.pi * rng.uniform(0.5, 2)))
    img = g[..., None] * light[None, None, :] * rng.uniform(0.6, 1.1)
    im = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    for _ in range(rng.integers(4, 9)):                      # 소품·창문 같은 도형
        x0, y0 = rng.uniform(0, w * .9), rng.uniform(0, h * .9)
        x1, y1 = x0 + rng.uniform(.05, .3) * w, y0 + rng.uniform(.05, .4) * h
        c = (np.array(rng.uniform(.2, 1, 3)) * light * 255).astype(int)
        (d.ellipse if rng.random() < .5 else d.rectangle)([x0, y0, x1, y1], fill=tuple(c))
    # 사람 실루엣 두 개(흰 드레스·검은 정장 느낌) — 얼굴 없음
    for k, col in enumerate([(245, 243, 238), (35, 35, 40)]):
        cx = w * (0.42 + 0.16 * k + rng.uniform(-.05, .05)); top = h * rng.uniform(.25, .4)
        c = tuple(int(v) for v in (np.array(col) * light))
        d.ellipse([cx - w * .035, top, cx + w * .035, top + h * .1], fill=tuple(int(v * .9) for v in c))
        d.polygon([(cx - w * .03, top + h * .1), (cx + w * .03, top + h * .1), (cx + w * .09, h), (cx - w * .09, h)], fill=c)
    return im.filter(ImageFilter.GaussianBlur(w / 1500))


def main():
    db, out = sys.argv[1], Path(sys.argv[2])
    n = int(sys.argv[3]) if len(sys.argv) > 3 else 80
    out.mkdir(parents=True, exist_ok=True)
    rows = sqlite3.connect(db).execute("""SELECT p.jpg_path, l.cct FROM photos p JOIN light l ON l.photo_id=p.id
                                          WHERE p.jpg_path IS NOT NULL AND l.cct IS NOT NULL ORDER BY p.capture_time""").fetchall()
    pick = [rows[i] for i in np.linspace(0, len(rows) - 1, min(n, len(rows))).astype(int)]
    args = []
    for i, (src, cct) in enumerate(pick):
        w, h = Image.open(src).size                       # 크기만 읽음(픽셀은 안 씀)
        dst = out / f"FAKE_{i + 1:04d}.JPG"
        scene(w, h, cct, i).save(dst, quality=92)
        args += ["-tagsFromFile", src, "-all:all", "-unsafe", "-ThumbnailImage=", "-PreviewImage=", "-overwrite_original", str(dst), "-execute"]
    subprocess.run(["exiftool", "-q", "-q", *args[:-1]], check=False)
    print(f"{len(pick)}장 → {out}")


if __name__ == "__main__":
    main()
