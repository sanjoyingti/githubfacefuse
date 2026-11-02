// Host test for the occlusion / head-turn / motion upgrade, on the ncnn CPU backend.
//
//   test_quality --models DIR --masks DIR --source src.ppm --out OUTDIR
//                [--occlusion 0|1] [--region 0|1] [--mouth 0|1] [--fade DEG]
//                [--sequence 0|1] [--rotated 0|1] [--track N] frame0.ppm frame1.ppm ...
//
// Reads binary PPM (P6), writes the swapped frames as OUTDIR/out_NNN.ppm and prints one
// line per frame: faces found, their pose fade and the stage timings. Built by
// work/native/build_host_test.sh. Not part of the APK.
#include <cstdio>
#include <cstdlib>
#include <cmath>
#include <cstring>
#include <string>
#include <vector>

#include "ffcv.h"
#include "ffmotion.h"
#include "ffnn.h"
#include "ffpipe.h"

static bool readPpm(const std::string& path, ffcv::Image& img) {
  FILE* f = fopen(path.c_str(), "rb");
  if (!f) return false;
  int w = 0, h = 0, mx = 0;
  if (fscanf(f, "P6 %d %d %d", &w, &h, &mx) != 3 || mx != 255) { fclose(f); return false; }
  fgetc(f);
  img = ffcv::Image(w, h, 3);
  std::vector<uint8_t> rgb((size_t)w * h * 3);
  const bool ok = fread(rgb.data(), 1, rgb.size(), f) == rgb.size();
  fclose(f);
  for (size_t i = 0; i < rgb.size(); i += 3) {   // RGB -> BGR
    img.data[i] = rgb[i + 2]; img.data[i + 1] = rgb[i + 1]; img.data[i + 2] = rgb[i];
  }
  return ok;
}

static bool writePpm(const std::string& path, const ffcv::Image& img) {
  FILE* f = fopen(path.c_str(), "wb");
  if (!f) return false;
  fprintf(f, "P6\n%d %d\n255\n", img.w, img.h);
  std::vector<uint8_t> rgb(img.data.size());
  for (size_t i = 0; i < rgb.size(); i += 3) {
    rgb[i] = img.data[i + 2]; rgb[i + 1] = img.data[i + 1]; rgb[i + 2] = img.data[i];
  }
  fwrite(rgb.data(), 1, rgb.size(), f);
  fclose(f);
  return true;
}

