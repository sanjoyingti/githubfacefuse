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

// Re-map a mask made for one crop of the frame into another crop of the same frame.
// `fromAffine` and `toAffine` are the frame->crop affines of the two crops; pixels of the
// new crop that fall outside the old one get 0.
ffcv::MatF remapMask(const ffcv::MatF& mask, const ffcv::Affine& fromAffine,
                     const ffcv::Affine& toAffine, int w, int h);

// Bilinear resize of a single-channel float mask.
ffcv::MatF resizeMask(const ffcv::MatF& src, int w, int h);

}  // namespace ffmotion
