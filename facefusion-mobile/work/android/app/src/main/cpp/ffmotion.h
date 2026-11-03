// Head-pose, motion and rotation helpers for the swap pipeline.
//
// Everything here is geometry on landmarks the pipeline already computes -- no model runs in
// this file. It exists for the three failure cases a box-mask-only swap handles badly:
//
//   * big head turns (yaw/pitch): the swapper and the 5-point alignment are trained on
//     frontal-to-3/4 faces, so past ~60 degrees they produce a stretched face. poseFade()
//     estimates the turn and lets the pipeline fade the swap OUT instead.
//   * fast motion: landmark jitter makes the pasted face "swim". OneEuro5 smooths the five
//     alignment points with a filter that follows quickly when the head moves fast.
//   * rotated heads (lying down, upside down): rotateImage()/unrotatePoint() let the
//     detector look at the frame turned by 90/180/270 degrees.
#pragma once

#include "ffcv.h"

namespace ffmotion {

// Estimated head turn from the five alignment points (eyes, nose tip, mouth corners), in
// degrees. Positive yaw = nose towards image right, positive pitch = looking down.
//
// The estimate uses the nose tip's position between the eyes (yaw) and between the eye line
// and the mouth (pitch). For a face with the nose ~0.43 eye-spans in front of the eye/mouth
// plane, offset = 0.43 * tan(angle). It is approximate, but monotonic, which is all a fade
// needs.
struct Pose {
  bool ok = false;
  float yaw = 0.f, pitch = 0.f;
};
Pose estimatePose(const float* landmark5);

// 1 = swap fully, 0 = leave the original face. Fades from `startDeg` to `startDeg + 20`.
// Pitch counts 1.3x because the swapper degrades sooner looking up/down than sideways.
// startDeg >= 90 disables the fade (always 1).
float poseFade(const float* landmark5, float startDeg);

// One-Euro filter (Casiez et al. 2012) over the 10 coordinates of a 5-point landmark set.
// Units are normalised by the eye distance so the same parameters work at any face size.
// Assumes ~30 fps; the pipeline does not receive timestamps.
struct OneEuro5 {
  bool init = false;
  float x[10] = {};
  float dx[10] = {};
  // Returns the smoothed points in `pts` (in place).
  void apply(float* pts);
  void reset() { init = false; }
};

// Rotate a packed BGR image clockwise by 90, 180 or 270 degrees.
ffcv::Image rotateImage(const ffcv::Image& src, int degreesCw);

// Map a point found in an image rotated clockwise by `degreesCw` back to the original
// image of size w x h.
void unrotatePoint(int degreesCw, int w, int h, float xr, float yr, float* x, float* y);

// Intersection over union of two [x0,y0,x1,y1] boxes.
float iou(const float* a, const float* b);

// Reinhard colour transfer (DeepFaceLab "rct") in CIE Lab: `swapped` (CS x CS x 3, BGR
// 0..255 floats) takes the per-channel mean and spread of `target` (the original face crop,
// same geometry), both measured where `mask` > 0.5. `strength` 0..1 blends the result with
// the unmatched face. The spread ratio is clamped to [0.6, 1.6] so a dark or flat crop
// cannot blow the face out.
void matchColor(const ffcv::Image& target, ffcv::MatF& swapped, const ffcv::MatF& mask,
                float strength);

// The same transfer with its statistics smoothed over a video: [state] carries the last
// frame's target mean and spread ratio per Lab channel, and each frame moves 35% of the way
// to its own measurement. The face's colour then follows real lighting changes but not the
// frame-to-frame jitter of the mask edge, which read as flicker.
struct ColorState {
  bool init = false;
  float mt[3] = {}, ratio[3] = {1.f, 1.f, 1.f};
};
void matchColor(const ffcv::Image& target, ffcv::MatF& swapped, const ffcv::MatF& mask,
                float strength, ColorState* state);

// EDGE-AWARE mask refinement (a guided filter, He et al. 2010, guide = the target crop's
// brightness): the soft mask edge snaps to the real edges in the picture -- hair strands,
// the jaw line, a finger -- instead of a uniform blur across them. The result is only ever
// allowed to SHRINK the mask (min with the input), so hair and objects stay original and
// the swap can never leak onto them. radius in crop pixels.
void refineMaskEdges(const ffcv::Image& guide, ffcv::MatF& mask, int radius, float eps);

// SEAMLESS blend (multi-band / Laplacian pyramid, Burt & Adelson): [fg] (the swapped crop,
// BGR floats 0..255) takes [bg]'s (the original crop's) low frequencies outside the mask
// and its own inside, each frequency band blended over a width proportional to it. The
// edge between the two disappears in the large-scale shading while fine detail stays
// sharp. Writes the result into [fg]. W, H must be divisible by 2^(levels-1).
void seamlessBlend(const ffcv::Image& bg, ffcv::MatF& fg, const ffcv::MatF& mask, int levels);

// Re-map a mask made for one crop of the frame into another crop of the same frame.
// `fromAffine` and `toAffine` are the frame->crop affines of the two crops; pixels of the
// new crop that fall outside the old one get 0.
ffcv::MatF remapMask(const ffcv::MatF& mask, const ffcv::Affine& fromAffine,
                     const ffcv::Affine& toAffine, int w, int h);

// A tiny grey thumbnail (n x n, box-averaged) of a face crop, for "did anything change".
std::vector<uint8_t> thumbGray(const ffcv::Image& crop, int n);
// Two thumbnails of the same face look alike: small mean change AND no local change big
// enough to be something entering the face (a hand, food).
bool thumbSame(const std::vector<uint8_t>& a, const std::vector<uint8_t>& b);

// Eye openness from the 68 landmarks (eye aspect ratio, the smaller of the two eyes):
// about 0.25-0.35 open, under ~0.2 closing or closed.
float eyeOpenness(const float* landmark68);

// Mouth openness from the 68 landmarks: the gap between the inner lips (62-66) over the
// mouth width (48-54). About 0-0.03 closed, over ~0.05 opening. Returns 1 (open) when the
// landmarks are missing, so a caller that skips work on a closed mouth never skips blindly.
float mouthOpenness(const float* landmark68);

// Bilinear resize of a single-channel float mask.
ffcv::MatF resizeMask(const ffcv::MatF& src, int w, int h);

}  // namespace ffmotion