static int selfTests() {
  int fails = 0;
  // A level frontal face: eyes level, nose centred halfway down, mouth below.
  const float frontal[10] = {100, 100, 160, 100, 130, 133, 108, 160, 152, 160};
  ffmotion::Pose p = ffmotion::estimatePose(frontal);
  printf("[self] frontal yaw %.1f pitch %.1f fade %.2f\n", p.yaw, p.pitch,
         ffmotion::poseFade(frontal, 60.f));
  if (!(std::abs(p.yaw) < 5 && std::abs(p.pitch) < 10)) { puts("FAIL frontal pose"); ++fails; }
  // Nose past the right eye: a near-profile turn.
  const float profile[10] = {100, 100, 160, 100, 230, 133, 120, 160, 160, 160};
  p = ffmotion::estimatePose(profile);
  const float fp = ffmotion::poseFade(profile, 60.f);
  printf("[self] profile yaw %.1f fade %.2f\n", p.yaw, fp);
  if (!(p.yaw > 70 && fp < 0.3f)) { puts("FAIL profile fade"); ++fails; }
  if (ffmotion::poseFade(profile, 90.f) != 1.f) { puts("FAIL fade disabled"); ++fails; }

  // Rotation round trip on a 5x3 image, every angle.
  ffcv::Image img(5, 3, 3);
  for (size_t i = 0; i < img.data.size(); ++i) img.data[i] = (uint8_t)i;
  for (int deg : {90, 180, 270}) {
    ffcv::Image r = ffmotion::rotateImage(img, deg);
    for (int y = 0; y < r.h; ++y)
      for (int x = 0; x < r.w; ++x) {
        float ox, oy;
        ffmotion::unrotatePoint(deg, img.w, img.h, (float)x, (float)y, &ox, &oy);
        if (std::memcmp(r.row(y) + x * 3, img.row((int)oy) + (int)ox * 3, 3) != 0) {
          printf("FAIL rotate %d at %d,%d\n", deg, x, y); ++fails; y = r.h; break;
        }
      }
  }
  // One-Euro: a still, jittering point set must move less than its input does.
  ffmotion::OneEuro5 f;
  double inJ = 0, outJ = 0;
  float prevIn = 0, prevOut = 0;
  srand(1);
  for (int t = 0; t < 120; ++t) {
    float pts[10];
    for (int k = 0; k < 10; ++k) pts[k] = frontal[k] + ((rand() % 100) / 100.f - 0.5f) * 3.f;
    const float in0 = pts[0];
    f.apply(pts);
    if (t > 10) { inJ += std::abs(in0 - prevIn); outJ += std::abs(pts[0] - prevOut); }
    prevIn = in0; prevOut = pts[0];
  }
  printf("[self] one-euro jitter in %.1f out %.1f\n", inJ, outJ);
  if (!(outJ < inJ * 0.6)) { puts("FAIL smoothing"); ++fails; }
  // ...and a fast linear move must not lag by more than 3% of the eye span.
  f.reset();
  float lag = 0;
  for (int t = 0; t < 30; ++t) {
    float pts[10];
    for (int k = 0; k < 10; ++k) pts[k] = frontal[k] + (k % 2 == 0 ? t * 6.f : 0.f);
    const float want = pts[0];
    f.apply(pts);
    if (t > 5) lag = std::max(lag, std::abs(want - pts[0]) / 60.f);
  }
  printf("[self] one-euro lag at 6 px/frame: %.3f eye spans\n", lag);
  // remapMask: a picture warped into crop A and re-mapped into crop B must match the same
  // picture warped into crop B directly (the expression restorer reuses the swap's mask).
  {
    ffcv::MatF img(400, 300, 1);
    for (int y = 0; y < img.h; ++y)
      for (int x = 0; x < img.w; ++x)
        img.row(y)[x] = 0.5f + 0.5f * std::sin(x * 0.05f) * std::cos(y * 0.04f);
    const float lm[10] = {170, 140, 230, 138, 200, 175, 178, 205, 224, 204};
    float ta[10], tb[10];
    const float* A = ffcv::warpTemplate(1);   // arcface_128, as the swap
    const float* B = ffcv::warpTemplate(2);   // ffhq_512, a different crop
    for (int i = 0; i < 10; ++i) { ta[i] = A[i] * 256; tb[i] = B[i] * 512; }
    const ffcv::Affine amA = ffcv::umeyama(lm, ta, 5), amB = ffcv::umeyama(lm, tb, 5);
    const ffcv::MatF inA = ffcv::warpAffineF(img, amA, 256, 256, ffcv::BORDER_CONSTANT);
    const ffcv::MatF direct = ffcv::warpAffineF(img, amB, 512, 512, ffcv::BORDER_CONSTANT);
    const ffcv::MatF moved = ffmotion::remapMask(inA, amA, amB, 512, 512);
    double err = 0; int n = 0;
    for (size_t i = 0; i < direct.data.size(); ++i)
      if (moved.data[i] > 0.f) { err += std::fabs(moved.data[i] - direct.data[i]); ++n; }
    err = n ? err / n : 1.0;
    printf("[self] remapMask mean error %.4f over %d px\n", err, n);
    if (!(n > 10000 && err < 0.02)) { puts("FAIL remapMask"); ++fails; }
  }
  if (!(lag < 0.03f)) { puts("FAIL smoothing lag"); ++fails; }
  return fails;
}

