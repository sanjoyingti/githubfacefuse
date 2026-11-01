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
