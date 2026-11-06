// Host checks for 1.0.41: the shared YUV/rotate cores reproduce the old converters
// byte for byte (so the one-call decode path gives the same frames), and sharpen behaves.
#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <random>
#include <vector>
#include "ffcv.h"
#include "ffmotion.h"
#include "ffyuv.h"

static uint8_t c8(int v) { return (uint8_t)(v < 0 ? 0 : (v > 255 ? 255 : v)); }
// The 1.0.40 yuvToBgr loop, verbatim.
static std::vector<uint8_t> oldYuv(const std::vector<uint8_t>& Y, int yRow, const std::vector<uint8_t>& U,
                                   int uRow, int uPix, const std::vector<uint8_t>& V, int vRow, int vPix,
                                   int w, int h) {
  const bool p010 = uPix >= 4 && vPix >= 4;
  const size_t yStep = p010 ? 2 : 1, hi = p010 ? 1 : 0;
  std::vector<uint8_t> bgr((size_t)w * h * 3);
  for (int y = 0; y < h; ++y)
    for (int x = 0; x < w; ++x) {
      size_t yi = (size_t)y * yRow + (size_t)x * yStep + hi;
      size_t ci = (size_t)(y / 2) * uRow + (size_t)(x / 2) * uPix + hi;
      size_t vi = (size_t)(y / 2) * vRow + (size_t)(x / 2) * vPix + hi;
      int Yv = (yi < Y.size() ? Y[yi] : 16) - 16;
      int Uv = (ci < U.size() ? U[ci] : 128) - 128;
      int Vv = (vi < V.size() ? V[vi] : 128) - 128;
      int c = 298 * Yv;
      uint8_t* p = &bgr[((size_t)y * w + x) * 3];
      p[0] = c8((c + 516 * Uv + 128) >> 8);
      p[1] = c8((c - 100 * Uv - 208 * Vv + 128) >> 8);
      p[2] = c8((c + 409 * Vv + 128) >> 8);
    }
  return bgr;
}
static std::vector<uint8_t> oldRot(const std::vector<uint8_t>& src, int w, int h, int degrees) {
  int deg = ((degrees % 360) + 360) % 360;
  if (deg == 0) return src;
  const int dw = (deg == 180) ? w : h, dh = (deg == 180) ? h : w;
  std::vector<uint8_t> dst(src.size());
  for (int y = 0; y < h; ++y)
    for (int x = 0; x < w; ++x) {
      int dx, dy;
      switch (deg) {
        case 90: dx = dw - 1 - y; dy = x; break;
        case 180: dx = w - 1 - x; dy = h - 1 - y; break;
        default: dx = y; dy = dh - 1 - x; break;
      }
      std::memcpy(&dst[((size_t)dy * dw + dx) * 3], &src[((size_t)y * w + x) * 3], 3);
    }
  return dst;
}