int main(int argc, char** argv) {
  std::string models, masks, src, out = ".";
  ffpipe::Config cfg;
  bool sequence = false;
  int track = 0;
  std::vector<std::string> frames;
  for (int i = 1; i < argc; ++i) {
    const std::string a = argv[i];
    auto v = [&]() { return i + 1 < argc ? std::string(argv[++i]) : std::string(); };
    if (a == "--self-test") return selfTests() ? 1 : 0;
    else if (a == "--models") models = v();
    else if (a == "--masks") masks = v();
    else if (a == "--source") src = v();
    else if (a == "--out") out = v();
    else if (a == "--occlusion") cfg.occlusionMask = v() == "1";
    else if (a == "--region") cfg.regionMask = v() == "1";
    else if (a == "--mouth") cfg.keepMouth = v() == "1";
    else if (a == "--lips") cfg.keepLips = v() == "1";
    else if (a == "--smart") cfg.smartSpeed = v() == "1";
    else if (a == "--parallel") cfg.parallelMasks = v() == "1";
    else if (a == "--color") cfg.colorMatch = (float)atof(v().c_str());
    else if (a == "--fade") cfg.poseFadeStart = (float)atof(v().c_str());
    else if (a == "--sequence") sequence = v() == "1";
    else if (a == "--rotated") cfg.detectRotated = v() == "1";
    else if (a == "--track") track = atoi(v().c_str());
    else frames.push_back(a);
  }
  setenv("FFBACKEND", "ncnn", 1);
  setenv("FFNCNN_GPU", "off", 1);
  ffnn::setAuxDir(masks);

  ffpipe::Pipeline pipe;
  if (!pipe.init("", "", models, "hyperswap", cfg)) {
    fprintf(stderr, "init: %s\n", pipe.error().c_str());
    return 2;
  }
  pipe.setTrackPeriod(track);
  pipe.setSequence(sequence);
  ffcv::Image s;
  if (!readPpm(src, s) || !pipe.setSource(s)) {
    fprintf(stderr, "source: %s\n", pipe.error().c_str());
    return 3;
  }
  int idx = 0;
  for (const std::string& fp : frames) {
    ffcv::Image fr;
    if (!readPpm(fp, fr)) { fprintf(stderr, "cannot read %s\n", fp.c_str()); return 4; }
    pipe.resetStats();
    auto faces = pipe.analyse(fr);
    if (!pipe.swapAll(fr, faces)) { fprintf(stderr, "swap: %s\n", pipe.error().c_str()); return 5; }
    char name[64];
    snprintf(name, sizeof(name), "/out_%03d.ppm", idx++);
    writePpm(out + name, fr);
    printf("frame %d faces %zu", idx - 1, faces.size());
    for (const auto& f : faces) {
      ffmotion::Pose p = ffmotion::estimatePose(f.landmark5_68);
      printf(" [det %.2f yaw %.0f pitch %.0f fade %.2f box %.0f,%.0f,%.0f,%.0f mouth %.0f,%.0f]",
             f.detScore, p.yaw, p.pitch, f.poseFade, f.box[0], f.box[1], f.box[2], f.box[3],
             (f.landmark5_68[6] + f.landmark5_68[8]) * 0.5f,
             (f.landmark5_68[7] + f.landmark5_68[9]) * 0.5f);
    }
    printf("  mask %.0f ms  swap %.0f ms  occ=%d parse=%d\n", pipe.msGeomMask, pipe.msSwap,
           pipe.hasOcclusionModel(), pipe.hasParserModel());
  }
  printf("%s\n", ffpipe::Pipeline::maskStatus().c_str());
  {
    // Thread count at the end: a leak per frame shows here.
    FILE* st = fopen("/proc/self/status", "r");
    char line[256];
    while (st && fgets(line, sizeof(line), st))
      if (strncmp(line, "Threads:", 8) == 0) printf("%s", line);
    if (st) fclose(st);
  }
  return 0;
}
