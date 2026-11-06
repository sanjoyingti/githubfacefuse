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
  matchColor(target, swapped, mask, strength, nullptr);
}

void matchColor(const ffcv::Image& target, ffcv::MatF& swapped, const ffcv::MatF& mask,
                float strength, ColorState* state) {
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
  if (state) {
    if (!state->init) {
      for (int c = 0; c < 3; ++c) { state->mt[c] = mt[c]; state->ratio[c] = ratio[c]; }
      state->init = true;
    } else {
      constexpr float a = 0.35f;
      for (int c = 0; c < 3; ++c) {
        state->mt[c] += a * (mt[c] - state->mt[c]);
        state->ratio[c] += a * (ratio[c] - state->ratio[c]);
        mt[c] = state->mt[c]; ratio[c] = state->ratio[c];
      }
    }
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

void eyeOpenness2(const float* l, float* left, float* right) {
  auto d = [&](int i, int j) {
    const float dx = l[2 * i] - l[2 * j], dy = l[2 * i + 1] - l[2 * j + 1];
    return std::sqrt(dx * dx + dy * dy);
  };
  const float wl = d(36, 39), wr = d(42, 45);
  *left = wl > 1e-3f ? (d(37, 41) + d(38, 40)) / (2.f * wl) : 1.f;
  *right = wr > 1e-3f ? (d(43, 47) + d(44, 46)) / (2.f * wr) : 1.f;
}

float mouthOpenness(const float* l) {
  auto d = [&](int i, int j) {
    const float dx = l[2 * i] - l[2 * j], dy = l[2 * i + 1] - l[2 * j + 1];
    return std::sqrt(dx * dx + dy * dy);
  };
  const float w = d(48, 54);
  if (!(w > 1e-3f)) return 1.f;
  const float gap = (d(61, 67) + d(62, 66) + d(63, 65)) / 3.f;
  return gap / w;
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



namespace {
// Box sum over a (2r+1)^2 window via an integral image; borders clamp the window.
void boxMean(const std::vector<float>& in, int W, int H, int r, std::vector<float>& out) {
  std::vector<double> I((size_t)(W + 1) * (H + 1), 0.0);
  for (int y = 0; y < H; ++y) {
    double row = 0;
    for (int x = 0; x < W; ++x) {
      row += in[(size_t)y * W + x];
      I[(size_t)(y + 1) * (W + 1) + x + 1] = I[(size_t)y * (W + 1) + x + 1] + row;
    }
  }
  out.resize((size_t)W * H);
  for (int y = 0; y < H; ++y) {
    const int y0 = std::max(0, y - r), y1 = std::min(H, y + r + 1);
    for (int x = 0; x < W; ++x) {
      const int x0 = std::max(0, x - r), x1 = std::min(W, x + r + 1);
      const double s = I[(size_t)y1 * (W + 1) + x1] - I[(size_t)y0 * (W + 1) + x1] -
                       I[(size_t)y1 * (W + 1) + x0] + I[(size_t)y0 * (W + 1) + x0];
      out[(size_t)y * W + x] = (float)(s / ((double)(x1 - x0) * (y1 - y0)));
    }
  }
}

// 5-tap binomial blur then drop every other row/column.
std::vector<float> pyrDown(const std::vector<float>& in, int W, int H, int C) {
  const float k[5] = {1 / 16.f, 4 / 16.f, 6 / 16.f, 4 / 16.f, 1 / 16.f};
  std::vector<float> tmp((size_t)W * H * C);
  for (int y = 0; y < H; ++y)
    for (int x = 0; x < W; ++x)
      for (int c = 0; c < C; ++c) {
        float s = 0;
        for (int t = -2; t <= 2; ++t) {
          const int xx = std::min(W - 1, std::max(0, x + t));
          s += k[t + 2] * in[((size_t)y * W + xx) * C + c];
        }
        tmp[((size_t)y * W + x) * C + c] = s;
      }
  const int w2 = W / 2, h2 = H / 2;
  std::vector<float> out((size_t)w2 * h2 * C);
  for (int y = 0; y < h2; ++y)
    for (int x = 0; x < w2; ++x)
      for (int c = 0; c < C; ++c) {
        float s = 0;
        for (int t = -2; t <= 2; ++t) {
          const int yy = std::min(H - 1, std::max(0, 2 * y + t));
          s += k[t + 2] * tmp[((size_t)yy * W + 2 * x) * C + c];
        }
        out[((size_t)y * w2 + x) * C + c] = s;
      }
  return out;
}

// Bilinear 2x upsample to exactly W x H.
std::vector<float> pyrUp(const std::vector<float>& in, int w, int h, int W, int H, int C) {
  std::vector<float> out((size_t)W * H * C);
  for (int y = 0; y < H; ++y) {
    float fy = (y + 0.5f) * 0.5f - 0.5f;
    fy = std::max(0.f, std::min(fy, (float)(h - 1)));
    const int y0 = (int)fy, y1 = std::min(y0 + 1, h - 1);
    const float wy = fy - y0;
    for (int x = 0; x < W; ++x) {
      float fx = (x + 0.5f) * 0.5f - 0.5f;
      fx = std::max(0.f, std::min(fx, (float)(w - 1)));
      const int x0 = (int)fx, x1 = std::min(x0 + 1, w - 1);
      const float wx = fx - x0;
      for (int c = 0; c < C; ++c) {
        const float a = in[((size_t)y0 * w + x0) * C + c], b = in[((size_t)y0 * w + x1) * C + c];
        const float d = in[((size_t)y1 * w + x0) * C + c], e = in[((size_t)y1 * w + x1) * C + c];
        out[((size_t)y * W + x) * C + c] =
            (a * (1 - wx) + b * wx) * (1 - wy) + (d * (1 - wx) + e * wx) * wy;
      }
    }
  }
  return out;
}
}  // namespace

void refineMaskEdges(const ffcv::Image& guide, ffcv::MatF& mask, int radius, float eps) {
  const int W = mask.w, H = mask.h;
  if (guide.w != W || guide.h != H || radius < 1) return;
  const size_t n = (size_t)W * H;
  std::vector<float> I(n), p(mask.data.begin(), mask.data.end()), Ip(n), II(n);
  for (int y = 0; y < H; ++y) {
    const uint8_t* g = guide.row(y);
    for (int x = 0; x < W; ++x) {
      const size_t i = (size_t)y * W + x;
      I[i] = (0.114f * g[x * 3] + 0.587f * g[x * 3 + 1] + 0.299f * g[x * 3 + 2]) / 255.f;
      Ip[i] = I[i] * p[i];
      II[i] = I[i] * I[i];
    }
  }
  std::vector<float> mI, mp, mIp, mII;
  boxMean(I, W, H, radius, mI);
  boxMean(p, W, H, radius, mp);
  boxMean(Ip, W, H, radius, mIp);
  boxMean(II, W, H, radius, mII);
  std::vector<float> a(n), b(n);
  for (size_t i = 0; i < n; ++i) {
    const float cov = mIp[i] - mI[i] * mp[i];
    const float var = mII[i] - mI[i] * mI[i];
    a[i] = cov / (var + eps);
    b[i] = mp[i] - a[i] * mI[i];
  }
  std::vector<float> ma, mb;
  boxMean(a, W, H, radius, ma);
  boxMean(b, W, H, radius, mb);
  for (size_t i = 0; i < n; ++i) {
    float q = ma[i] * I[i] + mb[i];
    q = q < 0.f ? 0.f : (q > 1.f ? 1.f : q);
    if (!std::isfinite(q)) q = p[i];
    // Only ever shrink: hair, hands and food stay original.
    if (q < mask.data[i]) mask.data[i] = q;
  }
}

void seamlessBlend(const ffcv::Image& bg, ffcv::MatF& fg, const ffcv::MatF& mask, int levels) {
  const int W = fg.w, H = fg.h;
  if (bg.w != W || bg.h != H || mask.w != W || mask.h != H || fg.c != 3 || levels < 2) return;
  if ((W % (1 << (levels - 1))) != 0 || (H % (1 << (levels - 1))) != 0) return;
  std::vector<float> A(fg.data.begin(), fg.data.end()), B((size_t)W * H * 3),
      M(mask.data.begin(), mask.data.end());
  for (int y = 0; y < H; ++y) {
    const uint8_t* r = bg.row(y);
    for (int x = 0; x < W * 3; ++x) B[(size_t)y * W * 3 + x] = r[x];
  }
  // Gaussian pyramids.
  std::vector<std::vector<float>> GA{A}, GB{B}, GM{M};
  std::vector<int> ws{W}, hs{H};
  for (int l = 1; l < levels; ++l) {
    GA.push_back(pyrDown(GA.back(), ws.back(), hs.back(), 3));
    GB.push_back(pyrDown(GB.back(), ws.back(), hs.back(), 3));
    GM.push_back(pyrDown(GM.back(), ws.back(), hs.back(), 1));
    ws.push_back(ws.back() / 2); hs.push_back(hs.back() / 2);
  }
  // Blend from the coarsest level up: R = up(R) + mask*(LA) + (1-mask)*(LB).
  const int L = levels - 1;
  std::vector<float> R((size_t)ws[L] * hs[L] * 3);
  for (size_t i = 0; i < R.size(); ++i) {
    const float m = GM[L][i / 3];
    R[i] = GA[L][i] * m + GB[L][i] * (1.f - m);
  }
  for (int l = L - 1; l >= 0; --l) {
    std::vector<float> upR = pyrUp(R, ws[l + 1], hs[l + 1], ws[l], hs[l], 3);
    std::vector<float> upA = pyrUp(GA[l + 1], ws[l + 1], hs[l + 1], ws[l], hs[l], 3);
    std::vector<float> upB = pyrUp(GB[l + 1], ws[l + 1], hs[l + 1], ws[l], hs[l], 3);
    R.assign(upR.size(), 0.f);
    for (size_t i = 0; i < R.size(); ++i) {
      const float m = GM[l][i / 3];
      const float la = GA[l][i] - upA[i], lb = GB[l][i] - upB[i];
      R[i] = upR[i] + m * la + (1.f - m) * lb;
    }
  }
  for (size_t i = 0; i < R.size(); ++i) {
    const float v = R[i];
    fg.data[i] = v < 0.f ? 0.f : (v > 255.f ? 255.f : v);
  }
}

// Unsharp mask in place: out = x + amount * 0.8 * (x - blur(x)), blur = two box passes of
// radius r (separable, integral rows), clamped to 0..255.
void sharpen(ffcv::MatF& img, float amount, int r) {
  const int W = img.w, H = img.h, C = img.c;
  std::vector<float> a(img.data), b(img.data.size());
  auto pass = [&](const std::vector<float>& src, std::vector<float>& dst, bool horiz) {
    const int n = horiz ? W : H, m = horiz ? H : W;
    std::vector<double> acc((size_t)n + 1);
    for (int j = 0; j < m; ++j)
      for (int c = 0; c < C; ++c) {
        acc[0] = 0;
        for (int i = 0; i < n; ++i) {
          const size_t idx = horiz ? ((size_t)j * W + i) * C + c : ((size_t)i * W + j) * C + c;
          acc[(size_t)i + 1] = acc[(size_t)i] + src[idx];
        }
        for (int i = 0; i < n; ++i) {
          const int lo = std::max(0, i - r), hi = std::min(n - 1, i + r);
          const size_t idx = horiz ? ((size_t)j * W + i) * C + c : ((size_t)i * W + j) * C + c;
          dst[idx] = (float)((acc[(size_t)hi + 1] - acc[(size_t)lo]) / (hi - lo + 1));
        }
      }
  };
  pass(a, b, true); pass(b, a, false); pass(a, b, true); pass(b, a, false);
  const float k = amount * 0.8f;
  for (size_t i = 0; i < img.data.size(); ++i) {
    const float v = img.data[i] + k * (img.data[i] - a[i]);
    img.data[i] = v < 0.f ? 0.f : (v > 255.f ? 255.f : v);
  }
}

void directionalBlur(ffcv::MatF& img, float vx, float vy, float len) {
  // Fast streak: a box blur along x for the motion's x part, then along y for its y part,
  // with running sums -- constant cost per pixel whatever the length (a few ms at 512),
  // instead of sampling the whole streak at every pixel.
  const float n = std::sqrt(vx * vx + vy * vy);
  if (!(len >= 1.f) || !(n > 0.f) || img.c != 3) return;
  const int rx = (int)std::lround(0.5f * len * std::fabs(vx) / n);
  const int ry = (int)std::lround(0.5f * len * std::fabs(vy) / n);
  const int W = img.w, H = img.h;
  std::vector<float> line((size_t)std::max(W, H) * 3);
  auto pass = [&](bool horiz, int r) {
    if (r < 1) return;
    const int len1 = horiz ? W : H, lines = horiz ? H : W;
    const float inv = 1.f / (2 * r + 1);
    for (int j = 0; j < lines; ++j) {
      auto at = [&](int i) -> float* {
        i = i < 0 ? 0 : (i >= len1 ? len1 - 1 : i);
        return horiz ? img.row(j) + (size_t)i * 3 : img.row(i) + (size_t)j * 3;
      };
      float s[3] = {0.f, 0.f, 0.f};
      for (int k = -r; k <= r; ++k) { const float* p = at(k); s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; }
      for (int i = 0; i < len1; ++i) {
        float* o = &line[(size_t)i * 3];
        o[0] = s[0] * inv; o[1] = s[1] * inv; o[2] = s[2] * inv;
        const float* add = at(i + r + 1); const float* sub = at(i - r);
        s[0] += add[0] - sub[0]; s[1] += add[1] - sub[1]; s[2] += add[2] - sub[2];
      }
      for (int i = 0; i < len1; ++i) {
        float* d = at(i); const float* o = &line[(size_t)i * 3];
        d[0] = o[0]; d[1] = o[1]; d[2] = o[2];
      }
    }
  };
  pass(true, rx);
  pass(false, ry);
}

void excludeOtherFaces(ffcv::MatF& mask, const ffcv::Affine& am, const float* box,
                       const std::vector<std::array<float, 4>>& others) {
  if (others.empty() || mask.c != 1) return;
  const ffcv::Affine inv = ffcv::invertAffine(am);
  struct E { float cx, cy, irx, iry; };
  auto ell = [](float x0, float y0, float x1, float y1) {
    const float rx = std::max(1.f, 0.5f * (x1 - x0)), ry = std::max(1.f, 0.5f * (y1 - y0));
    return E{0.5f * (x0 + x1), 0.5f * (y0 + y1), 1.f / rx, 1.f / ry};
  };
  const E self = ell(box[0], box[1], box[2], box[3]);
  std::vector<E> oth;
  for (const auto& b : others) oth.push_back(ell(b[0], b[1], b[2], b[3]));
  auto d2 = [](const E& e, float qx, float qy) {
    const float a = (qx - e.cx) * e.irx, b = (qy - e.cy) * e.iry;
    return a * a + b * b;
  };
  for (int y = 0; y < mask.h; ++y) {
    float* row = mask.row(y);
    for (int x = 0; x < mask.w; ++x) {
      if (row[x] <= 0.f) continue;
      const float qx = (float)(inv(0, 0) * x + inv(0, 1) * y + inv(0, 2));
      const float qy = (float)(inv(1, 0) * x + inv(1, 1) * y + inv(1, 2));
      const float ds = d2(self, qx, qy);
      float keep = 1.f;
      for (const E& e : oth) {
        const float dg = d2(e, qx, qy);
        if (dg >= 1.3f) continue;          // outside the other face: not its pixel
        // Nearer to the other face (in face units) -> theirs; a soft seam where equal.
        float w = 0.5f + (dg - ds) / 0.5f;
        w = w < 0.f ? 0.f : (w > 1.f ? 1.f : w);
        keep = std::min(keep, w);
      }
      row[x] *= keep;
    }
  }
}

}  // namespace ffmotion
