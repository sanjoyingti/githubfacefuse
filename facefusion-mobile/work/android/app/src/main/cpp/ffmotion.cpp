#include "ffmotion.h"

#include <algorithm>
#include <cmath>

namespace ffmotion {

namespace {
constexpr float kRadToDeg = 57.2957795f;
// Nose-tip protrusion over the eye/mouth plane, in units of the eye span (and of the
// eye-to-mouth height, which is about the same on an average face).
constexpr float kNoseDepth = 0.43f;
// Where the nose tip sits between the eye line (0) and the mouth line (1) on a level face.
constexpr float kNoseRest = 0.55f;

float smoothstep(float e0, float e1, float x) {
  float t = (x - e0) / (e1 - e0);
  t = t < 0.f ? 0.f : (t > 1.f ? 1.f : t);
  return t * t * (3.f - 2.f * t);
}
}  // namespace

Pose estimatePose(const float* l) {
  Pose p;
  // landmark5 order: left eye, right eye, nose tip, left mouth corner, right mouth corner.
  const float elx = l[0], ely = l[1], erx = l[2], ery = l[3];
  const float nx = l[4], ny = l[5];
  const float mx = (l[6] + l[8]) * 0.5f, my = (l[7] + l[9]) * 0.5f;
  for (int i = 0; i < 10; ++i)
    if (!std::isfinite(l[i])) return p;

  const float ex = erx - elx, ey = ery - ely;
  const float span2 = ex * ex + ey * ey;
  if (span2 < 4.f) return p;   // under 2 px between the eyes: nothing to measure
  const float span = std::sqrt(span2);

  // Yaw: the nose tip's position along the eye axis, 0 = left eye, 1 = right eye.
  const float a = ((nx - elx) * ex + (ny - ely) * ey) / span2;
  p.yaw = std::atan((a - 0.5f) / kNoseDepth) * kRadToDeg;

  // Pitch: along the axis perpendicular to the eyes (pointing down the face).
  const float ux = -ey / span, uy = ex / span;
  const float cx = (elx + erx) * 0.5f, cy = (ely + ery) * 0.5f;
  const float dm = (mx - cx) * ux + (my - cy) * uy;
  if (dm < 1.f) {   // mouth not below the eyes: the landmarks are not a plausible face
    p.ok = true;
    p.pitch = 90.f;
    return p;
  }
  const float b = ((nx - cx) * ux + (ny - cy) * uy) / dm;
  p.pitch = std::atan((b - kNoseRest) / kNoseDepth) * kRadToDeg;
  p.ok = true;
  return p;
}

float poseFade(const float* landmark5, float startDeg) {
  if (!(startDeg < 90.f)) return 1.f;
  Pose p = estimatePose(landmark5);
  if (!p.ok) return 1.f;
  const float turn = std::max(std::fabs(p.yaw), std::fabs(p.pitch) * 1.3f);
  return 1.f - smoothstep(startDeg, startDeg + 20.f, turn);
}

void OneEuro5::apply(float* pts) {
  // Tuned to remove landmark jitter on a still head while lagging under ~2% of the eye span
  // at fast motion (beta is high on purpose: a lagging alignment pastes the face off-target,
  // which is worse than jitter).
  constexpr float kDt = 1.f / 30.f;
  constexpr float kMinCutoff = 1.5f;   // Hz
  constexpr float kBeta = 8.f;
  constexpr float kDCutoff = 4.f;      // Hz
  constexpr float kSnap = 0.25f;       // a jump over 1/4 eye span in one frame: no smoothing
  auto alpha = [&](float fc) {
    const float tau = 1.f / (2.f * 3.14159265f * fc);
    return 1.f / (1.f + tau / kDt);
  };

  const float ex = pts[2] - pts[0], ey = pts[3] - pts[1];
  const float span = std::sqrt(ex * ex + ey * ey);
  bool finite = span > 1.f;
  for (int i = 0; i < 10 && finite; ++i) finite = std::isfinite(pts[i]);
  if (!finite) { init = false; return; }

  if (!init) {
    for (int i = 0; i < 10; ++i) { x[i] = pts[i]; dx[i] = 0.f; }
    init = true;
    return;
  }
  float maxStep = 0.f;
  for (int i = 0; i < 10; ++i) maxStep = std::max(maxStep, std::fabs(pts[i] - x[i]) / span);
  if (maxStep > kSnap) {
    for (int i = 0; i < 10; ++i) { x[i] = pts[i]; dx[i] = 0.f; }
    return;
  }
  const float ad = alpha(kDCutoff);
  for (int i = 0; i < 10; ++i) {
    const float raw = (pts[i] - x[i]) / span / kDt;   // eye spans per second
    dx[i] += ad * (raw - dx[i]);
    const float a = alpha(kMinCutoff + kBeta * std::fabs(dx[i]));
    x[i] += a * (pts[i] - x[i]);
    pts[i] = x[i];
  }
}

ffcv::Image rotateImage(const ffcv::Image& src, int deg) {
  deg = ((deg % 360) + 360) % 360;
  if (deg == 0) return src;
  const int w = src.w, h = src.h, C = src.c;
  const bool swap = (deg == 90 || deg == 270);
  ffcv::Image dst(swap ? h : w, swap ? w : h, C);
  for (int yd = 0; yd < dst.h; ++yd) {
    uint8_t* drow = dst.row(yd);
    for (int xd = 0; xd < dst.w; ++xd) {
      int xs, ys;
      if (deg == 90)       { xs = yd;         ys = h - 1 - xd; }
      else if (deg == 180) { xs = w - 1 - xd; ys = h - 1 - yd; }
      else                 { xs = w - 1 - yd; ys = xd; }
      const uint8_t* s = src.row(ys) + (size_t)xs * C;
      for (int c = 0; c < C; ++c) drow[(size_t)xd * C + c] = s[c];
    }
  }
  return dst;
}

void unrotatePoint(int deg, int w, int h, float xr, float yr, float* x, float* y) {
  deg = ((deg % 360) + 360) % 360;
  if (deg == 90)       { *x = yr;              *y = (float)(h - 1) - xr; }
  else if (deg == 180) { *x = (float)(w - 1) - xr; *y = (float)(h - 1) - yr; }
  else if (deg == 270) { *x = (float)(w - 1) - yr; *y = xr; }
  else                 { *x = xr;              *y = yr; }
}

float iou(const float* a, const float* b) {
  const float ix0 = std::max(a[0], b[0]), iy0 = std::max(a[1], b[1]);
  const float ix1 = std::min(a[2], b[2]), iy1 = std::min(a[3], b[3]);
  const float iw = std::max(0.f, ix1 - ix0), ih = std::max(0.f, iy1 - iy0);
  const float inter = iw * ih;
  const float ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return ua > 0.f ? inter / ua : 0.f;
}

namespace {
// sRGB (0..255, BGR order in) <-> CIE Lab (D65), the conversion cv2.COLOR_BGR2LAB uses.
inline float srgbToLinear(float c) {
  c /= 255.f;
  return c <= 0.04045f ? c / 12.92f : std::pow((c + 0.055f) / 1.055f, 2.4f);
}
inline float linearToSrgb(float c) {
  c = c <= 0.0031308f ? c * 12.92f : 1.055f * std::pow(c, 1.f / 2.4f) - 0.055f;
  return c * 255.f;
}
inline float labF(float t) {
  return t > 0.008856f ? std::cbrt(t) : 7.787f * t + 16.f / 116.f;
}
inline float labFInv(float t) {
  const float t3 = t * t * t;
  return t3 > 0.008856f ? t3 : (t - 16.f / 116.f) / 7.787f;
}
void bgrToLab(float b, float g, float r, float* lab) {
  const float R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
  const float X = (0.412453f * R + 0.357580f * G + 0.180423f * B) / 0.950456f;
  const float Y = 0.212671f * R + 0.715160f * G + 0.072169f * B;
  const float Z = (0.019334f * R + 0.119193f * G + 0.950227f * B) / 1.088754f;
  const float fx = labF(X), fy = labF(Y), fz = labF(Z);
  lab[0] = 116.f * fy - 16.f;
  lab[1] = 500.f * (fx - fy);
  lab[2] = 200.f * (fy - fz);
}
void labToBgr(const float* lab, float* bgr) {
  const float fy = (lab[0] + 16.f) / 116.f, fx = fy + lab[1] / 500.f, fz = fy - lab[2] / 200.f;
  const float X = labFInv(fx) * 0.950456f, Y = labFInv(fy), Z = labFInv(fz) * 1.088754f;
  const float R = 3.240479f * X - 1.537150f * Y - 0.498535f * Z;
  const float G = -0.969256f * X + 1.875992f * Y + 0.041556f * Z;
  const float B = 0.055648f * X - 0.204043f * Y + 1.057311f * Z;
  auto clamp = [](float v) { return v < 0.f ? 0.f : (v > 1.f ? 1.f : v); };
  bgr[0] = linearToSrgb(clamp(B));
  bgr[1] = linearToSrgb(clamp(G));
  bgr[2] = linearToSrgb(clamp(R));
}
}  // namespace

void matchColor(const ffcv::Image& target, ffcv::MatF& swapped, const ffcv::MatF& mask,
                float strength) {
  if (strength <= 0.f) return;
  if (strength > 1.f) strength = 1.f;
  const int W = swapped.w, H = swapped.h;
  if (target.w != W || target.h != H || mask.w != W || mask.h != H) return;
  const size_t n = (size_t)W * H;
  std::vector<float> lt(n * 3), ls(n * 3);
  double st[3] = {}, ss[3] = {}, qt[3] = {}, qs[3] = {};
  size_t cnt = 0;
  for (int y = 0; y < H; ++y) {
    const uint8_t* tr = target.row(y);
    const float* sr = swapped.row(y);
    const float* mr = mask.row(y);
    for (int x = 0; x < W; ++x) {
      const size_t i = ((size_t)y * W + x) * 3;
      bgrToLab(tr[x * 3], tr[x * 3 + 1], tr[x * 3 + 2], &lt[i]);
      bgrToLab(sr[x * 3], sr[x * 3 + 1], sr[x * 3 + 2], &ls[i]);
      if (mr[x] > 0.5f) {
        for (int c = 0; c < 3; ++c) {
          st[c] += lt[i + c]; qt[c] += (double)lt[i + c] * lt[i + c];
          ss[c] += ls[i + c]; qs[c] += (double)ls[i + c] * ls[i + c];
        }
        ++cnt;
      }
    }
  }
  if (cnt < 64) return;   // too little face to measure
  float mt[3], ms[3], ratio[3];
  for (int c = 0; c < 3; ++c) {
    mt[c] = (float)(st[c] / cnt);
    ms[c] = (float)(ss[c] / cnt);
    const double vt = std::max(0.0, qt[c] / cnt - (double)mt[c] * mt[c]);
    const double vs = std::max(0.0, qs[c] / cnt - (double)ms[c] * ms[c]);
    float r = vs > 1e-6 ? (float)std::sqrt(vt / vs) : 1.f;
    ratio[c] = r < 0.6f ? 0.6f : (r > 1.6f ? 1.6f : r);
  }
  for (int y = 0; y < H; ++y) {
    float* sr = swapped.row(y);
    for (int x = 0; x < W; ++x) {
      const size_t i = ((size_t)y * W + x) * 3;
      float lab[3], bgr[3];
      for (int c = 0; c < 3; ++c) lab[c] = (ls[i + c] - ms[c]) * ratio[c] + mt[c];
      labToBgr(lab, bgr);
      for (int c = 0; c < 3; ++c)
        sr[x * 3 + c] = sr[x * 3 + c] * (1.f - strength) + bgr[c] * strength;
    }
  }
}

ffcv::MatF remapMask(const ffcv::MatF& mask, const ffcv::Affine& fromAffine,
                     const ffcv::Affine& toAffine, int w, int h) {
  // old crop -> frame (inverse of fromAffine), then frame -> new crop (toAffine).
  const ffcv::Affine inv = ffcv::invertAffine(fromAffine);
  ffcv::Affine m;
  for (int r = 0; r < 2; ++r)
    for (int c = 0; c < 3; ++c) {
      double v = toAffine(r, 0) * inv(0, c) + toAffine(r, 1) * inv(1, c);
      if (c == 2) v += toAffine(r, 2);
      m(r, c) = v;
    }
  return ffcv::warpAffineF(mask, m, w, h, ffcv::BORDER_CONSTANT);
}

std::vector<uint8_t> thumbGray(const ffcv::Image& crop, int n) {
  std::vector<uint8_t> t((size_t)n * n, 0);
  if (crop.w < n || crop.h < n) return t;
  for (int ty = 0; ty < n; ++ty)
    for (int tx = 0; tx < n; ++tx) {
      const int x0 = tx * crop.w / n, x1 = (tx + 1) * crop.w / n;
      const int y0 = ty * crop.h / n, y1 = (ty + 1) * crop.h / n;
      long sum = 0, cnt = 0;
      for (int y = y0; y < y1; y += 2) {
        const uint8_t* r = crop.row(y);
        for (int x = x0; x < x1; x += 2) {
          sum += (r[x * 3] + 2 * r[x * 3 + 1] + r[x * 3 + 2]) / 4;
          ++cnt;
        }
      }
      t[(size_t)ty * n + tx] = (uint8_t)(cnt ? sum / cnt : 0);
    }
  return t;
}

bool thumbSame(const std::vector<uint8_t>& a, const std::vector<uint8_t>& b) {
  if (a.empty() || a.size() != b.size()) return false;
  long total = 0;
  int worst = 0;
  for (size_t i = 0; i < a.size(); ++i) {
    const int d = std::abs((int)a[i] - (int)b[i]);
    total += d;
    worst = std::max(worst, d);
  }
  // Mean under 2 grey levels and no cell over 10: noise and compression flicker pass,
  // anything that moves into or across the face does not.
  return total <= (long)a.size() * 2 && worst <= 10;
}

float eyeOpenness(const float* l) {
  auto d = [&](int i, int j) {
    const float dx = l[2 * i] - l[2 * j], dy = l[2 * i + 1] - l[2 * j + 1];
    return std::sqrt(dx * dx + dy * dy);
  };
  const float wl = d(36, 39), wr = d(42, 45);
  const float el = wl > 1e-3f ? (d(37, 41) + d(38, 40)) / (2.f * wl) : 1.f;
  const float er = wr > 1e-3f ? (d(43, 47) + d(44, 46)) / (2.f * wr) : 1.f;
  return std::min(el, er);
}

ffcv::MatF resizeMask(const ffcv::MatF& src, int w, int h) {
  if (src.w == w && src.h == h) return src;
  ffcv::MatF dst(w, h, 1);
  const float sx = (float)src.w / w, sy = (float)src.h / h;
  for (int y = 0; y < h; ++y) {
    float fy = (y + 0.5f) * sy - 0.5f;
    fy = std::max(0.f, std::min(fy, (float)(src.h - 1)));
    const int y0 = (int)fy, y1 = std::min(y0 + 1, src.h - 1);
    const float wy = fy - y0;
    const float* r0 = src.row(y0);
    const float* r1 = src.row(y1);
    float* d = dst.row(y);
    for (int x = 0; x < w; ++x) {
      float fx = (x + 0.5f) * sx - 0.5f;
      fx = std::max(0.f, std::min(fx, (float)(src.w - 1)));
      const int x0 = (int)fx, x1 = std::min(x0 + 1, src.w - 1);
      const float wx = fx - x0;
      const float top = r0[x0] + (r0[x1] - r0[x0]) * wx;
      const float bot = r1[x0] + (r1[x1] - r1[x0]) * wx;
      d[x] = top + (bot - top) * wy;
    }
  }
  return dst;
}

}  // namespace ffmotion