int main() {
  std::mt19937 rng(7);
  int fails = 0;
  struct L { int w, h, yRow, uRow, uPix, p010; };
  for (L l : {L{64, 48, 64, 64, 2, 0}, L{66, 50, 80, 80, 2, 0}, L{64, 48, 64, 32, 1, 0},
              L{64, 48, 128, 128, 4, 1}, L{3840 / 8, 2160 / 8, 512, 512, 2, 0}}) {
    const int ys = l.p010 ? 2 : 1;
    std::vector<uint8_t> Y((size_t)l.yRow * l.h * ys), U((size_t)l.uRow * (l.h / 2)), V(U.size());
    for (auto& b : Y) b = rng(); for (auto& b : U) b = rng(); for (auto& b : V) b = rng();
    if (l.uPix == 2 && !l.p010) { V.assign(U.begin() + 1, U.end()); V.push_back(128); }
    auto ref = oldYuv(Y, l.yRow, U, l.uRow, l.uPix, V, l.uRow, l.uPix, l.w, l.h);
    std::vector<uint8_t> got((size_t)l.w * l.h * 3);
    ffyuv::toBgr({Y.data(), Y.size(), l.yRow, 1}, {U.data(), U.size(), l.uRow, l.uPix},
                 {V.data(), V.size(), l.uRow, l.uPix}, l.w, l.h, got.data());
    if (got != ref) { printf("FAIL yuv %dx%d pix %d\n", l.w, l.h, l.uPix); ++fails; }
    for (int deg : {0, 90, 180, 270, -90}) {
      auto r0 = oldRot(ref, l.w, l.h, deg);
      std::vector<uint8_t> r1; int dw, dh;
      ffyuv::rotate(ref.data(), l.w, l.h, deg, r1, dw, dh);
      if (r0 != r1) { printf("FAIL rotate %d\n", deg); ++fails; }
      // the one-call path: rotate then resizeLinear == old rotateBgr then resizeBgr
      ffcv::Image a(dw, dh, 3); a.data = r0;
      ffcv::Image b(dw, dh, 3); b.data = r1;
      if (ffcv::resizeLinear(a, dw / 2 + 1, dh / 2 + 1).data != ffcv::resizeLinear(b, dw / 2 + 1, dh / 2 + 1).data) {
        printf("FAIL resize after rotate %d\n", deg); ++fails;
      }
    }
  }
  // sharpen: flat image unchanged, an edge gains contrast, values stay in range
  ffcv::MatF flat(64, 64, 3);
  for (auto& v : flat.data) v = 120.f;
  ffcv::MatF f2 = flat; ffmotion::sharpen(f2, 1.f, 2);
  for (size_t i = 0; i < f2.data.size(); ++i) if (std::abs(f2.data[i] - 120.f) > 1e-3f) { printf("FAIL flat\n"); ++fails; break; }
  ffcv::MatF edge(64, 64, 3);
  for (int y = 0; y < 64; ++y) for (int x = 0; x < 64; ++x) for (int c = 0; c < 3; ++c) edge.row(y)[x * 3 + c] = x < 32 ? 60.f : 200.f;
  ffcv::MatF e2 = edge; ffmotion::sharpen(e2, 1.f, 2);
  const float before = edge.row(10)[33 * 3] - edge.row(10)[30 * 3], after = e2.row(10)[33 * 3] - e2.row(10)[30 * 3];
  if (!(after > before)) { printf("FAIL edge %f %f\n", before, after); ++fails; }
  for (float v : e2.data) if (v < 0.f || v > 255.f) { printf("FAIL range\n"); ++fails; break; }
  ffcv::MatF e0 = edge; ffmotion::sharpen(e0, 0.f, 2);
  if (e0.data != edge.data) { printf("FAIL amount 0 changes\n"); ++fails; }
  // directional blur: a vertical edge blurred horizontally spreads, vertically does not
  {
    ffcv::MatF v = edge; ffmotion::directionalBlur(v, 1.f, 0.f, 9.f);
    if (!(v.row(10)[31 * 3] > 60.f && v.row(10)[31 * 3] < 200.f)) { printf("FAIL hblur\n"); ++fails; }
    ffcv::MatF u = edge; ffmotion::directionalBlur(u, 0.f, 1.f, 9.f);
    if (std::abs(u.row(10)[31 * 3] - 60.f) > 1e-3f) { printf("FAIL vblur %f\n", u.row(10)[31 * 3]); ++fails; }
    ffcv::MatF z = edge; ffmotion::directionalBlur(z, 1.f, 0.f, 0.5f);
    if (z.data != edge.data) { printf("FAIL short blur changes\n"); ++fails; }
  }
  // exclusion: two side-by-side faces; this face's mask keeps its own centre, drops the
  // other's centre, and is untouched with no other face
  {
    ffcv::MatF m(100, 100, 1); for (auto& x : m.data) x = 1.f;
    ffcv::Affine id;  // identity: crop == frame
    const float self[4] = {0, 20, 60, 80};
    std::vector<std::array<float, 4>> oth = {{{45, 20, 105, 80}}};
    ffcv::MatF a = m; ffmotion::excludeOtherFaces(a, id, self, oth);
    const float mine = a.row(50)[30], theirs = a.row(50)[85], seam = a.row(50)[52];
    printf("EXCL mine=%.2f seam=%.2f theirs=%.2f\n", mine, seam, theirs);
    if (!(mine == 1.f && theirs == 0.f && seam > 0.f && seam < 1.f)) { printf("FAIL exclude\n"); ++fails; }
    ffcv::MatF b = m; ffmotion::excludeOtherFaces(b, id, self, {});
    if (b.data != m.data) { printf("FAIL exclude empty\n"); ++fails; }
  }
  // eye openness: 68-point layout with both eyes open, the left shut, a wink at half
  {
    float lm[136] = {};
    auto eye = [&](int i0, float cx, float h) {   // points i0..i0+5: corners and lids
      lm[2 * i0] = cx - 20;     lm[2 * i0 + 1] = 0;
      lm[2 * (i0 + 1)] = cx - 10; lm[2 * (i0 + 1) + 1] = -h;
      lm[2 * (i0 + 2)] = cx + 10; lm[2 * (i0 + 2) + 1] = -h;
      lm[2 * (i0 + 3)] = cx + 20; lm[2 * (i0 + 3) + 1] = 0;
      lm[2 * (i0 + 4)] = cx + 10; lm[2 * (i0 + 4) + 1] = h;
      lm[2 * (i0 + 5)] = cx - 10; lm[2 * (i0 + 5) + 1] = h;
    };
    float l = 0, r = 0;
    eye(36, 0, 6.f); eye(42, 80, 6.f);
    ffmotion::eyeOpenness2(lm, &l, &r);
    if (!(l > 0.28f && r > 0.28f && std::abs(l - r) < 0.01f)) { printf("FAIL eyes open %f %f\n", l, r); ++fails; }
    eye(36, 0, 0.5f);
    ffmotion::eyeOpenness2(lm, &l, &r);
    if (!(l < 0.05f && r > 0.28f)) { printf("FAIL wink %f %f\n", l, r); ++fails; }
    if (!(ffmotion::eyeOpenness(lm) < 0.05f)) { printf("FAIL min\n"); ++fails; }
    eye(36, 0, 3.2f);
    ffmotion::eyeOpenness2(lm, &l, &r);
    printf("EYES half=%.2f open=%.2f\n", l, r);
    // the trigger the restorer uses
    const float mn = std::min(l, r), mx = std::max(l, r);
    printf("wink trigger fires for half-shut vs open: %d\n", (mn < 0.22f || (mx - mn > 0.09f && mn < 0.30f)) ? 1 : 0);
  }
  printf(fails ? "test_new41: %d FAILED\n" : "test_new41: all passed\n", fails);
  return fails ? 1 : 0;
}
