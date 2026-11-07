// YUV 4:2:0 -> packed BGR and the quarter-turn rotation, shared by the JNI converters.
// Header-only so the host tests compile the exact code the app runs.
#pragma once
#include <cstddef>
#include <cstdint>
#include <vector>

namespace ffyuv {

struct Plane {
  const uint8_t* p;
  size_t len;     // readable bytes from p
  int row;        // row stride
  int pix;        // pixel stride (Y: 1)
};

inline uint8_t clamp8(int v) { return (uint8_t)(v < 0 ? 0 : (v > 255 ? 255 : v)); }

// BT.601 limited range, the same integer arithmetic the app has always used. 10-bit
// P010 frames (chroma pixel stride >= 4) are read by the HIGH byte of each sample.
inline void toBgr(const Plane& Y, const Plane& U, const Plane& V, int w, int h, uint8_t* bgr) {
  const bool p010 = U.pix >= 4 && V.pix >= 4;
  const size_t yStep = p010 ? 2 : 1, hi = p010 ? 1 : 0;
  for (int y = 0; y < h; ++y) {
    for (int x = 0; x < w; ++x) {
      size_t yi = (size_t)y * Y.row + (size_t)x * yStep + hi;
      size_t ci = (size_t)(y / 2) * U.row + (size_t)(x / 2) * U.pix + hi;
      size_t vi = (size_t)(y / 2) * V.row + (size_t)(x / 2) * V.pix + hi;
      int Yv = (yi < Y.len ? Y.p[yi] : 16) - 16;
      int Uv = (ci < U.len ? U.p[ci] : 128) - 128;
      int Vv = (vi < V.len ? V.p[vi] : 128) - 128;
      int c = 298 * Yv;
      uint8_t* p = &bgr[((size_t)y * w + x) * 3];
      p[0] = clamp8((c + 516 * Uv + 128) >> 8);              // B
      p[1] = clamp8((c - 100 * Uv - 208 * Vv + 128) >> 8);   // G
      p[2] = clamp8((c + 409 * Vv + 128) >> 8);              // R
    }
  }
}

// Rotate clockwise by 0/90/180/270 into dst (resized), reporting the new size.
inline void rotate(const uint8_t* src, int w, int h, int degrees, std::vector<uint8_t>& dst,
                   int& dw, int& dh) {
  const int deg = ((degrees % 360) + 360) % 360;
  const size_t n = (size_t)w * h * 3;
  dst.resize(n);
  if (deg == 0) {
    for (size_t i = 0; i < n; ++i) dst[i] = src[i];
    dw = w; dh = h;
    return;
  }
  dw = (deg == 180) ? w : h;
  dh = (deg == 180) ? h : w;
  for (int y = 0; y < h; ++y) {
    for (int x = 0; x < w; ++x) {
      int dx, dy;
      switch (deg) {
        case 90:  dx = dw - 1 - y; dy = x;             break;   // clockwise
        case 180: dx = w - 1 - x;  dy = h - 1 - y;     break;
        default:  dx = y;          dy = dh - 1 - x;    break;   // 270
      }
      const uint8_t* sp = &src[((size_t)y * w + x) * 3];
      uint8_t* dp = &dst[((size_t)dy * dw + dx) * 3];
      dp[0] = sp[0]; dp[1] = sp[1]; dp[2] = sp[2];
    }
  }
}

}  // namespace ffyuv
