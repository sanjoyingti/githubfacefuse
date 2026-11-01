#include "ffpipe.h"

#include "ffaudio.h"
#include "ffmotion.h"
#include "ffportrait.h"

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstring>
#include <mutex>

#include "ffnn.h"

// FFDEBUG=1 prints what each stage actually produced.  Cheap, and the alternative is
// guessing at a tensor layout from the host side.
#include <cstdio>
#include <cstdlib>
static bool ffdebug() { static bool v = getenv("FFDEBUG") != nullptr; return v; }

// FFNOMASKCACHE=1 forces the box-mask memo to miss on every frame, so ONE binary can
// measure cached against uncached by alternating runs inside a single thermal session --
// which is the only way an A/B on this device means anything (running one build first
// every time biases the other by ~20%, larger than most effects worth measuring).
static bool ffNoMaskCache() { static bool v = getenv("FFNOMASKCACHE") != nullptr; return v; }

// FFTRACK=N re-detects every N frames and reconstructs the box from the previous frame's
// landmarks in between, skipping yoloface AND its whole-frame letterbox prep. 0 = off,
// which is the shipping default and byte-for-byte the old behaviour.
static int ffTrackPeriod() {
  static const int v = [] { const char* e = getenv("FFTRACK"); return e ? atoi(e) : 0; }();
  return v;
}
// Tracking is abandoned well ABOVE cfg.landmarkerScore (0.5). At 0.5 the landmarker has
// already fallen back to landmark5 -- which, on a tracked frame, is the tracker's OWN
// previous output, so the loop would feed on itself and drift with nothing to correct it.
// Measured on the bench clip the score sits at 0.964-0.968, so 0.85 is far below anything
// a healthy track produces and far above the point where the fallback engages.
static const float kTrackMinScore = 0.85f;
// A head that moved more than this fraction of its own width since the last frame is
// re-detected on the next one rather than tracked.
static const float kTrackMaxStep = 0.12f;

namespace ffpipe {
namespace {

double nowMs() {
  using namespace std::chrono;
  return duration<double, std::milli>(steady_clock::now().time_since_epoch()).count();
}

// fan_68_5 is a 0.9 MB 5->68 landmark MLP.  run_reference keeps it on the CPU because it
// is negligible; here it runs on the NPU alongside the rest simply because it is already
// a graph and that avoids porting its weights separately.
struct Nets {
  ffnn::Handle det = nullptr, fan = nullptr, fan685 = nullptr, arc = nullptr, swap = nullptr;
  ffnn::Handle lip = nullptr;   // the lip syncer, optional exactly like the enhancer
  // WHICH lip syncer. The two are not variants of one graph -- they take different crops
  // at different sizes and a different number of inputs -- so syncLip branches on this
  // rather than on a size alone.
  bool lipIsEdtalk = false;
  ffnn::Handle nsfw = nullptr;
  // Optional, like fan685: absent simply means the enhancer cannot be offered.
  ffnn::Handle enh = nullptr;
  // The face editor (LivePortrait): optional as a SET -- all three, or the editor is off.
  ffnn::Handle lpFeat = nullptr, lpMotion = nullptr, lpGen = nullptr;
  // The mask models (Config::occlusionMask / regionMask). ncnn-only, opened through
  // ffnn::openAux on first use; `*Tried` makes a missing model cost one lookup, not one
  // per frame.
  ffnn::Handle occ = nullptr, parse = nullptr;
  bool occTried = false, parseTried = false;
};

// One clip's audio, reduced to what the lip syncer eats: a mel window per OUTPUT frame.
// Held here rather than handed across JNI per frame, for the same reason the source
// embedding is -- it is set once and read every frame.
struct AudioState {
  std::vector<ffaudio::MelWindow> windows;
  // create_empty_audio_frame through prepare_audio_frame: zeros become a uniform -4,
  // which is what the model reads as silence.
  std::vector<float> silence;
};

// content_analyser.py:create_static_model_set -- nsfw_2 is 384x384.
// ⚠ The normalisation is NOT the identity this comment claimed until 2026-08-30;
// checkContent carries it, and the reason the wrong one survived every check.
constexpr int kNsfwSize = 384;

// face_enhancer/core.py -- gpen_bfr_256 is 256x256 on the `arcface_128` template, the
// same template and size hyperswap_1a_256 declares.  NOT cfg.swapSize: inswapper is 128,
// and the enhancer graph does not change with the swapper.
constexpr int kEnhSize = 256;

/**
 * Run one loaded graph on synthetic input, purely to find out whether it runs.
 *
 * Shapes come from the MODEL, never from a table here: the app already knows every input
 * size in the code that does the real work, and a second copy in the prober would be wrong
 * the first time a conversion changed one -- silently, because a probe that feeds the
 * wrong size and fails looks exactly like a chip that cannot execute.
 *
 * 0.5 rather than 0: arcface L2-normalises, and a zero vector normalises to 0/0. Probing
 * with an input that can produce a legitimate NaN would make the prober's own verdict
 * indistinguishable from the fault it is looking for.
 *
 * ⚠ Only `execute` returning false is a failure. A non-finite output is REPORTED and
 * tolerated, because this runs on every device at every init and a probe that is stricter
 * than the pipeline could reject a tier that works -- turning a diagnostic into an outage
 * on hardware that was fine. The gate is the one exception, and ffpipe checks it
 * separately, because there a wrong number is the whole failure mode.
 */
bool probeExecutes(ffnn::Handle h, std::string* why) {
  std::vector<std::string> names = ffnn::inputNames(h);
  std::vector<std::vector<int>> shapes = ffnn::inputShapes(h);
  if (names.empty() || names.size() != shapes.size()) {
    *why = "no input metadata";
    return false;
  }
  std::vector<std::vector<float>> bufs(names.size());
  std::vector<const float*> ptrs;
  ptrs.reserve(names.size());
  for (size_t i = 0; i < names.size(); ++i) {
    size_t n = 1;
    for (int d : shapes[i]) n *= (size_t)(d > 0 ? d : 1);
    bufs[i].assign(n, 0.5f);
    ptrs.push_back(bufs[i].data());
  }
  std::vector<std::vector<float>> outs;
  if (!ffnn::execute(h, names, ptrs, outs)) {
    *why = ffnn::lastError();
    return false;
  }
  if (outs.empty() || outs[0].empty()) {
    *why = "executed but produced no output";
    return false;
  }
  for (const std::vector<float>& o : outs)
    for (float f : o)
      if (!std::isfinite(f)) { *why = "non-finite output"; return true; }
  return true;
}

}  // namespace

/**
 * "This face keeps its own." Not a slot index and never indexes anything -- every reader
 * tests for it before it reaches sourceSlots.
 *
 * ⚠ Negative, and that is safe HERE precisely because it is not a threshold: the gate's
 * sentinel rule (NaN, never a negative number) exists because scores are legitimately
 * negative, and a source INDEX never is.
 */
static constexpr int kNoSource = -1;

struct Pipeline::Impl {
  Nets n;
  AudioState audio;
  Config cfg;
  // The face editor's CPU half: its three keypoint MLPs, and the 29 MB hourglass input,
  // kept so a video does not allocate it per face per frame.
  ffportrait::Mlps lpMlps;
  std::vector<float> lpHg;
  // face_animator's still: the photo, its face's crop, features and motion, taken once; and
  // the driver's FIRST face, which every later frame's motion is measured against.
  struct Portrait {
    bool ready = false, haveFirst = false;
    ffcv::Image photo;
    ffcv::Affine am;
    ffcv::MatF mask;
    std::vector<float> fv;
    ffportrait::Motion motion, first;
  };
  Portrait portrait;
  float srcEmbedding[512]{};
  float srcEmbeddingNorm[512]{};
  bool haveSource = false;
  std::vector<std::array<float, 512>> sourceSlots;
  int activeSource = 0;
  // ONE remembered decision about ONE person: who they are, and what to do with them.
  //
  // ⚠ `keepOriginal` is a DECISION, not an absence of one. A person the user pointed at
  // and said "leave this face alone" must beat every fallback -- the frozen default slot,
  // an adoption on re-entry, the enhancer's second pass -- so the code that walks this
  // list must never treat the entry as "nothing to apply". `source` is kNoSource then,
  // and the two always agree; keepOriginal is what is TESTED, because a bare -1 is also
  // what an uninitialised index looks like.
  struct FaceAssignment {
    std::array<float, 512> embedding;
    int source = kNoSource;
    bool keepOriginal = false;
  };
  std::vector<FaceAssignment> faceAssignments;
  // One person currently in the live frame, matched frame to frame by box overlap
  // (embedding as a fallback). `pinned` means a tap decided this person's source ONCE;
  // the source is then STICKY -- swapAll never re-scores it against the per-frame
  // embedding, which is what made the old distance-per-frame matching flicker between
  // a face's own source and the active slot. Unpinned faces follow the active slot.
  struct TrackedFace {
    float box[4]{};
    float embeddingNorm[512]{};
    // kNoSource when the user assigned "keep the original face" -- one field, so a
    // tracked person and a remembered assignment cannot disagree about what was chosen.
    int source = 0;
    bool pinned = false;
    int missed = 0;   // consecutive frames without an association; drops when large
    int id = 0;       // stable identity across erases/reorders (see selectedId)
  };
  std::vector<TrackedFace> tracked;
  int nextTrackedId = 1;
  // The SELECTED person (assign mode): the last one tapped. They follow the source
  // chip until an empty tap deselects them. Stored by id, not index: tracked entries
  // are erased and reordered every frame, so an index would go stale; the id lookup
  // simply fails (deselects) when the person is no longer tracked.
  int selectedId = -1;
  // The per-face source decision for the CURRENT frame, filled by updateLiveTracking
  // and read by swapAll when assignEnabled. Same length as the faces vector it was
  // built for; swapAll falls back to the active slot when the lengths disagree (no
  // tracking ran for this frame).
  std::vector<int> frameSources;
  // Whether [frameSources] describes the frame about to be swapped. Set ONLY by
  // updateLiveTracking, cleared by everything that invalidates it.
  //
  // ⚠ This is what tells the two assign modes apart, and it is a stated fact rather than
  // an inferred one on purpose. The Swap screen assigns by IDENTITY (there is no tracker
  // -- its frames are not a sequence), Live assigns by TRACKING, and "the table happens
  // to be the same length as this frame's face list" is not the difference between them:
  // it is also true of a stale table, and true of both on a frame with no faces.
  bool frameSourcesValid = false;

  // ---- assignment bookkeeping. Defined out of line further down: they need
  // faceDistance(), which cannot be declared before this struct.
  //
  // ⚠ Members, not file-static helpers, because Pipeline::Impl is a private name and
  // nothing outside the class may spell it.
  void rememberAssignment(const float* embeddingNorm, int sourceIndex, bool keepOriginal);

  // ---- temporal state for Pipeline::setSequence
  struct SeqFace {
    float box[4] = {};
    ffmotion::OneEuro5 filt;
    float fade = 1.f;
    int miss = 0;
  };
  struct Sequence {
    // Written by setSequence from ANY thread (the UI thread stops the live player), read by
    // analyse on the pipeline thread. The face list itself is only touched by analyse: a
    // reset is REQUESTED here and carried out at the start of the next analyse, so the UI
    // thread never clears a vector the pipeline thread is iterating.
    std::atomic<bool> on{false};
    std::atomic<bool> resetPending{false};
    std::vector<SeqFace> faces;
    void reset() { faces.clear(); }
  };
  Sequence seq;
  // Match this frame's faces to the sequence, smooth their alignment and fade, and age out
  // faces that have left.
  void temporal(std::vector<Face>& faces);

  // ---- mask models
  // Lazily opens (and proves) a mask model. GPU first; a GPU that returns non-finite numbers
  // is dropped for the CPU, and a model that fails on both is left closed.
  ffnn::Handle maskNet(const char* name, int size, ffnn::Handle& h, bool& tried);
  // Shrinks `m` (CS x CS, already the box mask) by the occlusion and region masks computed
  // on `crop`, the TARGET face before any swap. Returns false only on an execution error.
  bool applyMaskModels(const ffcv::Image& crop, ffcv::MatF& m, std::string& err);
  bool wantsMaskModels() const {
    return cfg.occlusionMask || cfg.regionMask || cfg.keepMouth || cfg.keepLips;
  }
  // The combined per-face mask swapAll used on this frame, keyed by the face's alignment
  // points, so the enhancer (same template, same crop size) reuses it instead of running
  // the mask models a second time on an already-swapped face.
  struct CachedMask {
    float lm5[10];
    ffcv::MatF mask;
  };
  std::vector<CachedMask> maskCache;
  // The frame as it was BEFORE swapAll, for the expression restorer (which needs the
  // original face's expression). Only kept when the restorer will run.
  ffcv::Image preSwap;
  bool havePreSwap = false;
  const ffcv::MatF* cachedMask(const Face& f) const {
    for (const auto& c : maskCache)
      if (std::memcmp(c.lm5, f.landmark5_68, sizeof(c.lm5)) == 0) return &c.mask;
    return nullptr;
  }
  void applyToSelected(int sourceIndex, bool keepOriginal);
  int sourceForFace(const Face& f, size_t fi, size_t faceCount, float refDistance) const;
  // The source every UNPINNED face keeps while assign mode is on. Captured when the
  // mode is turned on, so flipping the chip afterwards changes nothing on the feed --
  // in assign mode the chip is a BRUSH: only tapping a face applies it. Without the
  // freeze, every untapped face switched source the moment the user changed the chip,
  // which is not what the mode is for.
  int assignDefaultSource = 0;
  // Live's per-person assignment switch. OFF is the default behaviour (active slot for
  // every face); ON lets a pinned face keep its own source, and untapped faces keep
  // [assignDefaultSource] until a tap pins them.
  bool assignEnabled = false;
  // The TARGET face to swap, when the user has pointed at one. Normalised, because that is
  // what upstream's distance is defined over. Not in Config -- see setReferenceFaceAt.
  float refEmbeddingNorm[512]{};
  bool haveReference = false;
  // The TARGET faces to lip-sync, picked independently with the lips button. Same
  // representation as the swap reference; read only by syncLip. Empty = sync all.
  // One entry per tapped person: tapping one again removes it.
  struct LipRef { float embeddingNorm[512]{}; float box[4]{}; };
  std::vector<LipRef> lipRefs;
  // The list is written from UI threads (tap, restore, clear) while a render reads it
  // in syncLip; a push_back that reallocates under that loop is a use-after-free.
  // Every access takes this, and syncLip reads a COPY taken under it.
  mutable std::mutex lipMu;
  static constexpr int kLipRefMax = 16;

  /**
   * A content check has RUN on this pipeline and passed -- roadmap 1a.
   *
   * The invariant: `swapAll` refuses unless this is set, and only `checkContent` can set
   * it -- by running the graph and scoring below `Config::nsfwThreshold`. A pipeline that
   * has not been checked does not swap. That is the direction a gate must fail.
   *
   * ⚠ Policy is still Kotlin's. The THRESHOLD in Config is a floor, not the policy: Kotlin
   * still owns the sampling rate, the 10%-of-frames video rule, the wording of a refusal
   * and the NaN-is-not-permission rule. This only declines to work unattested.
   *
   * ⚠ Describe the INVARIANT here, never the ways around it. This file is public, and a
   * comment that names an attack is the attack's documentation.
   *
   * ⚠ Scoped to the PIPELINE, not to an input. Every path gates its inputs before it swaps
   * (docs/gate.md lists all six), so one clearance per init matches how the app already
   * behaves -- but it does mean a cleared pipeline will swap a later frame that was not
   * itself checked. Binding it to a source/target identity is the stronger version and is
   * still roadmap 1a; this is the part that can be built and proven without one.
   */
  bool gateCleared = false;
  std::vector<float> emap;   // inswapper only: the 512x512 initializer

  // A box mask depends only on (size, cfg.maskBlur, cfg.maskPadding) -- constant across
  // every frame and every face of a run -- but createBoxMask's gaussianBlur at the default
  // 0.3 blur is a 79-tap separable pass in double precision, so rebuilding it per frame
  // cost 43.93 ms on the lip syncer's 512 canvas and 10.4 M MACs on the swapper's 256 crop.
  //
  // Memoised on the PARAMETERS rather than merely computed once, so a live maskBlur,
  // maskPadding or pixelBoost change through updateConfig still takes effect on the very
  // next frame. `size` is in the key because the swap path's crop is swapSize*pixelBoost
  // and pixel boost is one of the sliders.
  struct BoxMaskCache {
    ffcv::MatF m;
    int size = -1;
    float blur = -1.f;
    int padding[4] = {-1, -1, -1, -1};

    const ffcv::MatF& get(int size_, float blur_, const int padding_[4]) {
      if (ffNoMaskCache() || size != size_ || blur != blur_ ||
          std::memcmp(padding, padding_, sizeof(padding)) != 0) {
        m = ffcv::createBoxMask(size_, size_, blur_, padding_);
        size = size_;
        blur = blur_;
        std::memcpy(padding, padding_, sizeof(padding));
      }
      return m;
    }
  };
  BoxMaskCache lipBoxMask;    // at LS, for syncLip
  BoxMaskCache swapBoxMask;   // at swapSize*pixelBoost, for swapAll

  // Detector tracking state. SINGLE FACE ONLY, deliberately: tracking two faces needs
  // identity matching across frames, and a crossover that mis-assigns them swaps the wrong
  // face onto the wrong person -- much worse than paying for the detector. 0 faces or 2+
  // simply keeps detecting every frame.
  struct Track {
    bool valid = false;
    int since = 0;                            // frames since the last real detection
    float sw = 0, sh = 0, dcx = 0, dcy = 0;   // detector box <- landmark68 bbox
    float lm68[136]{};
    float lm5[10]{};
    float detScore = 0;
    // Per-frame motion of the landmark-box centre, used to PREDICT where the face is in the
    // next frame instead of looking where it was (fast motion), in pixels.
    float vx = 0, vy = 0;
    void reset() { valid = false; since = 0; vx = vy = 0; }
  };
  Track track;
  // <0 means "not set by the caller": fall back to FFTRACK so the headless CLI keeps its
  // env switch and the app never depends on one.
  int trackPeriodOverride = -1;
};

Pipeline::Pipeline() = default;

Pipeline::~Pipeline() {
  if (p_) {
    for (auto h : {p_->n.det, p_->n.fan, p_->n.fan685, p_->n.arc, p_->n.swap, p_->n.lip, p_->n.nsfw,
                   p_->n.enh, p_->n.occ, p_->n.parse})
      if (h) ffnn::release(h);
  }
}

bool Pipeline::init(const std::string& libDir, const std::string& skelDir,
                    const std::string& modelDir, const std::string& swapperName,
                    const Config& cfg) {
  p_.reset(new Impl());
  p_->cfg = cfg;

  // Which RUNTIME, before which model. Auto because the HTP cannot be probed before QNN is
  // started -- asking first and choosing after reports no-NPU on every device.
  ffnn::InitSpec spec;
  spec.libDir = libDir;
  spec.skelDir = skelDir;
  spec.modelDir = modelDir;
  if (!ffnn::init(ffnn::Backend::Auto, spec)) {
    err_ = std::string("backend init: ") + ffnn::lastError();
    return false;
  }
  // Which arch tier this chip needs, measured rather than assumed. Everything before
  // 2026-08-24 hard-coded _v79 here, which is exactly one phone; the chain falls back to
  // v68 whenever the probe cannot measure, so an unrecognised device still loads.
  //
  // Then resolve that against WHAT IS ACTUALLY ON DISK.  The best tier for a chip is not
  // always one we have published: a v81 part asks for v81 the moment the app knows the
  // arch exists, which is necessarily before the binaries are hosted.  Taking the first
  // tier whose detector is present turns that from a hard init failure into "keeps running
  // the tier it ran yesterday, upgrades itself the day the files land".
  //
  // The detector is the probe because it is mandatory and the smallest -- 3.8 MB. A tier
  // is never half-present: the downloader writes a `.part` and renames only after the
  // SHA256 matches, so yoloface existing means the rest of that tier does too.
  // Which arch tier this chip needs, measured rather than assumed, resolved against WHAT
  // IS ACTUALLY ON DISK. The best tier for a chip is not always one we have published: a
  // v81 part asks for v81 the moment the app knows the arch exists, which is necessarily
  // before the binaries are hosted.
  //
  // The detector is the probe because it is mandatory and the smallest -- 3.8 MB. A tier is
  // never half-present: the downloader writes a `.part` and renames only after the SHA256
  // matches, so yoloface existing means the rest of that tier does too.
  const std::vector<std::string> chain = ffnn::variantChain(ffnn::active());
  auto skipped = [&](const std::string& t) {
    return std::find(cfg.skipVariants.begin(), cfg.skipVariants.end(), t) !=
           cfg.skipVariants.end();
  };
  std::vector<std::string> candidates;
  for (const std::string& t : chain)
    if (ffnn::variantPresent(t) && !skipped(t)) candidates.push_back(t);
  // ⚠ The skip list loses to having nothing to run. It is a record of what failed HERE,
  // and a device that has rejected every tier it holds is better served by trying one and
  // reporting honestly than by refusing to start with "no tier" -- which would read, to
  // the user, as the app breaking itself over a note it wrote about their phone.
  if (candidates.empty())
    for (const std::string& t : chain)
      if (ffnn::variantPresent(t)) candidates.push_back(t);
  if (candidates.empty() && !chain.empty()) candidates.push_back(chain.front());
  if (candidates.empty()) { err_ = "no tier: the HTP probe returned nothing"; return false; }

  auto dropNets = [&]() {
    for (ffnn::Handle* h : {&p_->n.det, &p_->n.fan, &p_->n.fan685, &p_->n.arc, &p_->n.lip,
                            &p_->n.swap, &p_->n.nsfw, &p_->n.enh, &p_->n.lpFeat,
                            &p_->n.lpMotion, &p_->n.lpGen, &p_->n.occ, &p_->n.parse}) {
      if (*h) ffnn::release(*h);
      *h = nullptr;
    }
    p_->n.occTried = p_->n.parseTried = false;
    p_->lpMlps = ffportrait::Mlps();
    nsfwQuantised_ = false;
  };

  // One tier's worth of loading, plus the proof that it actually RUNS.
  auto tryTier = [&](const std::string& t) -> bool {
    tier_ = t;
    ffnn::useVariant(t);
    // PLACEMENT is a property of the MODEL, measured 2026-08-30 and not a preference:
    // the content gate and the enhancer must not run on a GPU. The gate because ncnn's
    // Vulkan moves its decision statistic toward ALLOWING -- the one direction a gate must
    // not err -- and the enhancer because it fails outright on every GPU backend tried.
    // On QNN this is a no-op, since everything runs on the HTP there either way.
    auto open = [&](const char* name,
                    ffnn::Placement place = ffnn::Placement::Default) -> ffnn::Handle {
      ffnn::Handle h = ffnn::open(name, place);
      if (!h) err_ = std::string("open ") + name + " (" + tier_ + "): " + ffnn::lastError();
      return h;
    };
    p_->n.det = open("yoloface");             if (!p_->n.det) return false;
    p_->n.fan = open("fan2d");                if (!p_->n.fan) return false;
    p_->n.arc = open("arcface");              if (!p_->n.arc) return false;
    p_->n.swap = open(swapperName.c_str());   if (!p_->n.swap) return false;
    p_->n.fan685 = open("fan685");   // optional; absent -> geometric fallback

    // The face enhancer. Optional in the strongest sense: a separate download, most
    // installs will not have it, and a missing file must never be an init failure.
    p_->n.enh = open("gpen", ffnn::Placement::Cpu);

    // The lip syncer. Same rule as the enhancer: a separate download, absent on every
    // install that has not asked for it, and never an init failure when missing.
    //
    // edtalk ONLY. wav2lip used to be opened as a fallback so an install that had it was
    // not silently downgraded to "no lip syncer" by an app update; it is gone now, and an
    // install with only wav2lip therefore reports no lip syncer and is offered edtalk in
    // Settings. That is a visible, recoverable state rather than a quiet one.
    //
    // The two were never interchangeable, which is why keeping both cost more than it
    // saved: wav2lip is an INPAINTER that warps the 68-point mouth box (~274x285 in the
    // 512 crop) down to 96 and draws the mouth back at ~3x upscale; edtalk is a full-face
    // 256 GENERATOR with no mouth box at all. Two geometries, two calibrations, one of
    // which shipped wrong once already.
    p_->n.lip = open("edtalk");
    p_->n.lipIsEdtalk = (p_->n.lip != nullptr);

    // The face editor: three graphs and a weights file, all or nothing. Opened with plain
    // ffnn::open, not `open`, so an install without it does not leave "open lp_feature"
    // in err_ for a later, unrelated failure to be reported as.
    p_->n.lpFeat = ffnn::open("lp_feature");
    p_->n.lpMotion = p_->n.lpFeat ? ffnn::open("lp_motion") : nullptr;
    p_->n.lpGen = p_->n.lpMotion ? ffnn::open("lp_gencut") : nullptr;
    editWhy_.clear();
    if (!p_->n.lpGen) {
      editWhy_ = "not installed for " + tier_;
    } else if (!p_->lpMlps.load(modelDir + "/lp_mlp_" + tier_ + ".bin", &editWhy_)) {
      // a set without its MLPs cannot edit; the graphs go too
    }

    // The content gate is MANDATORY, because it blocks. A gate that silently does not run
    // is worse than no gate: it reports "checked" to every caller above it.
    //
    // fp32 is the build that tracks the host, but it only finalizes on v79 -- below that
    // the GELU cannot be created in float, and v81 refuses it too (docs/traps.md #10), so
    // every other tier carries the quantised one.
    p_->n.nsfw = open("nsfw", ffnn::Placement::Cpu);
    if (!p_->n.nsfw) {
      // nsfwq2, not nsfwq: the quantised gate is calibrated for the input range this file
      // feeds it, and that range changed. See work/qnn/convert.sh.
      p_->n.nsfw = open("nsfwq2", ffnn::Placement::Cpu);
      nsfwQuantised_ = p_->n.nsfw != nullptr;
    }
    if (!p_->n.nsfw) {
      err_ = "no content gate: neither nsfw_" + tier_ + ".bin nor nsfwq2_" + tier_ +
             ".bin is in " + modelDir + " -- the gate blocks, so it cannot be skipped";
      return false;
    }

    // ⚠ LOADING IS NOT RUNNING. A context can load and then fail to execute -- reported
    // from an 8 Elite Gen 5 on 0.2.1, where every model loaded and the first execution
    // returned NaN, which surfaced to the user as "the content check could not run" with
    // no way back. Tier selection was by file presence alone, so there was no fallback
    // from a tier the chip would not run.
    //
    // So prove it, by running EVERY model once on synthetic input -- about 50 ms for the
    // whole set, once per init.
    //
    // ⚠ It used to prove only the gate, and that was not enough to act on. The gate is
    // mandatory and executes first, so it is where a broken tier surfaces -- but bf633ac
    // had already written down that this makes it the CANARY and not the culprit, and two
    // releases later nobody could still say whether a v81 part fails at the gate
    // specifically or at everything. Those have different answers: one is a 6.6 MB gate
    // from a lower tier, the other is a 310 MB tier download. The probe that cannot tell
    // them apart is the reason the question stayed open, so it now names every model.
    struct Probe { std::string name; ffnn::Handle h; };
    const Probe probes[] = {
        {"yoloface", p_->n.det},   {"fan2d", p_->n.fan},  {"arcface", p_->n.arc},
        {swapperName, p_->n.swap}, {"fan685", p_->n.fan685},
        {"edtalk", p_->n.lip},
        {"gpen", p_->n.enh},       {"gate", p_->n.nsfw},
    };
    std::string report;
    bool ran = true;
    for (const Probe& pr : probes) {
      // fan685 and gpen are optional and absent on most installs. Not loaded is not a
      // failure, and listing them as one would make every ordinary device look broken.
      if (!pr.h) continue;
      if (!report.empty()) report += ", ";
      report += pr.name;
      std::string why;
      if (probeExecutes(pr.h, &why)) {
        // "ok (non-finite output)" is a real state and it has to reach the report. It is
        // not fatal here, but it is exactly what an 8 Elite Gen 5 was described as doing
        // in 0.2.1, so a device that does it must not look identical to one that does not.
        report += why.empty() ? " ok" : " ok (" + why + ")";
      } else {
        report += " FAILED (" + why + ")";
        ran = false;
      }
    }
    if (!ran) {
      rejected_ = tier_;
      err_ = "tier " + tier_ + " loaded but does not execute: " + report;
      rejectedWhy_ = err_;
      return false;
    }

    // The face editor proves itself SEPARATELY, and a failure drops the editor rather
    // than the tier (see hasFaceEditor): the generator is the heaviest graph in the app,
    // the likeliest one for an older HTP to refuse, and the swap must not depend on it.
    if (p_->n.lpGen && p_->lpMlps.loaded()) {
      for (const Probe& pr : {Probe{"lp_feature", p_->n.lpFeat}, Probe{"lp_motion", p_->n.lpMotion},
                              Probe{"lp_gencut", p_->n.lpGen}}) {
        std::string why;
        if (!probeExecutes(pr.h, &why)) {
          editWhy_ = pr.name + " does not execute on " + tier_ + ": " + why;
          break;
        }
      }
    }
    if (!editWhy_.empty()) {
      for (ffnn::Handle* h : {&p_->n.lpFeat, &p_->n.lpMotion, &p_->n.lpGen}) {
        if (*h) ffnn::release(*h);
        *h = nullptr;
      }
      p_->lpMlps = ffportrait::Mlps();
    }

    // The gate a second time, through its REAL path. The sweep above proves the context
    // executes; this proves the thing the gate is actually asked for -- a finite decision
    // statistic out of checkContent's own preprocessing -- and it is the one model where
    // a plausible-but-wrong answer blocks or admits real content.
    ffcv::Image probe(64, 64, 3);
    std::fill(probe.data.begin(), probe.data.end(), (uint8_t)128);
    ContentVerdict v = checkContent(probe);
    if (!v.ok || !std::isfinite(v.score)) {
      rejected_ = tier_;
      err_ = "tier " + tier_ + " loaded but does not execute: " + report +
             ", gate verdict " + (v.ok ? std::string("not finite") : err_);
      rejectedWhy_ = err_;
      return false;
    }
    return true;
  };

  std::string firstErr;
  for (size_t i = 0; i < candidates.size(); ++i) {
    dropNets();
    if (tryTier(candidates[i])) {
      if (ffdebug() && candidates[i] != chain.front())
        fprintf(stderr, "[dbg] tier %s unusable, fell back to %s\n",
                chain.front().c_str(), tier_.c_str());
      return true;
    }
    if (i == 0) firstErr = err_;
  }
  dropNets();
  err_ = firstErr.empty() ? err_ : firstErr;
  return false;
}

bool Pipeline::hasEnhancer() const { return p_ && p_->n.enh != nullptr; }
bool Pipeline::hasFaceEditor() const {
  return p_ && p_->n.lpGen != nullptr && p_->lpMlps.loaded();
}
bool Pipeline::hasLipSyncer() const { return p_ && p_->n.lip != nullptr; }

bool Pipeline::setAudio(const int16_t* pcm, size_t frames, int channels, int inRate,
                        double fps) {
  if (!p_) return false;
  p_->audio.windows.clear();
  if (!pcm || frames == 0 || channels <= 0 || inRate <= 0 || fps <= 0.0) return false;

  // prepare_voice, in upstream's order: resample first, THEN mix and normalise. The mix
  // is linear and so is the resample, so the two commute, but the PEAK the normalise
  // divides by is measured after resampling and that does not commute -- doing it the
  // other way scales the whole signal differently.
  std::vector<float> wide((size_t)frames * channels);
  for (size_t i = 0; i < wide.size(); ++i) wide[i] = (float)pcm[i];

  std::vector<float> mono(frames);
  if (channels == 1) {
    mono.assign(wide.begin(), wide.end());
  } else {
    for (size_t i = 0; i < frames; ++i) {
      double acc = 0.0;
      for (int c = 0; c < channels; ++c) acc += wide[i * channels + c];
      mono[i] = (float)(acc / channels);
    }
  }
  std::vector<float> at16k = ffaudio::resampleToVoiceRate(mono.data(), mono.size(), inRate);
  if (at16k.empty()) return false;
  std::vector<float> prepared = ffaudio::prepareAudio(at16k.data(), at16k.size(), 1);

  ffaudio::Spectrogram spec = ffaudio::createSpectrogram(prepared);
  if (spec.columns > ffaudio::melColumnLimit()) {
    // Upstream's index array is int16 and wraps negative past here. Refusing is the only
    // honest option: reproducing the wrap would silently sync the wrong 6.8 minutes.
    err_ = "audio too long for the lip syncer (over 6.8 minutes)";
    return false;
  }
  p_->audio.windows = ffaudio::extractWindows(spec, fps);
  // Built here rather than lazily in melWindow(), which is const: a const method quietly
  // filling a cache is legal and is still a worse thing to read.
  p_->audio.silence.assign((size_t)ffaudio::kMelFilterTotal * ffaudio::kAudioStepSize,
                           -4.0f);
  return !p_->audio.windows.empty();
}

const float* Pipeline::melWindow(int frameIndex) const {
  if (!p_ || p_->audio.windows.empty()) return nullptr;
  if (frameIndex >= 0 && (size_t)frameIndex < p_->audio.windows.size()) {
    return p_->audio.windows[(size_t)frameIndex].data.data();
  }
  return p_->audio.silence.data();
}

int Pipeline::melWindowTotal() const {
  return p_ ? (int)p_->audio.windows.size() : 0;
}

const Config& Pipeline::config() const {
  static const Config kDefault;
  return p_ ? p_->cfg : kDefault;
}

void Pipeline::updateConfig(const Config& c) {
  if (!p_) return;
  Config& live = p_->cfg;
  // Named one by one rather than assigned wholesale. A `p_->cfg = c` would also overwrite
  // the swapper-derived geometry with whatever the caller happened to be carrying, and the
  // failure that produces is not a crash -- it is a swap that runs and looks wrong.
  live.detectorScore     = c.detectorScore;
  live.landmarkerScore   = c.landmarkerScore;
  live.nmsThreshold      = c.nmsThreshold;
  live.maskBlur          = c.maskBlur;
  for (int i = 0; i < 4; ++i) live.maskPadding[i] = c.maskPadding[i];
  live.swapperWeight     = c.swapperWeight;
  live.pixelBoost        = c.pixelBoost;
  live.swapLargestOnly   = c.swapLargestOnly;
  live.referenceDistance = c.referenceDistance;
  live.faceEnhance       = c.faceEnhance;
  live.faceEnhancerBlend = c.faceEnhancerBlend;
  live.lipSyncWeight     = c.lipSyncWeight;
  live.faceEdit          = c.faceEdit;
  for (int i = 0; i < 14; ++i) live.faceEditor[i] = c.faceEditor[i];
  live.occlusionMask     = c.occlusionMask;
  live.regionMask        = c.regionMask;
  live.keepMouth         = c.keepMouth;
  live.keepLips          = c.keepLips;
  live.colorMatch        = c.colorMatch;
  live.expressionRestore = c.expressionRestore;
  live.expressionRestoreFactor = c.expressionRestoreFactor;
  live.poseFadeStart     = c.poseFadeStart;
  live.motionSmooth      = c.motionSmooth;
  live.lowScoreRecovery  = c.lowScoreRecovery;
  live.detectRotated     = c.detectRotated;
}

// ------------------------------------------------------------ content gate

ContentVerdict Pipeline::checkContent(const ffcv::Image& frame) {
  ContentVerdict v;
  if (!p_ || !p_->n.nsfw) { err_ = "content gate not loaded"; return v; }

  // vision.py:fit_contain_frame -- scale to FIT, then pad CENTRED.
  //
  // ⚠ This is NOT the detector's letterbox.  analyse() scales and pads into the top-left
  // corner; padding centred instead moves every pixel and with it the score.  Reusing the
  // detector's input path here would be silently wrong.
  const int S = kNsfwSize;
  double scale = std::min((double)S / frame.h, (double)S / frame.w);
  int nw = (int)(frame.w * scale), nh = (int)(frame.h * scale);
  int x0 = std::max(0, (S - nw) / 2), y0 = std::max(0, (S - nh) / 2);
  ffcv::Image temp = ffcv::resizeLinear(frame, nw, nh);

  // content_analyser.py:prepare_detect_frame -- BGR -> RGB, /255, then mean 0.5 / std 0.5.
  //
  // ⚠ mean 0.5 and std 0.5, i.e. [0,1] -> [-1,1].  This read `/ 255.0f` alone until
  // 2026-08-30 and handed the model [0,1], which is not the range facefusion 3.8.2 feeds
  // it.  nsfw_reference.py carried the identical mistake, so every device-vs-host
  // comparison agreed and none of them was evidence about upstream.  The decision
  // statistic moves by -1.15 on average against a 0.25 threshold, so this was not a
  // rounding matter -- the gate was judging on a distribution the model never saw.
  //
  // The zero-padded border is left at the pad value the model expects for "no pixel",
  // which after this normalisation is -1, not 0 -- so the buffer is initialised to -1.f.
  std::vector<float> in((size_t)3 * S * S, -1.f);
  for (int y = 0; y < nh; ++y) {
    const uint8_t* row = temp.row(y);
    for (int x = 0; x < nw; ++x)
      for (int c = 0; c < 3; ++c)
        in[(size_t)c * S * S + (size_t)(y + y0) * S + (x + x0)] =
            row[x * 3 + (2 - c)] / 127.5f - 1.0f;   // (2 - c): the [:, :, ::-1] flip
  }

  std::vector<std::vector<float>> out;
  if (!ffnn::execute(p_->n.nsfw, {"input"}, {in.data()}, out)) {
    err_ = std::string("content gate: ") + ffnn::lastError();
    return v;
  }
  if (out.empty() || out[0].size() < 2) {
    err_ = "content gate: expected 2 logits, got " +
           std::to_string(out.empty() ? 0 : out[0].size());
    return v;
  }
  v.ok = true;
  v.score = out[0][0] - out[0][1];
  v.blocked = v.score > p_->cfg.nsfwThreshold;
  // THE ONLY PLACE A PIPELINE BECOMES ABLE TO SWAP. Measured, and under the threshold --
  // a graph that failed to run leaves v.ok false and clears nothing, so a broken checker
  // refuses rather than permits, exactly as the NaN rule does one layer up.
  if (v.ok && !v.blocked) p_->gateCleared = true;
  return v;
}

// ---------------------------------------------------------------- detection

std::vector<Face> Pipeline::analyse(const ffcv::Image& frame, bool boxesOnly,
                                    bool noTrack) {
  std::vector<Face> faces;
  const Config& cfg = p_->cfg;
  const int S = cfg.detectorSize;

  // These are filled EITHER by the detector below, or -- when tracking is on and still
  // valid -- reconstructed from the previous frame's landmarks, which skips yoloface and
  // its whole-frame letterbox together (detector 6.1 + detprep 6.0 ms/frame measured).
  std::vector<std::array<float, 4>> boxes;
  std::vector<float> scores;
  std::vector<std::array<float, 10>> lms;
  std::vector<int> keep;

  // Declared out here because the per-face loop below reuses it, and the detector block
  // that used to declare it is now conditional.
  double t0 = 0;

  auto& tr = p_->track;
  if (p_->seq.resetPending.exchange(false)) p_->seq.reset();
  const int trackPeriod =
      p_->trackPeriodOverride >= 0 ? p_->trackPeriodOverride : ffTrackPeriod();
  // ⚠ boxesOnly never tracks: reconstructing the box from the PREVIOUS frame is
  // meaningless for a UI question about one frame the user is looking at, and it would
  // answer with a box the detector never found.
  // ⚠ noTrack never tracks either, and also never UPDATES the tracker below: a source
  // image is a different face at a different scale, and carrying its geometry into the
  // next analysis would crop it wrong -- which is exactly the deformed-swap bug this
  // flag exists to stop (a 3rd+ source photo analysed through the 2nd one's tracker box).
  const bool useTrack = !boxesOnly && !noTrack && trackPeriod > 0 && tr.valid &&
                        tr.since < trackPeriod;

  if (useTrack) {
    // The landmarker still runs, every frame, on the reconstructed box. ONLY the search
    // box is inherited -- the alignment itself is recomputed from the current frame, so
    // the swap cannot lag the face. Skipping the landmarker too would save another ~4 ms
    // and produce exactly the sliding-mask artefact this design exists to avoid.
    float bx0 = 1e9f, by0 = 1e9f, bx1 = -1e9f, by1 = -1e9f;
    for (int k = 0; k < 68; ++k) {
      const float X = tr.lm68[2 * k], Y = tr.lm68[2 * k + 1];
      if (X < bx0) bx0 = X;  if (X > bx1) bx1 = X;
      if (Y < by0) by0 = Y;  if (Y > by1) by1 = Y;
    }
    const float lw = bx1 - bx0, lh = by1 - by0;
    const float bw = tr.sw * lw, bh = tr.sh * lh;
    const float cx = (bx0 + bx1) * 0.5f + tr.dcx * lw + tr.vx;
    const float cy = (by0 + by1) * 0.5f + tr.dcy * lh + tr.vy;
    boxes.push_back({cx - bw * 0.5f, cy - bh * 0.5f, cx + bw * 0.5f, cy + bh * 0.5f});
    scores.push_back(tr.detScore);
    std::array<float, 10> l{};
    std::memcpy(l.data(), tr.lm5, sizeof(tr.lm5));
    lms.push_back(l);
    keep.push_back(0);
  } else {
  // --face-detector-angles: upright first; the rotated passes only run when it found
  // nothing, so a frame with a face never pays for them.
  static const int kAngles[4] = {0, 90, 270, 180};
  const int nAngles = cfg.detectRotated ? 4 : 1;
  const bool recover = cfg.lowScoreRecovery && p_->seq.on && !noTrack && !boxesOnly &&
                       !p_->seq.faces.empty();
  const float detThr = recover ? std::min(cfg.detectorScore,
                                          std::max(0.2f, cfg.detectorScore - 0.25f))
                               : cfg.detectorScore;
  for (int ai = 0; ai < nAngles; ++ai) {
  const int angle = kAngles[ai];
  ffcv::Image rotated;
  if (angle != 0) rotated = ffmotion::rotateImage(frame, angle);
  const ffcv::Image& dimg = angle != 0 ? rotated : frame;
  boxes.clear(); scores.clear(); lms.clear(); keep.clear();

  t0 = nowMs();
  // restrict_frame + zero-pad to SxS  (vision.py:222, face_detector.py:445)
  double scale = 1.0;
  if (dimg.h > S || dimg.w > S)
    scale = std::min((double)S / dimg.h, (double)S / dimg.w);
  int tw = (int)(dimg.w * scale), th = (int)(dimg.h * scale);
  if (scale >= 1.0) { tw = dimg.w; th = dimg.h; }
  double ratioW = (double)dimg.w / tw, ratioH = (double)dimg.h / th;

  std::vector<float> in((size_t)3 * S * S, 0.f);   // CHW, /255, zero-padded
  // Fused resize-and-planarise. The two-step version this replaced -- resizeLinear into an
  // intermediate Image, then a scalar transpose out of it -- was 4.3 ms/frame of the
  // geometry budget and its A/B switch is gone as of 0.6.1; see resizeToCHW's header note
  // for why the fused one is bit-identical rather than merely close.
  ffcv::resizeToCHW(dimg, tw, th, S, in.data());
  msGeom += nowMs() - t0;
  msGeomDetPrep += nowMs() - t0;

  t0 = nowMs();
  std::vector<std::vector<float>> out;
  if (!ffnn::execute(p_->n.det, {"input"}, {in.data()}, out)) {
    err_ = std::string("detector: ") + ffnn::lastError();
    return faces;
  }
  msDetect += nowMs() - t0;

  if (ffdebug()) {
    auto sh = ffnn::outputShapes(p_->n.det);
    fprintf(stderr, "[dbg] detector out elems=%zu shape=", out[0].size());
    for (int v : sh[0]) fprintf(stderr, "%d,", v);
    float mx = -1e9f, mn = 1e9f;
    for (float v : out[0]) { if (v > mx) mx = v; if (v < mn) mn = v; }
    fprintf(stderr, "  range [%.4f, %.4f]\n", mn, mx);
    // score channel under both plausible orderings of a rank-3 [1,20,8400] tensor
    float bestC = -1e9f, bestI = -1e9f;
    for (int i = 0; i < 8400; ++i) {
      bestC = std::max(bestC, out[0][(size_t)4 * 8400 + i]);   // [20,8400]
      bestI = std::max(bestI, out[0][(size_t)i * 20 + 4]);     // [8400,20]
    }
    fprintf(stderr, "[dbg] best score as [20,8400]=%.4f   as [8400,20]=%.4f\n", bestC, bestI);
    fprintf(stderr, "[dbg] frame %dx%d temp %dx%d ratio %.3f/%.3f\n",
            dimg.w, dimg.h, tw, th, ratioW, ratioH);
  }

  // [1,20,8400] -> per-anchor (cx,cy,w,h, score, 5x(x,y,vis))
  t0 = nowMs();
  const int A = 8400;
  const float* d = out[0].data();
  for (int i = 0; i < A; ++i) {
    float sc = d[4 * A + i];
    if (sc <= detThr) continue;
    float cx = d[0 * A + i], cy = d[1 * A + i], w = d[2 * A + i], h = d[3 * A + i];
    // ---- A DETECTOR THAT RETURNED NOISE MUST NOT REACH THE GEOMETRY ----
    //
    // Everything downstream -- the 5->68 lift, the affine crop, the paste back -- takes
    // these numbers as pixel coordinates and turns them into offsets. A NaN reaching an
    // `(int)` cast is undefined and in practice becomes a very large or negative index; a
    // box a million pixels wide produces an ROI nothing clamps to anything sane. That is a
    // heap write out of a face detection, and it will not present as "the detector was
    // wrong": it presents as an unrelated crash later in the frame.
    //
    // Reported from the field on a non-Qualcomm phone whose Vulkan computes this graph
    // wrongly -- "it detects a lot and none of them is a face" -- followed by a swap that
    // died inside MediaCodec. The GPU is now checked before it is used (ffnn_ncnn.cpp,
    // verifyGpu), but that check is a heuristic and this is the floor underneath it: NO
    // backend gets to hand this loop a number that is not a coordinate.
    //
    // Deliberately generous. The detector works in its own SxS letterbox, so a face's
    // centre is inside it and its box is no bigger than it -- a face running off the edge
    // of the frame still satisfies both. This throws away nonsense, not faces.
    if (!std::isfinite(sc) || !std::isfinite(cx) || !std::isfinite(cy) ||
        !std::isfinite(w) || !std::isfinite(h)) continue;
    if (!(w > 1.0f && h > 1.0f && w <= (float)S && h <= (float)S)) continue;
    if (cx < 0.0f || cy < 0.0f || cx > (float)S || cy > (float)S) continue;
    std::array<float, 10> l{};
    bool lmOk = true;
    for (int k = 0; k < 5; ++k) {
      float lx = d[(5 + 3 * k + 0) * A + i], ly = d[(5 + 3 * k + 1) * A + i];
      if (!std::isfinite(lx) || !std::isfinite(ly)) { lmOk = false; break; }
      l[2 * k] = (float)(lx * ratioW);
      l[2 * k + 1] = (float)(ly * ratioH);
    }
    // The landmarks are pushed WITH the box or not at all: `keep` indexes all three vectors
    // and a box without its five points would shift every later face's landmarks onto the
    // wrong rectangle.
    if (!lmOk) continue;
    // Back to UPRIGHT frame coordinates when this pass ran on a rotated copy.
    float bx0r = (float)((cx - w / 2) * ratioW), by0r = (float)((cy - h / 2) * ratioH);
    float bx1r = (float)((cx + w / 2) * ratioW), by1r = (float)((cy + h / 2) * ratioH);
    std::array<float, 4> bb{bx0r, by0r, bx1r, by1r};
    if (angle != 0) {
      float ax, ay, bx, by;
      ffmotion::unrotatePoint(angle, frame.w, frame.h, bx0r, by0r, &ax, &ay);
      ffmotion::unrotatePoint(angle, frame.w, frame.h, bx1r, by1r, &bx, &by);
      bb = {std::min(ax, bx), std::min(ay, by), std::max(ax, bx), std::max(ay, by)};
      for (int k = 0; k < 5; ++k) {
        float px, py;
        ffmotion::unrotatePoint(angle, frame.w, frame.h, l[2 * k], l[2 * k + 1], &px, &py);
        l[2 * k] = px; l[2 * k + 1] = py;
      }
    }
    // LOW-SCORE RECOVERY: under the user's threshold only when it overlaps a face the
    // sequence saw in the last few frames -- motion blur, not a new false positive.
    if (sc <= cfg.detectorScore) {
      bool near = false;
      for (const auto& sf : p_->seq.faces)
        if (sf.miss <= 3 && ffmotion::iou(bb.data(), sf.box) >= 0.3f) { near = true; break; }
      if (!near) continue;
    }
    boxes.push_back(bb);
    scores.push_back(sc);
    lms.push_back(l);
  }
  keep = ffcv::nmsBoxes(boxes, scores, detThr, cfg.nmsThreshold);
  msGeom += nowMs() - t0;
  if (!keep.empty()) break;
  }  // angles
  }  // end of the real-detection path

  for (int idx : keep) {
    Face f{};
    std::memcpy(f.landmark5, lms[idx].data(), sizeof(f.landmark5));
    for (int i = 0; i < 4; ++i) f.box[i] = boxes[idx][i];
    f.detScore = scores[idx];

    // BOXES ONLY: what the detector found, and nothing after it.
    //
    // The rest of this loop is 5->68, the landmarker (2.55 ms/face) and the recogniser
    // (1.00 ms/face) -- all of it identity and alignment work, none of it needed to draw a
    // rectangle. `continue` also steps over the tracker update at the bottom of the loop,
    // which is the other half of why this is safe to call from the UI: a question about
    // one frame must not move state a video run depends on.
    if (boxesOnly) { faces.push_back(f); continue; }

    // ---- 5 -> 68, then the snapped face angle
    t0 = nowMs();
    float lm68_5[136];
    if (p_->n.fan685) {
      std::vector<std::vector<float>> o5;
      if (ffnn::execute(p_->n.fan685, {"input"}, {f.landmark5}, o5) && o5[0].size() >= 136)
        std::memcpy(lm68_5, o5[0].data(), sizeof(lm68_5));
      else
        std::memset(lm68_5, 0, sizeof(lm68_5));
    } else {
      // Without fan_68_5 only the angle is needed, and estimate_face_angle reads points
      // 0 and 16 -- the outer jaw corners, which track the eye axis. The eye centres give
      // the same snapped result for every non-rotated face.
      std::memset(lm68_5, 0, sizeof(lm68_5));
      lm68_5[0] = f.landmark5[0]; lm68_5[1] = f.landmark5[1];
      lm68_5[32] = f.landmark5[2]; lm68_5[33] = f.landmark5[3];
    }
    int angle = ffcv::estimateFaceAngle(lm68_5);
    msGeom += nowMs() - t0;

    // ---- landmarker: warp to 256, run 2dfan4, soft-argmax back
    t0 = nowMs();
    const int MS = 256;
    float bw = f.box[2] - f.box[0], bh = f.box[3] - f.box[1];
    float sc2 = 195.0f / std::max(1.0f, std::max(bw, bh));
    float tx = (MS - (f.box[0] + f.box[2]) * sc2) * 0.5f;
    float ty = (MS - (f.box[1] + f.box[3]) * sc2) * 0.5f;
    ffcv::Affine aff;
    aff(0, 0) = sc2; aff(0, 1) = 0; aff(0, 2) = tx;
    aff(1, 0) = 0; aff(1, 1) = sc2; aff(1, 2) = ty;
    ffcv::Image crop = ffcv::warpAffine(frame, aff, MS, MS, ffcv::BORDER_CONSTANT);

    ffcv::Affine rot = ffcv::getRotationMatrix2D(MS / 2.0, MS / 2.0, angle, 1.0);
    int rw = MS, rh = MS;
    if (angle % 180 != 0) { rw = MS; rh = MS; }   // square crop: rotation size is unchanged
    if (angle != 0) crop = ffcv::warpAffine(crop, rot, rw, rh, ffcv::BORDER_CONSTANT);
    msGeomWarp += nowMs() - t0;

    double tt = nowMs();
    std::vector<float> fin((size_t)3 * MS * MS);
    for (int y = 0; y < MS; ++y) {
      const uint8_t* row = crop.row(y);
      for (int x = 0; x < MS; ++x)
        for (int c = 0; c < 3; ++c)
          fin[(size_t)c * MS * MS + (size_t)y * MS + x] = row[x * 3 + c] / 255.0f;
    }
    msGeomTensor += nowMs() - tt;
    msGeom += nowMs() - t0;

    t0 = nowMs();
    std::vector<std::vector<float>> hm;
    if (!ffnn::execute(p_->n.fan, {"input"}, {fin.data()}, hm)) {
      err_ = std::string("landmarker: ") + ffnn::lastError();
      return faces;
    }
    msLandmark += nowMs() - t0;

    t0 = nowMs();
    float xy[136], peak[68];
    ffcv::decodeHeatmaps(hm[0].data(), 68, 64, 64, xy, peak);
    for (int k = 0; k < 68; ++k) { xy[2 * k] = xy[2 * k] / 64.f * MS; xy[2 * k + 1] = xy[2 * k + 1] / 64.f * MS; }
    if (angle != 0) {
      ffcv::Affine ir = ffcv::invertAffine(rot);
      float tmp[136]; ffcv::transformPoints(xy, 68, ir, tmp); std::memcpy(xy, tmp, sizeof(xy));
    }
    ffcv::Affine ia = ffcv::invertAffine(aff);
    ffcv::transformPoints(xy, 68, ia, f.landmark68);

    double meanPeak = 0;
    for (int k = 0; k < 68; ++k) meanPeak += peak[k];
    meanPeak /= 68.0;
    float score68 = (float)std::min(1.0, std::max(0.0, meanPeak / 0.9));  // numpy.interp
    f.lmScore = score68;
    if (score68 > cfg.landmarkerScore)
      ffcv::toLandmark5(f.landmark68, f.landmark5_68);
    else
      std::memcpy(f.landmark5_68, f.landmark5, sizeof(f.landmark5_68));

    // FFTRACKDBG reports what a tracked box would have to reproduce. The landmarker crops
    // at 195/max(bw,bh), so a synthesized box that is systematically larger or smaller than
    // the detector's would rescale every crop and shift every landmark -- the mapping from
    // the 68 points BACK to a detector-shaped box has to be measured, not guessed.
    if (getenv("FFTRACKDBG")) {
      float bx0 = 1e9f, by0 = 1e9f, bx1 = -1e9f, by1 = -1e9f;
      for (int k = 0; k < 68; ++k) {
        const float X = f.landmark68[2 * k], Y = f.landmark68[2 * k + 1];
        if (X < bx0) bx0 = X;  if (X > bx1) bx1 = X;
        if (Y < by0) by0 = Y;  if (Y > by1) by1 = Y;
      }
      const float lw = bx1 - bx0, lh = by1 - by0;
      fprintf(stderr,
              "[track] det %.1f,%.1f %.0fx%.0f | lm68 %.1f,%.1f %.0fx%.0f | "
              "sw %.4f sh %.4f | dcx %.4f dcy %.4f | s68 %.3f det %.3f" "\n",
              f.box[0], f.box[1], f.box[2] - f.box[0], f.box[3] - f.box[1],
              bx0, by0, lw, lh,
              (f.box[2] - f.box[0]) / lw, (f.box[3] - f.box[1]) / lh,
              ((f.box[0] + f.box[2]) * 0.5f - (bx0 + bx1) * 0.5f) / lw,
              ((f.box[1] + f.box[3]) * 0.5f - (by0 + by1) * 0.5f) / lh,
              score68, f.detScore);
    }

    // ---- recogniser: warp to 112 on arcface_112_v2, BGR->RGB, /127.5-1
    const int RS = 112;
    float tmpl[10];
    const float* T = ffcv::warpTemplate(0);
    for (int i = 0; i < 10; ++i) tmpl[i] = T[i] * RS;
    ffcv::Affine am = ffcv::umeyama(f.landmark5_68, tmpl, 5);
    double tw2 = nowMs();
    ffcv::Image rc = ffcv::warpAffine(frame, am, RS, RS, ffcv::BORDER_REPLICATE);
    msGeomWarp += nowMs() - tw2;
    tw2 = nowMs();
    std::vector<float> rin((size_t)3 * RS * RS);
    for (int y = 0; y < RS; ++y) {
      const uint8_t* row = rc.row(y);
      for (int x = 0; x < RS; ++x)
        for (int c = 0; c < 3; ++c)     // BGR -> RGB is the [:, :, ::-1]
          rin[(size_t)(2 - c) * RS * RS + (size_t)y * RS + x] = row[x * 3 + c] / 127.5f - 1.0f;
    }
    msGeomTensor += nowMs() - tw2;
    msGeom += nowMs() - t0;

    t0 = nowMs();
    std::vector<std::vector<float>> emb;
    if (!ffnn::execute(p_->n.arc, {"input"}, {rin.data()}, emb)) {
      err_ = std::string("recogniser: ") + ffnn::lastError();
      return faces;
    }
    msRecognise += nowMs() - t0;

    std::memcpy(f.embedding, emb[0].data(), sizeof(f.embedding));
    double nrm = 0;
    for (int i = 0; i < 512; ++i) nrm += (double)f.embedding[i] * f.embedding[i];
    nrm = std::sqrt(nrm);
    for (int i = 0; i < 512; ++i) f.embeddingNorm[i] = (float)(f.embedding[i] / nrm);

    faces.push_back(f);
    ++facesDone;
  }

  // Pose fade and the temporal pass. A source image (noTrack) and a boxes-only question
  // never touch the sequence state.
  if (!boxesOnly) {
    for (Face& f : faces) f.poseFade = ffmotion::poseFade(f.landmark5_68, cfg.poseFadeStart);
    if (p_->seq.on && !noTrack) p_->temporal(faces);
  }

  // !noTrack: a source image's analysis must not leave tracker state behind for the
  // next caller. setSource/addSource call with noTrack=true and rely on this half.
  if (trackPeriod > 0 && !noTrack) {
    // Exactly one face, and the landmarker still confident: keep tracking. Anything else
    // -- no face, a second face, a low score -- drops back to detecting every frame.
    if (faces.size() == 1 && faces[0].lmScore >= kTrackMinScore) {
      const Face& f = faces[0];
      float bx0 = 1e9f, by0 = 1e9f, bx1 = -1e9f, by1 = -1e9f;
      for (int k = 0; k < 68; ++k) {
        const float X = f.landmark68[2 * k], Y = f.landmark68[2 * k + 1];
        if (X < bx0) bx0 = X;  if (X > bx1) bx1 = X;
        if (Y < by0) by0 = Y;  if (Y > by1) by1 = Y;
      }
      const float lw = bx1 - bx0, lh = by1 - by0;
      if (lw > 1.f && lh > 1.f) {
        if (!useTrack) {
          // Only a REAL detection may (re)learn the mapping -- relearning it from a
          // reconstructed box would just re-derive the constants it was built from and
          // launder drift into the model. Measured across a clip it holds to about 1%
          // (sw 0.932-0.940, sh 1.240-1.269), but that is one face at one distance, not
          // a constant of the detector, so it is relearned at every detection.
          tr.sw  = (f.box[2] - f.box[0]) / lw;
          tr.sh  = (f.box[3] - f.box[1]) / lh;
          tr.dcx = ((f.box[0] + f.box[2]) * 0.5f - (bx0 + bx1) * 0.5f) / lw;
          tr.dcy = ((f.box[1] + f.box[3]) * 0.5f - (by0 + by1) * 0.5f) / lh;
          tr.detScore = f.detScore;
          tr.since = 0;
        } else {
          ++tr.since;
        }
        // FAST MOTION: remember the step for the next frame's prediction, and when the head
        // moved more than kTrackMaxStep of its width in one frame, detect for real next
        // frame -- a reconstructed box that lags a fast head crops the landmarker off-face.
        if (tr.valid) {
          float px0 = 1e9f, py0 = 1e9f, px1 = -1e9f, py1 = -1e9f;
          for (int k = 0; k < 68; ++k) {
            const float X = tr.lm68[2 * k], Y = tr.lm68[2 * k + 1];
            if (X < px0) px0 = X;  if (X > px1) px1 = X;
            if (Y < py0) py0 = Y;  if (Y > py1) py1 = Y;
          }
          tr.vx = (bx0 + bx1) * 0.5f - (px0 + px1) * 0.5f;
          tr.vy = (by0 + by1) * 0.5f - (py0 + py1) * 0.5f;
          if (std::sqrt(tr.vx * tr.vx + tr.vy * tr.vy) > kTrackMaxStep * lw)
            tr.since = trackPeriod;
        } else {
          tr.vx = tr.vy = 0;
        }
        std::memcpy(tr.lm68, f.landmark68, sizeof(tr.lm68));
        std::memcpy(tr.lm5, f.landmark5_68, sizeof(tr.lm5));
        tr.valid = true;
      } else {
        tr.reset();
      }
    } else {
      tr.reset();
    }
  }

  // Not a processed frame: boxesOnly answers a UI question and must not appear in the
  // stats a run reports.
  if (!boxesOnly) ++framesDone;
  return faces;
}

void Pipeline::setSequence(bool on) {
  if (!p_) return;
  p_->seq.on = on;
  p_->seq.resetPending = true;
}

bool Pipeline::hasOcclusionModel() const { return p_ && p_->n.occ != nullptr; }
bool Pipeline::hasParserModel() const { return p_ && p_->n.parse != nullptr; }

void Pipeline::Impl::temporal(std::vector<Face>& faces) {
  // Greedy IoU matching against the faces of the previous frames.
  std::vector<bool> used(seq.faces.size(), false);
  std::vector<SeqFace> next;
  for (Face& f : faces) {
    int best = -1;
    float bestIou = 0.3f;
    for (size_t i = 0; i < seq.faces.size(); ++i) {
      if (used[i]) continue;
      const float v = ffmotion::iou(f.box, seq.faces[i].box);
      if (v >= bestIou) { bestIou = v; best = (int)i; }
    }
    SeqFace sf;
    if (best >= 0) { used[(size_t)best] = true; sf = seq.faces[(size_t)best]; }
    else sf.fade = f.poseFade;   // a new face starts at its own fade, not at 1
    if (cfg.motionSmooth) sf.filt.apply(f.landmark5_68);
    else sf.filt.reset();
    // The fade follows a turning head over ~3 frames rather than flickering with landmark
    // noise near the threshold.
    sf.fade += 0.35f * (f.poseFade - sf.fade);
    f.poseFade = sf.fade;
    std::memcpy(sf.box, f.box, sizeof(sf.box));
    sf.miss = 0;
    next.push_back(sf);
  }
  // Faces not seen this frame are kept for a few frames, so a blurred frame in the middle
  // of fast motion can still be recovered (Config::lowScoreRecovery).
  for (size_t i = 0; i < seq.faces.size(); ++i) {
    if (used[i]) continue;
    SeqFace sf = seq.faces[i];
    if (++sf.miss <= 5) { sf.filt.reset(); next.push_back(sf); }
  }
  seq.faces.swap(next);
}

void Pipeline::setTrackPeriod(int frames) {
  p_->trackPeriodOverride = frames < 0 ? 0 : frames;
  // A period change invalidates whatever was being tracked: the caller is starting or
  // ending a sequential run, so "the previous frame" is not this run's previous frame.
  p_->track.reset();
}

bool Pipeline::setSource(const ffcv::Image& img) {
  err_.clear();
  // noTrack: a source photo must neither use nor seed the tracker. It is a different
  // image of a different face at a different scale, and its analysis is the "previous
  // frame" nothing may be reconstructed from.
  auto faces = analyse(img, /*boxesOnly=*/false, /*noTrack=*/true);
  if (faces.empty()) {
    // Do NOT overwrite a real failure from analyse() -- a graph that failed to execute
    // and a frame with genuinely no face both arrive here as an empty vector, and
    // reporting the second when it was the first sends the next hour in the wrong place.
    if (err_.empty()) err_ = "no face detected in source image";
    return false;
  }
  const Face* best = &faces[0];
  float bestArea = 0;
  for (const auto& f : faces) {
    float a = (f.box[2] - f.box[0]) * (f.box[3] - f.box[1]);
    if (a > bestArea) { bestArea = a; best = &f; }
  }
  std::memcpy(p_->srcEmbedding, best->embedding, sizeof(p_->srcEmbedding));
  std::memcpy(p_->srcEmbeddingNorm, best->embeddingNorm, sizeof(p_->srcEmbeddingNorm));
  p_->sourceSlots.clear();
  std::array<float, 512> slot{};
  std::memcpy(slot.data(), best->embeddingNorm, sizeof(float) * 512);
  p_->sourceSlots.push_back(slot);
  p_->activeSource = 0;
  p_->faceAssignments.clear();
  p_->tracked.clear(); p_->frameSources.clear(); p_->frameSourcesValid = false;
  p_->selectedId = -1;
  p_->haveSource = true;
  // the source frame's own analysis is bookkeeping, not output
  framesDone = 0; facesDone = 0;
  // ⚠ And it must not seed the tracker. The source is a different image of a different
  // face at a different scale; carrying its box mapping into the first target frame would
  // reconstruct a box from the wrong geometry and skip the one detection that matters.
  p_->track.reset();
  msDetect = msLandmark = msRecognise = msGeom = msEnhance = 0;
  return true;
}

int Pipeline::addSource(const ffcv::Image& img) {
  err_.clear();
  // ⚠ noTrack, and this is the whole of the deformed-face fix: with tracking enabled
  // (the live preset forces trackPeriod=4) the SECOND source's analyse() leaves a valid
  // tracker, and the THIRD source's analyse() then reconstructs its search box from the
  // second photo's landmarks -- a different face at a different scale -- cropping the
  // third face wrong, embedding garbage, and permanently deforming its swap. Source
  // images must be detected cold, every time.
  auto faces = analyse(img, /*boxesOnly=*/false, /*noTrack=*/true);
  if (faces.empty()) { if (err_.empty()) err_ = "no face detected in source image"; return -1; }
  const Face* best = &faces[0]; float area = -1.f;
  for (const auto& f : faces) {
    float a = (f.box[2] - f.box[0]) * (f.box[3] - f.box[1]);
    if (a > area) { area = a; best = &f; }
  }
  std::array<float, 512> slot{};
  std::memcpy(slot.data(), best->embeddingNorm, sizeof(float) * 512);
  p_->sourceSlots.push_back(slot);
  if (!p_->haveSource) {
    std::memcpy(p_->srcEmbeddingNorm, slot.data(), sizeof(float) * 512);
    std::memcpy(p_->srcEmbedding, best->embedding, sizeof(p_->srcEmbedding));
    p_->haveSource = true;
  }
  return (int)p_->sourceSlots.size() - 1;
}

void Pipeline::clearSourceSlots() {
  p_->sourceSlots.clear(); p_->faceAssignments.clear();
  p_->tracked.clear(); p_->frameSources.clear(); p_->frameSourcesValid = false;
  p_->selectedId = -1;
  p_->haveSource = false;
}

// Forward: defined below with the other distance helpers; the assignment helpers need it
// to decide whether two embeddings are the same person.
static float faceDistance(const float* a, const float* b);

/**
 * Two embeddings this close are the same person.
 *
 * Deliberately the SAME line updateLiveTracking uses for identity: "who is this" must have
 * one answer across the file, or a re-tap could replace an assignment the tracker would
 * still consider somebody else's.
 */
static constexpr float kSamePerson = 0.15f;

/**
 * Record one decision about one person, replacing any earlier decision about them.
 *
 * ONE entry per person, newest wins. Two entries for the same face is what made a later
 * re-entry adopt whichever of them the loop happened to reach first -- the flicker the
 * reverse tap order produced. setFaceSourceAt had no dedupe of its own before this, so
 * repeated taps on one person simply piled up.
 */
void Pipeline::Impl::rememberAssignment(const float* embeddingNorm, int sourceIndex,
                                       bool keepOriginal) {
  faceAssignments.erase(
      std::remove_if(faceAssignments.begin(), faceAssignments.end(),
          [&](const FaceAssignment& a) {
            return faceDistance(embeddingNorm, a.embedding.data()) < kSamePerson;
          }),
      faceAssignments.end());
  FaceAssignment a{};
  std::memcpy(a.embedding.data(), embeddingNorm, sizeof(float) * 512);
  a.source = keepOriginal ? kNoSource : sourceIndex;
  a.keepOriginal = keepOriginal;
  faceAssignments.push_back(a);
}

/**
 * WHICH SOURCE this face gets on this frame -- or kNoSource for "leave this one alone".
 *
 * THE one place the question is answered, because it is asked twice: the swapper asks it,
 * and then the enhancer asks it again about the same face. Answering it separately in the
 * two passes is how a person the user excluded gets left unswapped and then sharpened
 * anyway -- untouched by the feature that was supposed to leave them untouched.
 *
 * The two assign modes differ in where the answer comes from, and `frameSourcesValid` --
 * not a length comparison -- is what says which:
 *
 *   LIVE  the tracker built a per-face table for exactly this frame. Sticky: decided once
 *         at the tap, never re-scored against per-frame embedding noise.
 *   SWAP  there is no tracker, because a preview frame and an output frame are not a
 *         sequence. The decision is by IDENTITY -- the nearest remembered person, within
 *         the same distance the reference selector already uses for "is this them".
 *
 * Unassigned faces take the FROZEN default slot in both, so the source row behaves as a
 * brush on both screens: changing it changes nothing until a person is tapped.
 */
int Pipeline::Impl::sourceForFace(const Face& f, size_t fi, size_t faceCount,
                                  float refDistance) const {
  if (!assignEnabled) return activeSource;
  if (frameSourcesValid && frameSources.size() == faceCount) return frameSources[fi];
  const FaceAssignment* best = nullptr;
  float bestD = refDistance;
  for (const auto& a : faceAssignments) {
    // A slot the user has since deleted. keepOriginal entries index nothing and so
    // survive it -- the person was excluded, which is still true with fewer sources.
    if (!a.keepOriginal &&
        (a.source < 0 || a.source >= (int)sourceSlots.size())) continue;
    const float d = faceDistance(f.embeddingNorm, a.embedding.data());
    if (d < bestD) { bestD = d; best = &a; }
  }
  if (!best) return assignDefaultSource;
  return best->keepOriginal ? kNoSource : best->source;
}

/** Apply a brush to the SELECTED live person, if there is one. Shared by both brushes. */
void Pipeline::Impl::applyToSelected(int sourceIndex, bool keepOriginal) {
  if (!assignEnabled || selectedId < 0) return;
  for (auto& t : tracked) {
    if (t.id != selectedId) continue;
    t.source = keepOriginal ? kNoSource : sourceIndex;
    t.pinned = true;
    t.missed = 0;
    rememberAssignment(t.embeddingNorm, t.source, keepOriginal);
    return;
  }
}

void Pipeline::setActiveSource(int index) {
  if (index < 0 || index >= (int)p_->sourceSlots.size()) return;
  p_->activeSource = index;
  // The SELECTED person follows the chip: re-applying here is the select-then-choose
  // flow (and makes the reverse tap order work -- tap the person first, then pick the
  // source from the chips). Nobody selected: the chip only matters for the NEXT tap.
  p_->applyToSelected(index, /*keepOriginal=*/false);
}

void Pipeline::setSelectedFaceKeepOriginal(bool keep) {
  // The exact counterpart of setActiveSource's re-apply, for the one choice that is not a
  // slot. Without it, "keep the original" would be the only brush in the row that needed
  // the person tapped a second time after being selected.
  p_->applyToSelected(keep ? kNoSource : p_->activeSource, keep);
}

bool Pipeline::setFaceSourceAt(const ffcv::Image& frame, float x, float y, int sourceIndex,
                               bool keepOriginal, float* outBox, float* outEmbedding) {
  err_.clear();
  // A negative index is legal ONLY alongside keepOriginal, where nothing will index the
  // slot vector with it. Any other out-of-range value is still a caller bug.
  if (keepOriginal) sourceIndex = kNoSource;
  else if (sourceIndex < 0 || sourceIndex >= (int)p_->sourceSlots.size()) {
    err_ = "source index out of range"; return false;
  }
  // noTrack, like every source-image analysis: this records an identity, and an identity
  // computed from a reconstructed box is an identity from a different image.
  auto faces = analyse(frame, /*boxesOnly=*/false, /*noTrack=*/true);
  const Face* chosen = nullptr; float bestArea = -1.f;
  for (const auto& f : faces) if (x >= f.box[0] && x <= f.box[2] && y >= f.box[1] && y <= f.box[3]) {
    float a = (f.box[2] - f.box[0]) * (f.box[3] - f.box[1]);
    if (a > bestArea) { bestArea = a; chosen = &f; }
  }
  if (!chosen) { err_ = "no face at selected point"; return false; }
  if (outBox) std::memcpy(outBox, chosen->box, sizeof(float) * 4);
  // The caller keeps this to restore the choice onto the NEXT pipeline: a run inits a
  // fresh one, and an assignment that lived only in here would not survive pressing Swap.
  if (outEmbedding) std::memcpy(outEmbedding, chosen->embeddingNorm, sizeof(float) * 512);
  p_->rememberAssignment(chosen->embeddingNorm, sourceIndex, keepOriginal);
  return true;
}

bool Pipeline::restoreFaceAssignment(const float* embedding, int sourceIndex,
                                     bool keepOriginal) {
  err_.clear();
  if (!p_ || !embedding) { err_ = "no pipeline"; return false; }
  if (keepOriginal) sourceIndex = kNoSource;
  else if (sourceIndex < 0 || sourceIndex >= (int)p_->sourceSlots.size()) {
    err_ = "source index out of range"; return false;
  }
  p_->rememberAssignment(embedding, sourceIndex, keepOriginal);
  return true;
}

void Pipeline::clearFaceSourceAssignments() {
  p_->faceAssignments.clear();
  // The people being tracked are only "who has which source" because of the
  // assignments; clearing the memory clears the presence table too, and the selection
  // with it.
  p_->tracked.clear(); p_->frameSources.clear(); p_->frameSourcesValid = false;
  p_->selectedId = -1;
}

void Pipeline::setFaceAssignEnabled(bool enabled) {
  p_->assignEnabled = enabled;
  // ⚠ The per-frame table belongs to the mode that built it. Leaving it standing across a
  // toggle would let a Swap run inherit a table the Live pump filled -- the same-length
  // coincidence that made the length test an unreliable way to tell the two modes apart.
  p_->frameSources.clear();
  p_->frameSourcesValid = false;
  // Enabling drops whatever the detector tracker was holding: assign mode analyses with
  // noTrack (fresh detections), and a stale tracker learned on the OLD frame would only
  // confuse the first noTrack call or a later switch back to tracking.
  if (enabled) {
    p_->track.reset();
    // The feed FREEZES to the current chip the moment the mode turns on: untapped faces
    // keep this source no matter how the chip is moved afterwards. The chip only takes
    // effect through a tap (or through a SELECTED person, who follows it).
    p_->assignDefaultSource = p_->activeSource;
  } else {
    p_->selectedId = -1;   // selection is an assign-mode concept
  }
}

bool Pipeline::selectedFaceBox(float* out, int* outSource) const {
  if (!p_ || p_->selectedId < 0) return false;
  for (const auto& t : p_->tracked) {
    if (t.id == p_->selectedId) {
      if (out) std::memcpy(out, t.box, sizeof(float) * 4);
      if (outSource) *outSource = t.source;
      return true;
    }
  }
  return false;
}

void Pipeline::setSwapLargestOnly(bool enabled) {
  p_->cfg.swapLargestOnly = enabled;
}

bool Pipeline::addFaceAssignment(const Face& f, int sourceIndex) {
  if (sourceIndex < 0 || sourceIndex >= (int)p_->sourceSlots.size()) {
    err_ = "source index out of range"; return false;
  }
  // Through the shared helper, so a live tap and a Swap-screen tap agree on what
  // replacing a person's earlier choice means. This used to append blindly.
  p_->rememberAssignment(f.embeddingNorm, sourceIndex, /*keepOriginal=*/false);
  return true;
}

/**
 * face_selector.py:compare_faces, as one number.
 *
 * `1 - dot(a, b)` over two L2-normalised embeddings is 0..2; upstream maps that onto 0..1
 * with interp([0,2],[0,1]), which is a halving, and compares against the threshold. Written
 * out rather than folded into the comparison so the number can be logged and read on
 * upstream's own scale.
 */
static float faceDistance(const float* a, const float* b) {
  double dot = 0;
  for (int i = 0; i < 512; ++i) dot += (double)a[i] * b[i];
  return (float)((1.0 - dot) * 0.5);
}

// How long a tracked person survives without being seen, in frames. Pinned people get
// the long end -- someone who steps out of frame for a few seconds keeps their source
// when they come back -- while unpinned entries carry no identity and die fast so their
// slot is reused. At 20 fps these are 12 s and 4.5 s; at the slowest ncnn frame rates
// they are minutes, which is harmless: a stale entry can only be matched again by the
// person it belongs to (geometry or embedding), never stolen by proximity alone.
static constexpr int kAssignDropPinned = 240;
static constexpr int kAssignDropUnpinned = 90;

// Intersection-over-union of two detector boxes, 0 when they do not overlap.
static float boxIoU(const float* a, const float* b) {
  const float ix0 = std::max(a[0], b[0]), iy0 = std::max(a[1], b[1]);
  const float ix1 = std::min(a[2], b[2]), iy1 = std::min(a[3], b[3]);
  const float iw = std::max(0.f, ix1 - ix0), ih = std::max(0.f, iy1 - iy0);
  const float inter = iw * ih;
  if (inter <= 0.f) return 0.f;
  const float au = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return au > 0.f ? inter / au : 0.f;
}

bool Pipeline::updateLiveTracking(const std::vector<Face>& faces,
                                  float tapX, float tapY, int tapSource,
                                  bool tapKeepOriginal, float* outTapBox) {
  auto& trk = p_->tracked;
  if (!p_->assignEnabled) {          // OFF: every face follows the active slot, no state
    p_->frameSources.clear();
    p_->frameSourcesValid = false;
    return false;
  }
  err_.clear();
  const int kMaxTracked = 16;
  const float kMatchDist = 1.3f;     // centre distance, in box-dimension units
  const float kTapDist = 1.0f;       // how far a tap may be from a box centre
  const float kMatchEmb = 0.25f;     // identity re-attach after a gap
  const float kAdoptEmb = 0.30f, kAdoptMargin = 0.08f;

  const size_t oldCount = trk.size();
  std::vector<int> faceTrack(faces.size(), -1);   // face index -> tracked entry index
  std::vector<char> used(oldCount, 0);

  // ---- TAP resolution, BEFORE association: the user pointed at what the DISPLAYED
  // frame showed, and the tracked entries' boxes ARE the last analysed (displayed)
  // frame's geometry. Hit-test those, not the current frame's detections -- a person
  // who moved between the display and this frame is still the person the finger meant,
  // and the pin carries forward through the association below. The hit is by radius
  // around the box centre (inside the box always wins), not strict containment: the
  // reconstructed boxes of a moving face and a finger that lands slightly off the nose
  // are exactly why strict containment needed several tries.
  int tappedEntry = -1, tappedFace = -1;
  // ⚠ The "keep the original face" brush is a SEPARATE flag, never an out-of-band value
  // in tapSource. Encoding it as a magic negative would have meant every test below
  // reading `>= 0` silently stopped being "is there a tap" the moment the brush was used,
  // and the slot index would still have had to be faked to something in range to get
  // past the validation immediately underneath.
  if (!tapKeepOriginal && tapSource >= 0 && tapSource >= (int)p_->sourceSlots.size()) {
    err_ = "source index out of range";
    tapSource = -1;                  // report the miss below, pin nothing
  }
  const bool tapping = tapKeepOriginal || tapSource >= 0;
  if (tapping) {
    float best = kTapDist;
    for (size_t j = 0; j < oldCount; ++j) {
      if (trk[j].missed >= (trk[j].pinned ? kAssignDropPinned : kAssignDropUnpinned))
        continue;
      const float* b = trk[j].box;
      const float cw = std::max(1.f, b[2] - b[0]), ch = std::max(1.f, b[3] - b[1]);
      float d = std::hypot(tapX - (b[0] + b[2]) * 0.5f, tapY - (b[1] + b[3]) * 0.5f)
                / std::max(cw, ch);
      if (tapX >= b[0] && tapX <= b[2] && tapY >= b[1] && tapY <= b[3]) d = 0.f;
      if (d < best) { best = d; tappedEntry = (int)j; }
    }
    // No tracked person near the tap -- try the CURRENT detections: a person who just
    // appeared, or the first frame after the mode was switched on (table empty).
    if (tappedEntry < 0) {
      for (size_t i = 0; i < faces.size(); ++i) {
        const float* b = faces[i].box;
        const float cw = std::max(1.f, b[2] - b[0]), ch = std::max(1.f, b[3] - b[1]);
        float d = std::hypot(tapX - (b[0] + b[2]) * 0.5f, tapY - (b[1] + b[3]) * 0.5f)
                  / std::max(cw, ch);
        if (tapX >= b[0] && tapX <= b[2] && tapY >= b[1] && tapY <= b[3]) d = 0.f;
        if (d < best) { best = d; tappedFace = (int)i; }
      }
    }
    if (tappedEntry < 0 && tappedFace < 0) {
      err_ = "no face at selected point";
      // An EMPTY tap is the deselect gesture: the selected person keeps their last
      // source and stops following the chip, so nothing can change them by accident.
      p_->selectedId = -1;
    }
  }

  // FORCE-CLAIM for a tapped person: the tap found them where the DISPLAYED frame had
  // them, but they may have moved since. The current face nearest the tap -- within a
  // couple of box sizes of where they were one frame ago -- is almost certainly them;
  // reserving it for the tapped entry NOW keeps the regular association from handing it
  // to a fresh unpinned entry, so the pin applies on this very frame instead of when
  // the two happen to re-attach (which was a delayed, flip-flopping application).
  int claimedFace = -1;
  if (tappedEntry >= 0) {
    const float* tb = trk[(size_t)tappedEntry].box;
    const float tsize = std::max(1.f, std::max(tb[2] - tb[0], tb[3] - tb[1]));
    float bestD = 2.5f;
    for (size_t i = 0; i < faces.size(); ++i) {
      const float* b = faces[i].box;
      const float d = std::hypot(tapX - (b[0] + b[2]) * 0.5f, tapY - (b[1] + b[3]) * 0.5f)
                      / tsize;
      if (d < bestD) { bestD = d; claimedFace = (int)i; }
    }
    if (claimedFace >= 0) {
      faceTrack[(size_t)claimedFace] = tappedEntry;
      used[(size_t)tappedEntry] = 1;
    }
  }

  // ---- ASSOCIATION. A face owns an entry by geometry first -- strong overlap, then
  // centre distance, which together survive any motion between two frames of the same
  // camera -- and by embedding when geometry fails (a face reappearing after a gap is
  // still the person it matches). Greedy, one entry per face. The centre-distance pass
  // is the anti-flicker core: a face that merely MOVED must not become "new", because
  // a new unpinned entry would win the following frames and the pinned one would age
  // out -- the churn that made an assigned face flip between its own source and the
  // active slot.
  for (size_t i = 0; i < faces.size(); ++i) {        // Pass 1a: strong overlap
    int best = -1; float bestS = 0.15f;
    for (size_t j = 0; j < oldCount; ++j) {
      if (used[j] || trk[j].missed >= (trk[j].pinned ? kAssignDropPinned : kAssignDropUnpinned))
        continue;
      const float s = boxIoU(faces[i].box, trk[j].box);
      if (s > bestS) { bestS = s; best = (int)j; }
    }
    if (best >= 0) { faceTrack[i] = best; used[(size_t)best] = 1; }
  }
  for (size_t i = 0; i < faces.size(); ++i) {        // Pass 1b: centre distance
    if (faceTrack[i] >= 0) continue;
    int best = -1; float bestD = kMatchDist;
    for (size_t j = 0; j < oldCount; ++j) {
      if (used[j] || trk[j].missed >= (trk[j].pinned ? kAssignDropPinned : kAssignDropUnpinned))
        continue;
      const float* b = trk[j].box;
      const float d = std::hypot(
              faces[i].box[0] + faces[i].box[2] - b[0] - b[2],
              faces[i].box[1] + faces[i].box[3] - b[1] - b[3]) * 0.5f
              / std::max(1.f, std::max(b[2] - b[0], b[3] - b[1]));
      if (d < bestD) { bestD = d; best = (int)j; }
    }
    if (best >= 0) { faceTrack[i] = best; used[(size_t)best] = 1; }
  }
  for (size_t i = 0; i < faces.size(); ++i) {        // Pass 2: embedding
    if (faceTrack[i] >= 0) continue;
    int best = -1; float bestD = kMatchEmb;
    for (size_t j = 0; j < oldCount; ++j) {
      if (used[j] || trk[j].missed >= (trk[j].pinned ? kAssignDropPinned : kAssignDropUnpinned))
        continue;
      const float d = faceDistance(faces[i].embeddingNorm, trk[j].embeddingNorm);
      if (d < bestD) { bestD = d; best = (int)j; }
    }
    if (best >= 0) { faceTrack[i] = best; used[(size_t)best] = 1; }
  }

  // ---- NEW faces: an entry each, following the active slot. Adopt an assignment ONLY
  // on a strong, unambiguous match (the same person returning after a long absence) and
  // only here, once -- the loose 0.5 adoption of the first version re-pinned the wrong
  // face whenever an entry churned, which was half of the flicker.
  for (size_t i = 0; i < faces.size(); ++i) {
    if (faceTrack[i] >= 0) continue;
    Pipeline::Impl::TrackedFace t{};
    std::memcpy(t.box, faces[i].box, sizeof(float) * 4);
    std::memcpy(t.embeddingNorm, faces[i].embeddingNorm, sizeof(float) * 512);
    t.source = p_->assignDefaultSource;
    const Pipeline::Impl::FaceAssignment* hit = nullptr;
    float bestD = kAdoptEmb, secondD = 1e9f;
    for (const auto& a : p_->faceAssignments) {
      const float d = faceDistance(faces[i].embeddingNorm, a.embedding.data());
      if (d < bestD) { secondD = bestD; bestD = d; hit = &a; }
      else if (d < secondD) secondD = d;
    }
    // ⚠ A keepOriginal entry is adopted like any other. It used to be SKIPPED here, back
    // when the flag had no reader and meant "ignore this row"; leaving that skip in place
    // would make a person who walked out of frame and back come back swapped, silently
    // undoing the one choice the user made about them.
    if (hit && secondD - bestD > kAdoptMargin &&
        (hit->keepOriginal ||
         (hit->source >= 0 && hit->source < (int)p_->sourceSlots.size()))) {
      t.source = hit->keepOriginal ? kNoSource : hit->source;
      t.pinned = true;
    }
    t.id = p_->nextTrackedId++;
    trk.push_back(t);
    faceTrack[i] = (int)trk.size() - 1;
  }

  // ---- The pin. A tap on an entry pins THAT person (reviving a missed one -- they
  // are the person the user saw even if detection lost them this frame); a tap that
  // only found a current face pins the entry that face has (creating it if the tap
  // preceded the association). The pin lands in the table the swap on THIS frame reads,
  // so the new source applies immediately.
  if (tapping && (tappedEntry >= 0 || tappedFace >= 0)) {
    int idx = tappedEntry;
    if (idx < 0) {
      idx = faceTrack[(size_t)tappedFace];
      if (idx < 0) {
        Pipeline::Impl::TrackedFace fresh{};
        fresh.id = p_->nextTrackedId++;
        trk.push_back(fresh);
        faceTrack[(size_t)tappedFace] = (int)trk.size() - 1;
        idx = (int)trk.size() - 1;
      }
    }
    Pipeline::Impl::TrackedFace& t = trk[(size_t)idx];
    t.source = tapKeepOriginal ? kNoSource : tapSource;
    t.pinned = true; t.missed = 0;
    // The tapped person becomes the SELECTED one: they follow the chip until an empty
    // tap deselects them (see the miss branch above).
    p_->selectedId = t.id;
    // Just pinned = seen this frame, even when the person is momentarily undetected:
    // the user just confirmed they are there, so the entry must not start aging.
    if (idx >= 0 && idx < (int)oldCount) used[(size_t)idx] = 1;
    if (tappedFace >= 0) {           // refresh from the current detection when we have one
      std::memcpy(t.box, faces[(size_t)tappedFace].box, sizeof(float) * 4);
      std::memcpy(t.embeddingNorm, faces[(size_t)tappedFace].embeddingNorm,
                  sizeof(float) * 512);
    } else if (claimedFace >= 0) {   // ... or from the face the tap just force-claimed
      std::memcpy(t.box, faces[(size_t)claimedFace].box, sizeof(float) * 4);
      std::memcpy(t.embeddingNorm, faces[(size_t)claimedFace].embeddingNorm,
                  sizeof(float) * 512);
    }
    // Persistent memory of the assignment, so a later re-entry adopts the newest choice.
    // ONE per person, newest wins -- see rememberAssignment, which is also what the Swap
    // screen's by-identity assignment goes through, so both modes agree on what replacing
    // a person's choice means.
    p_->rememberAssignment(t.embeddingNorm, t.source, tapKeepOriginal);
    if (outTapBox) std::memcpy(outTapBox, t.box, sizeof(float) * 4);
  }

  // Refresh the matched entries, age the missing ones, drop the long-gone. Erase keeps
  // the order of the survivors, so the faceTrack indices (which only ever reference
  // entries matched or created THIS frame) stay valid.
  for (size_t j = 0; j < oldCount; ++j)
    trk[j].missed = used[j] ? 0 : trk[j].missed + 1;
  trk.erase(std::remove_if(trk.begin(), trk.end(),
              [](const Pipeline::Impl::TrackedFace& t) {
                return t.missed >= (t.pinned ? kAssignDropPinned : kAssignDropUnpinned);
              }),
            trk.end());
  while (trk.size() > (size_t)kMaxTracked) trk.pop_back();

  // The per-face source table for swapAll: pinned faces keep THEIR source, everyone
  // else keeps the frozen default -- NOT the active slot. The active slot is what the
  // NEXT tap will pin, not what the feed does now: in assign mode the chip is a brush,
  // and no face changes until one is tapped.
  p_->frameSources.resize(faces.size());
  for (size_t i = 0; i < faces.size(); ++i) {
    const Pipeline::Impl::TrackedFace& t = trk[(size_t)faceTrack[i]];
    p_->frameSources[i] = t.pinned ? t.source : p_->assignDefaultSource;
  }
  // Said, not inferred: this table describes THIS frame, and swapAll may use it.
  p_->frameSourcesValid = true;
  return tapping && (tappedEntry >= 0 || tappedFace >= 0);
}

bool Pipeline::setReferenceFaceAt(const ffcv::Image& frame, float x, float y, float* outBox) {
  err_.clear();
  if (!p_) { err_ = "pipeline not initialised"; return false; }
  // The FULL analyse: this needs the embedding, which boxesOnly deliberately does not
  // compute. It is the one place the extra 3.55 ms/face is the whole point.
  auto faces = analyse(frame);
  const Face* hit = nullptr;
  for (const auto& f : faces) {
    if (x >= f.box[0] && x <= f.box[2] && y >= f.box[1] && y <= f.box[3]) {
      // The SMALLEST box containing the point wins. Overlapping detections happen when one
      // face is behind another, and taking the first would pick by detector order -- which
      // is score order, not what the finger was over.
      if (!hit || (f.box[2] - f.box[0]) * (f.box[3] - f.box[1]) <
                  (hit->box[2] - hit->box[0]) * (hit->box[3] - hit->box[1]))
        hit = &f;
    }
  }
  if (!hit) { err_ = "no face at that point"; return false; }
  std::memcpy(p_->refEmbeddingNorm, hit->embeddingNorm, sizeof(p_->refEmbeddingNorm));
  p_->haveReference = true;
  if (outBox) for (int i = 0; i < 4; ++i) outBox[i] = hit->box[i];
  return true;
}

void Pipeline::setReferenceEmbedding(const float* e) {
  if (!p_ || !e) return;
  std::memcpy(p_->refEmbeddingNorm, e, sizeof(p_->refEmbeddingNorm));
  p_->haveReference = true;
}

bool Pipeline::referenceEmbedding(float* out) const {
  if (!p_ || !p_->haveReference || !out) return false;
  std::memcpy(out, p_->refEmbeddingNorm, sizeof(p_->refEmbeddingNorm));
  return true;
}

void Pipeline::clearReferenceFace() { if (p_) p_->haveReference = false; }

bool Pipeline::hasReferenceFace() const { return p_ && p_->haveReference; }

bool Pipeline::addLipReferenceFaceAt(const ffcv::Image& frame, float x, float y,
                                      float* outBox, int* outIndex) {
  err_.clear();
  if (!p_) { err_ = "pipeline not initialised"; return false; }
  // The FULL analyse: this needs the embedding, which boxesOnly deliberately does not
  // compute. It is the one place the extra 3.55 ms/face is the whole point.
  auto faces = analyse(frame);
  const Face* hit = nullptr;
  for (const auto& f : faces) {
    if (x >= f.box[0] && x <= f.box[2] && y >= f.box[1] && y <= f.box[3]) {
      // The SMALLEST box containing the point wins, as in setReferenceFaceAt.
      if (!hit || (f.box[2] - f.box[0]) * (f.box[3] - f.box[1]) <
                  (hit->box[2] - hit->box[0]) * (hit->box[3] - hit->box[1]))
        hit = &f;
    }
  }
  if (!hit) { err_ = "no face at that point"; return false; }
  // Always appends: add-vs-remove is the caller's tap decision (hit inside an
  // existing marker box = remove), never an embedding guess -- two similar
  // faces must both be listable, and the export matches by identity anyway.
  std::lock_guard<std::mutex> lk(p_->lipMu);
  if ((int)p_->lipRefs.size() >= Impl::kLipRefMax) { err_ = "lips list is full"; return false; }
  Impl::LipRef r{};
  std::memcpy(r.embeddingNorm, hit->embeddingNorm, sizeof(r.embeddingNorm));
  for (int k = 0; k < 4; ++k) r.box[k] = hit->box[k];
  p_->lipRefs.push_back(r);
  if (outBox) for (int k = 0; k < 4; ++k) outBox[k] = hit->box[k];
  if (outIndex) *outIndex = (int)p_->lipRefs.size() - 1;
  return true;
}

bool Pipeline::removeLipReferenceAt(int index) {
  err_.clear();
  if (!p_) { err_ = "pipeline not initialised"; return false; }
  std::lock_guard<std::mutex> lk(p_->lipMu);
  if (index < 0 || index >= (int)p_->lipRefs.size()) { err_ = "lips index out of range"; return false; }
  p_->lipRefs.erase(p_->lipRefs.begin() + index);
  return true;
}

int Pipeline::lipReferenceCount() const {
  if (!p_) return 0;
  std::lock_guard<std::mutex> lk(p_->lipMu);
  return (int)p_->lipRefs.size();
}

bool Pipeline::lipReferenceBox(int index, float* outBox) const {
  if (!p_ || !outBox) return false;
  std::lock_guard<std::mutex> lk(p_->lipMu);
  if (index < 0 || index >= (int)p_->lipRefs.size()) return false;
  for (int k = 0; k < 4; ++k) outBox[k] = p_->lipRefs[(size_t)index].box[k];
  return true;
}

bool Pipeline::lipReferenceEmbedding(int index, float* out) const {
  if (!p_ || !out) return false;
  std::lock_guard<std::mutex> lk(p_->lipMu);
  if (index < 0 || index >= (int)p_->lipRefs.size()) return false;
  std::memcpy(out, p_->lipRefs[(size_t)index].embeddingNorm,
              sizeof(p_->lipRefs[(size_t)index].embeddingNorm));
  return true;
}

void Pipeline::addLipReferenceEmbedding(const float* e) {
  if (!p_ || !e) return;
  std::lock_guard<std::mutex> lk(p_->lipMu);
  if ((int)p_->lipRefs.size() >= Impl::kLipRefMax) return;
  // Appends unconditionally: same-person doubles are refused upstream (the tap
  // flow refreshes the marker instead, under a strict 0.05 bar), and a loose
  // threshold here would eat a second, similar face at restore time -- the
  // "two picked, one synced" shape of bug.
  Impl::LipRef r{};
  std::memcpy(r.embeddingNorm, e, sizeof(r.embeddingNorm));
  p_->lipRefs.push_back(r);
}

void Pipeline::clearLipReferenceFace() {
  if (!p_) return;
  std::lock_guard<std::mutex> lk(p_->lipMu);
  p_->lipRefs.clear();
}

bool Pipeline::hasLipReferenceFace() const {
  if (!p_) return false;
  std::lock_guard<std::mutex> lk(p_->lipMu);
  return !p_->lipRefs.empty();
}

void Pipeline::resetStats() {
  msDetect = msLandmark = msRecognise = msSwap = msGeom = msEnhance = msLipSync = 0;
  msEdit = msEditCpu = 0;
  msLipCrop = msLipMask = msLipPrep = msLipPaste = 0;
  msGeomDetPrep = msGeomWarp = msGeomTensor = msGeomMask = msGeomPaste = 0;
  framesDone = facesDone = 0;
}

// ---------------------------------------------------- lip syncer (edtalk_256)
//
// lip_syncer/core.py:sync_lip, the edtalk branch. The one thing to keep in mind reading
// it: NOTHING here reuses the swapper's crop. The swapper works on arcface_128 at 256;
// this works on ffhq_512 at 512, resized -- not warped -- to the model's 256. Handing it
// the swapper's crop would run a numerically perfect graph over the wrong pixels, which
// is trap #9.
bool Pipeline::syncLip(ffcv::Image& frame, const std::vector<Face>& faces,
                       const float* melWindow) {
  if (!p_ || !p_->n.lip || !melWindow) return true;   // absent is not a failure
  const int LS = 512;
  const bool ed = p_->n.lipIsEdtalk;
  const Config& cfg = p_->cfg;
  // WHO gets the mouth redrawn: the same selection the swapper applies, so a
  // person the swap left alone (Keep face, largest-only, reference) is left
  // alone here too. Explicit lips taps win over all of it: each listed identity
  // dubs only its BEST-matching face in the frame (within referenceDistance),
  // so one tap moves one mouth even among similar faces, several taps move
  // several -- and the same face is never dubbed twice. Unset = whoever
  // swapAll processes. Default (no selection anywhere) is still every face.
  std::vector<Impl::LipRef> lipRefs;
  {
    std::lock_guard<std::mutex> lk(p_->lipMu);
    lipRefs = p_->lipRefs;
  }
  const bool byLipReference = !lipRefs.empty();
  const bool byReference = p_->haveReference;
  const Face* only = nullptr;
  if (!byLipReference && !byReference && cfg.swapLargestOnly) {
    float best = -1.f;
    for (const Face& f : faces) {
      float a = (f.box[2] - f.box[0]) * (f.box[3] - f.box[1]);
      if (a > best) { best = a; only = &f; }
    }
  }
  // For each face, its nearest listed identity (-1 when the list is empty).
  // A face is dubbed when it is some identity's best match within threshold:
  // exactly one mouth per tap, never two mouths for one tap, never two dubs
  // for one mouth.
  std::vector<int> lipBest(faces.size(), -1);
  if (byLipReference) {
    for (size_t fi = 0; fi < faces.size(); ++fi) {
      float bestD = cfg.referenceDistance;
      int bestK = -1;
      for (size_t k = 0; k < lipRefs.size(); ++k) {
        const float d = faceDistance(faces[fi].embeddingNorm,
                                     lipRefs[k].embeddingNorm);
        if (d < bestD) { bestD = d; bestK = (int)k; }
      }
      if (bestK >= 0) {
        // Still the best face for identity bestK? A strict improvement elsewhere
        // steals it; ties keep the first face, so the choice cannot flicker.
        bool mine = true;
        for (size_t gj = 0; gj < faces.size(); ++gj) {
          if (gj == fi) continue;
          if (faceDistance(faces[gj].embeddingNorm,
                           lipRefs[(size_t)bestK].embeddingNorm) < bestD) {
            mine = false;
            break;
          }
        }
        if (mine) lipBest[fi] = bestK;
      }
    }
  }

  for (size_t fi = 0; fi < faces.size(); ++fi) {
    const Face& f = faces[fi];
    if (only && &f != only) continue;
    if (byReference &&
        faceDistance(f.embeddingNorm, p_->refEmbeddingNorm) >= cfg.referenceDistance)
      continue;
    if (byLipReference) {
      if (lipBest[fi] < 0) continue;
    } else {
      // Same answer as swapAll for this face: Keep face (kNoSource) is honoured
      // here, otherwise an excluded person would be synced but not swapped.
      // With assign mode off this returns the active slot and changes nothing.
      const int six = p_->sourceForFace(f, fi, faces.size(), cfg.referenceDistance);
      if (six == kNoSource) continue;
    }
    double t0 = nowMs();
    // warp_face_by_face_landmark_5(frame, landmark_set['5/68'], 'ffhq_512', (512, 512))
    float tmpl[10];
    const float* T = ffcv::warpTemplate(2);          // ffhq_512
    for (int i = 0; i < 10; ++i) tmpl[i] = T[i] * LS;
    ffcv::Affine am = ffcv::umeyama(f.landmark5_68, tmpl, 5);

    if (ed) {
      // edtalk (lip_syncer/core.py, the edtalk branch of sync_lip) is NOT the same shape
      // as wav2lip and was wrongly ported as if it were -- checked against upstream after
      // the user reported discoloration and warping, not assumed. It is a full-face
      // generator, not a mouth-box inpainter:
      //   * the model sees the WHOLE 512 crop resized to 256 (cv2.resize, not a
      //     landmark-derived mouth box warped up 256/~280 -- there IS no mouth box);
      //   * it wants RGB. Every other graph in this file does too and gets the (2-c)
      //     index swap on the way in and out (swapAll, the enhancer); this branch was the
      //     one place that swap was missing, feeding a model trained on RGB three BGR
      //     channels it reads as R and B swapped -- the discoloration was exactly that;
      //   * the blend mask is create_box_mask (the swapper's own mask, `cfg.maskBlur` /
      //     `cfg.maskPadding` -- a near-whole-crop feathered rectangle), not the
      //     lower-face hull. The lower-face mask was wav2lip's inpaint region leaking into
      //     a model that was never restricted to one -- the visible seam around a smaller
      //     patch than the model actually redrew was the "warping".
      double tc = nowMs();
      ffcv::Image crop = ffcv::warpAffine(frame, am, LS, LS, ffcv::BORDER_REPLICATE);
      msLipCrop += nowMs() - tc;

      tc = nowMs();
      const ffcv::MatF& mask = p_->lipBoxMask.get(LS, cfg.maskBlur, cfg.maskPadding);
      msLipMask += nowMs() - tc;
      msGeom += nowMs() - t0;

      t0 = nowMs();
      const int MS = 256;
      // cv2.resize(crop, (256,256), INTER_AREA): measured bit-identical to bilinear at
      // this exact 2x ratio (0 LSB over a blurred random 512x512), so resizeLinear is
      // exact here -- ffcv has no separate area filter and does not need one.
      ffcv::Image area = ffcv::resizeLinear(crop, MS, MS);
      std::vector<float> in((size_t)3 * MS * MS);
      for (int y = 0; y < MS; ++y) {
        const uint8_t* row = area.row(y);
        for (int x = 0; x < MS; ++x)
          for (int c = 0; c < 3; ++c)
            in[(size_t)(2 - c) * MS * MS + (size_t)y * MS + x] = row[x * 3 + c] / 255.0f;
      }
      msGeom += nowMs() - t0;
      msLipPrep += nowMs() - t0;

      t0 = nowMs();
      std::vector<std::vector<float>> out;
      // The lip-direction scale, `--lip-syncer-weight` -- read directly off `cfg`, not
      // fixed. Upstream's default is 0.5, not 1.0: driving it at a hardcoded 1.0 was this
      // port inventing a value, not matching upstream's own default.
      float lipWeight = cfg.lipSyncWeight;
      if (!ffnn::execute(p_->n.lip, {"source", "target", "weight"},
                         {melWindow, in.data(), &lipWeight}, out) ||
          out.empty() || out[0].size() < (size_t)3 * MS * MS) {
        err_ = std::string("lip syncer: ") + ffnn::lastError();
        return false;
      }
      msLipSync += nowMs() - t0;

      t0 = nowMs();
      ffcv::Image synced(MS, MS, 3);
      for (int y = 0; y < MS; ++y) {
        uint8_t* row = synced.row(y);
        for (int x = 0; x < MS; ++x)
          for (int c = 0; c < 3; ++c) {
            float v = out[0][(size_t)c * MS * MS + (size_t)y * MS + x];
            v = v < 0.f ? 0.f : (v > 1.f ? 1.f : v);
            row[x * 3 + (2 - c)] = (uint8_t)(v * 255.0f);   // RGB -> BGR
          }
      }
      // cv2.resize(.., (512,512), INTER_CUBIC): the one approximation left in this branch.
      // Measured against bilinear at this ratio: 3 LSB max / 0.4 LSB mean over a blurred
      // random image -- not exact, but sub-1% of range and a long way under the two bugs
      // this branch exists to fix. A byte-exact bicubic is future work if that residual
      // ever shows up in a deploy-SNR number instead of just this comment.
      ffcv::Image back = ffcv::resizeLinear(synced, LS, LS);
      ffcv::MatF backF(LS, LS, 3);
      for (int y = 0; y < LS; ++y) {
        const uint8_t* srow = back.row(y);
        float* drow = backF.row(y);
        for (int i = 0, n = LS * 3; i < n; ++i) drow[i] = srow[i];
      }
      ffcv::pasteBack(frame, backF, mask, am);
      msGeom += nowMs() - t0;
      msLipPaste += nowMs() - t0;
      continue;
    }

    // wav2lip was the FIRST lip syncer here and is gone: an inpainter that warped the
    // 68-point mouth box to 96 and drew the mouth at 3x upscale, against edtalk's
    // full-face 256 generator. Only edtalk is opened now, so reaching this point means
    // the graph is loaded but is not the one this code understands -- refuse rather than
    // run edtalk's crop chain through a model that wants a different one.
    err_ = "lip syncer: unsupported graph";
    return false;
  }
  return true;
}

void Pipeline::setSwapEnabled(bool enabled) {
  p_->cfg.swapEnabled = enabled;
}

// ------------------------------------------------------------------ mask models
//
// face_masker.py:create_occlusion_mask / create_region_mask, on the TARGET crop (before the
// swap), combined with the box mask by minimum exactly as face_swapper does:
//
//     crop_mask = numpy.minimum.reduce(crop_masks).clip(0, 1)
//
// Each model mask is resized to the crop, blurred with sigma 5 and stretched from
// [0.5, 1] to [0, 1], which is upstream's edge treatment.

namespace {
// The FaceFusion BiSeNet labels kept by --face-mask-regions (all of them by default):
// skin, brows, eyes, glasses, nose, mouth, upper lip, lower lip.
constexpr int kRegionLabels[] = {1, 2, 3, 4, 5, 6, 10, 11, 12, 13};
constexpr int kMouthLabel = 11;   // the mouth INTERIOR: teeth, tongue, whatever is in it
constexpr int kUpperLip = 12, kLowerLip = 13;

void finishModelMask(ffcv::MatF& mm, int CS, ffcv::MatF& m) {
  ffcv::MatF r = ffmotion::resizeMask(mm, CS, CS);
  for (float& v : r.data) v = v < 0.f ? 0.f : (v > 1.f ? 1.f : v);
  r = ffcv::gaussianBlur(r, 5.0);
  for (size_t i = 0; i < m.data.size(); ++i) {
    float v = r.data[i];
    v = v < 0.5f ? 0.5f : (v > 1.f ? 1.f : v);
    v = (v - 0.5f) * 2.f;
    if (v < m.data[i]) m.data[i] = v;
  }
}

bool allFinite(const std::vector<float>& v) {
  for (float x : v) if (!std::isfinite(x)) return false;
  return !v.empty();
}

// What maskNet last found out, per model (0 = occlusion, 1 = face parser).
std::mutex g_maskMu;
std::string g_maskState[2] = {"not used yet", "not used yet"};
void setMaskState(int i, const std::string& s) {
  std::lock_guard<std::mutex> lk(g_maskMu);
  g_maskState[i] = s;
}

// A smooth synthetic face-sized probe: a bright ellipse on a gradient. Constant input is a
// poor probe -- it drives a U-Net's activations toward a corner where a wrong GPU and a
// right CPU can agree.
std::vector<float> maskProbe(int size, bool imagenet) {
  std::vector<float> v((size_t)3 * size * size);
  for (int c = 0; c < 3; ++c)
    for (int y = 0; y < size; ++y)
      for (int x = 0; x < size; ++x) {
        const float dx = (x - size * 0.5f) / (size * 0.3f), dy = (y - size * 0.55f) / (size * 0.4f);
        float p = 0.25f + 0.3f * x / size + (dx * dx + dy * dy < 1.f ? 0.4f : 0.f) + 0.05f * c;
        if (imagenet) p = (p - 0.45f) / 0.226f;
        v[(size_t)c * size * size + (size_t)y * size + x] = p;
      }
  return v;
}

// Do the GPU and the CPU compute the same mask? xseg: mean absolute difference of the
// sigmoid output; bisenet: per-pixel label agreement over 19 logit planes.
bool masksAgree(const std::vector<float>& a, const std::vector<float>& b, int size, bool labels,
                std::string* why) {
  if (a.size() != b.size() || a.empty()) { *why = "output sizes differ"; return false; }
  char buf[96];
  if (!labels) {
    double d = 0;
    for (size_t i = 0; i < a.size(); ++i) d += std::fabs(a[i] - b[i]);
    d /= (double)a.size();
    snprintf(buf, sizeof(buf), "GPU differs from CPU by %.3f", d);
    *why = buf;
    return d < 0.03;
  }
  const size_t plane = (size_t)size * size;
  const int L = (int)(a.size() / plane);
  size_t same = 0;
  for (size_t i = 0; i < plane; ++i) {
    int ba = 0, bb = 0;
    for (int l = 1; l < L; ++l) {
      if (a[(size_t)l * plane + i] > a[(size_t)ba * plane + i]) ba = l;
      if (b[(size_t)l * plane + i] > b[(size_t)bb * plane + i]) bb = l;
    }
    same += ba == bb;
  }
  const double agree = (double)same / (double)plane;
  snprintf(buf, sizeof(buf), "GPU agrees with CPU on %.1f%% of pixels", agree * 100.0);
  *why = buf;
  return agree > 0.98;
}
}  // namespace

std::string Pipeline::maskStatus() {
  std::lock_guard<std::mutex> lk(g_maskMu);
  return "Occlusion model: " + g_maskState[0] + "\nFace parser: " + g_maskState[1];
}

ffnn::Handle Pipeline::Impl::maskNet(const char* name, int size, ffnn::Handle& h,
                                     bool& tried) {
  if (tried) return h;
  tried = true;
  const bool parser = std::strcmp(name, "bisenet") == 0;
  const int slot = parser ? 1 : 0;
  const std::vector<float> probe = maskProbe(size, parser);
  auto run = [&](ffnn::Handle x, std::vector<float>& out) {
    std::vector<std::vector<float>> o;
    if (!ffnn::execute(x, {"input"}, {probe.data()}, o) || o.empty() || !allFinite(o[0]))
      return false;
    out.swap(o[0]);
    return true;
  };

  // The CPU is the reference. A mask model that is wrong but finite is the failure that
  // matters here -- it silently turns the mask into "all face" -- so the GPU is only used
  // when it computes the same mask as the CPU does on this device.
  ffnn::Handle cpu = ffnn::openAux(name, ffnn::Placement::Cpu);
  if (!cpu) {
    setMaskState(slot, std::string("not loaded: ") + ffnn::auxLastError());
    return nullptr;
  }
  std::vector<float> ref;
  if (!run(cpu, ref)) {
    ffnn::release(cpu);
    setMaskState(slot, "loaded but does not run on the CPU");
    return nullptr;
  }
  ffnn::Handle gpu = ffnn::openAux(name, ffnn::Placement::Default);
  if (gpu && ffnn::onGpu(gpu)) {
    std::vector<float> got;
    std::string why = "GPU returned no usable output";
    if (run(gpu, got) && masksAgree(got, ref, size, parser, &why)) {
      ffnn::release(cpu);
      h = gpu;
      setMaskState(slot, "running on the GPU (" + why + ")");
      return h;
    }
    ffnn::release(gpu);
    h = cpu;
    setMaskState(slot, "running on the CPU, slower (GPU rejected: " + why + ")");
    return h;
  }
  if (gpu) ffnn::release(gpu);
  h = cpu;
  setMaskState(slot, "running on the CPU, slower (no usable GPU)");
  return h;
}

bool Pipeline::Impl::applyMaskModels(const ffcv::Image& crop, ffcv::MatF& m,
                                     std::string& err) {
  const int CS = crop.w;
  if (cfg.occlusionMask && maskNet("xseg", 256, n.occ, n.occTried)) {
    constexpr int XS = 256;
    const ffcv::Image s = (crop.w == XS && crop.h == XS) ? crop : ffcv::resizeLinear(crop, XS, XS);
    std::vector<float> in((size_t)3 * XS * XS);
    for (int y = 0; y < XS; ++y) {
      const uint8_t* row = s.row(y);
      for (int x = 0; x < XS; ++x)
        for (int c = 0; c < 3; ++c)   // BGR, as upstream feeds the cv2 frame
          in[(size_t)c * XS * XS + (size_t)y * XS + x] = row[x * 3 + c] / 255.f;
    }
    std::vector<std::vector<float>> out;
    if (!ffnn::execute(n.occ, {"input"}, {in.data()}, out) || out.empty() ||
        out[0].size() < (size_t)XS * XS) {
      err = std::string("occlusion mask: ") + ffnn::auxLastError();
      return false;
    }
    ffcv::MatF om(XS, XS, 1);
    std::memcpy(om.data.data(), out[0].data(), sizeof(float) * XS * XS);
    finishModelMask(om, CS, m);
  }
  if ((cfg.regionMask || cfg.keepMouth || cfg.keepLips) &&
      maskNet("bisenet", 512, n.parse, n.parseTried)) {
    constexpr int PS = 512;
    const ffcv::Image s = ffcv::resizeLinear(crop, PS, PS);
    static const float mean[3] = {0.485f, 0.456f, 0.406f}, stdv[3] = {0.229f, 0.224f, 0.225f};
    std::vector<float> in((size_t)3 * PS * PS);
    for (int y = 0; y < PS; ++y) {
      const uint8_t* row = s.row(y);
      for (int x = 0; x < PS; ++x)
        for (int c = 0; c < 3; ++c)   // RGB plane c reads BGR byte 2-c
          in[(size_t)c * PS * PS + (size_t)y * PS + x] =
              (row[x * 3 + (2 - c)] / 255.f - mean[c]) / stdv[c];
    }
    std::vector<std::vector<float>> out;
    constexpr int L = 19;
    if (!ffnn::execute(n.parse, {"input"}, {in.data()}, out) || out.empty() ||
        out[0].size() < (size_t)L * PS * PS) {
      err = std::string("face parser: ") + ffnn::auxLastError();
      return false;
    }
    // Labels left ORIGINAL by the mouth switches.
    bool original[L] = {};
    if (cfg.keepMouth) original[kMouthLabel] = true;
    if (cfg.keepLips) { original[kUpperLip] = true; original[kLowerLip] = true; }
    // With the region mask on only the face regions are swapped; without it everything the
    // box mask covers is, except what the mouth switches keep original.
    bool keepLabel[L] = {};
    if (cfg.regionMask)
      for (int lab : kRegionLabels) keepLabel[lab] = true;
    else
      for (int lab = 0; lab < L; ++lab) keepLabel[lab] = true;
    for (int lab = 0; lab < L; ++lab) if (original[lab]) keepLabel[lab] = false;
    const float* lg = out[0].data();
    const size_t plane = (size_t)PS * PS;
    ffcv::MatF rm(PS, PS, 1);
    for (size_t i = 0; i < plane; ++i) {
      int best = 0;
      float bv = lg[i];
      for (int lab = 1; lab < L; ++lab) {
        const float v = lg[(size_t)lab * plane + i];
        if (v > bv) { bv = v; best = lab; }
      }
      rm.data[i] = keepLabel[best] ? 1.f : 0.f;
    }
    finishModelMask(rm, CS, m);
  }
  return true;
}

bool Pipeline::swapAll(ffcv::Image& frame, const std::vector<Face>& faces) {
  p_->maskCache.clear();
  p_->havePreSwap = false;   // set again below only when THIS frame is swapped
  if (!p_->cfg.occlusionMask && !p_->n.occTried) setMaskState(0, "switched off");
  if (!p_->cfg.regionMask && !p_->cfg.keepMouth && !p_->cfg.keepLips && !p_->n.parseTried)
    setMaskState(1, "switched off");
  if (!p_->cfg.swapEnabled) return true;
  if (!p_->haveSource) { err_ = "setSource not called"; return false; }
  // ⚠ NO CHECK, NO SWAP. See Impl::gateCleared. The message never quotes the score.
  if (!p_->gateCleared) {
    err_ = "content check has not run for this pipeline";
    return false;
  }
  const Config& cfg = p_->cfg;
  const int SS = cfg.swapSize;                       // what the GRAPH takes: always 256
  const int PB = cfg.pixelBoost < 1 ? 1 : cfg.pixelBoost;
  const int CS = SS * PB;                            // what the FACE is warped at
  p_->havePreSwap = cfg.expressionRestore && hasFaceEditor() && !faces.empty();
  if (p_->havePreSwap) p_->preSwap = frame;

  float tmpl[10];
  const float* T = ffcv::warpTemplate(1);            // arcface_128, both swappers
  for (int i = 0; i < 10; ++i) tmpl[i] = T[i] * CS;

  // The mask is built at the crop size, not the model size: with pixel boost the crop is
  // larger than the graph and paste_back works on the crop. Cached, because CS, maskBlur
  // and maskPadding are identical on every frame of a run and this is a 79-tap blur.
  double tm = nowMs();
  const ffcv::MatF& mask = p_->swapBoxMask.get(CS, cfg.maskBlur, cfg.maskPadding);
  msGeom += nowMs() - tm;
  msGeomMask += nowMs() - tm;

  // face_selector_mode `reference`: every face within referenceDistance of the one the
  // user pointed at. Checked FIRST because the two modes are exclusive upstream -- a
  // reference that is set is the whole selector, and `one` is what the app falls back to
  // when there is none. Doing it the other way round would let "largest" quietly override
  // a face the user chose by hand, which is the one selection they made deliberately.
  const bool byReference = p_->haveReference;

  // face_selector_mode `one`: the largest detected face by box area.
  const Face* only = nullptr;
  if (!byReference && cfg.swapLargestOnly) {
    float best = -1.f;
    for (const Face& f : faces) {
      float a = (f.box[2] - f.box[0]) * (f.box[3] - f.box[1]);
      if (a > best) { best = a; only = &f; }
    }
  }

  for (size_t fi = 0; fi < faces.size(); ++fi) {
    const Face& f = faces[fi];
    if (only && &f != only) continue;
    // face_selector.py:find_match_faces -- ALL faces near the reference, not the nearest
    // one. Upstream returns a list, and a clip where the same person is detected twice
    // (a reflection, a poster) should swap both rather than pick between them.
    if (byReference &&
        faceDistance(f.embeddingNorm, p_->refEmbeddingNorm) >= cfg.referenceDistance)
      continue;

    // POSE FADE: a head turned far enough that the swapper would stretch it keeps its own
    // face. Checked before any pixel work, so a profile costs nothing.
    if (f.poseFade < 0.02f) continue;

    double t0 = nowMs();
    ffcv::Affine am = ffcv::umeyama(f.landmark5_68, tmpl, 5);
    double tw3 = nowMs();
    ffcv::Image crop = ffcv::warpAffine(frame, am, CS, CS, ffcv::BORDER_REPLICATE);
    msGeomWarp += nowMs() - tw3;

    // WHICH SOURCE to blend. setSource/addSource keep sourceSlots in the same order as
    // the caller's list, and setActiveSource flips this index between frames -- that is
    // the whole of the multi-source live mode, and without it a switch changed the
    // index and nothing else. haveSource is checked above and implies a non-empty
    // vector, but a stale index must still fall back to slot 0 rather than read past
    // it.
    // PER-PERSON ASSIGNMENT, on either screen. With the mode off this returns the
    // active slot and the rest of this loop is byte-for-byte what it always was.
    const int six = p_->sourceForFace(f, fi, faces.size(), cfg.referenceDistance);
    // ⚠ The ONE assignment that is an instruction NOT to swap. It has to be honoured
    // here, before any pixel is read, rather than by pointing the face at some harmless
    // slot: "keep this person's own face" is not a swap with a different source.
    if (six == kNoSource) continue;

    // The MASK MODELS run on THIS thread, before the paste. Build 7 ran them on a
    // std::async thread per face to overlap the swapper; on device that path crashed
    // inside swapAll (SEGV_MAPERR, and an abort), so it is gone. Sequential is what builds
    // 4-6 shipped. The fp16 GPU arithmetic, which is where most of the speed came from,
    // stays.
    const bool modelMasks = p_->wantsMaskModels();
    ffcv::MatF faceMask;
    const float* srcEmbNorm = p_->srcEmbeddingNorm;
    if (!p_->sourceSlots.empty() && six >= 0 && six < (int)p_->sourceSlots.size())
      srcEmbNorm = p_->sourceSlots[(size_t)six].data();

    // balance_source_embedding (face_swapper/core.py:715). Identity-space, so it is
    // computed once per face and shared by every pixel-boost sub-image.
    float w = 0.35f - 0.70f * cfg.swapperWeight;     // numpy.interp(w, [0,1], [0.35,-0.35])
    double tn = 0;
    for (int i = 0; i < 512; ++i) tn += (double)f.embedding[i] * f.embedding[i];
    tn = std::sqrt(tn);
    std::vector<float> src(512);
    for (int i = 0; i < 512; ++i)
      src[i] = srcEmbNorm[i] * (1.f - w) + (float)(f.embedding[i] / tn) * w;
    msGeom += nowMs() - t0;

    ffcv::MatF outCrop(CS, CS, 3);
    std::vector<float> tin((size_t)3 * SS * SS);

    // implode_pixel_boost / explode_pixel_boost (processors/pixel_boost.py), done as
    // strided indexing rather than the reshape+transpose pair: sub-image k = (ty, tx)
    // holds crop[y*PB + ty, x*PB + tx], and the output goes straight back to the same
    // positions. PB == 1 collapses to the original single pass with stride 1.
    for (int k = 0; k < PB * PB; ++k) {
      const int ty = k / PB, tx = k % PB;

      t0 = nowMs();
      for (int y = 0; y < SS; ++y) {
        const uint8_t* row = crop.row(y * PB + ty);
        for (int x = 0; x < SS; ++x)
          for (int c = 0; c < 3; ++c)
            tin[(size_t)(2 - c) * SS * SS + (size_t)y * SS + x] =
                ((row[(x * PB + tx) * 3 + c] / 255.0f) - cfg.swapMean) / cfg.swapStd;
      }
      msGeom += nowMs() - t0;
      msGeomTensor += nowMs() - t0;

      t0 = nowMs();
      std::vector<std::vector<float>> so;
      if (!ffnn::execute(p_->n.swap, {"target", "source"}, {tin.data(), src.data()}, so)) {
        err_ = std::string("swapper: ") + ffnn::lastError();
        return false;
      }
      msSwap += nowMs() - t0;

      t0 = nowMs();
      const float* o = so[0].data();
      for (int y = 0; y < SS; ++y) {
        float* orow = outCrop.row(y * PB + ty);
        for (int x = 0; x < SS; ++x)
          for (int c = 0; c < 3; ++c) {
            float v = o[(size_t)c * SS * SS + (size_t)y * SS + x];
            if (cfg.swapDenorm) v = v * cfg.swapStd + cfg.swapMean;
            v = v < 0.f ? 0.f : (v > 1.f ? 1.f : v);
            orow[(x * PB + tx) * 3 + (2 - c)] = v * 255.f;   // RGB -> BGR
          }
      }
      msGeom += nowMs() - t0;
      msGeomTensor += nowMs() - t0;
    }

    // The enhancer used to run HERE, fused into the swap crop. It no longer does -- see
    // `enhance()`, always called as its own pass now, after this and after `syncLip`
    // when the caller has one. Measured: fusing it here meant edtalk's whole-face
    // regeneration overwrote nearly everything it had just sharpened.

    // The per-face mask: box mask, shrunk by the occlusion/region models on the TARGET
    // crop (taken before the swap overwrote nothing -- `crop` is the original pixels), then
    // scaled by the pose fade.
    const ffcv::MatF* useMask = &mask;
    if (modelMasks || f.poseFade < 0.999f) {
      t0 = nowMs();
      faceMask = mask;
      if (modelMasks && !p_->applyMaskModels(crop, faceMask, err_)) return false;
      if (f.poseFade < 0.999f)
        for (float& v : faceMask.data) v *= f.poseFade;
      Impl::CachedMask cm;
      std::memcpy(cm.lm5, f.landmark5_68, sizeof(cm.lm5));
      cm.mask = faceMask;
      p_->maskCache.push_back(std::move(cm));
      useMask = &faceMask;
      msGeomMask += nowMs() - t0;
    }

    // SKIN TONE: the swapped face takes the target face's colour statistics, measured
    // over the pixels this face will actually be pasted on.
    if (cfg.colorMatch > 0.f) {
      t0 = nowMs();
      ffmotion::matchColor(crop, outCrop, *useMask, cfg.colorMatch);
      msGeom += nowMs() - t0;
    }

    t0 = nowMs();
    ffcv::pasteBack(frame, outCrop, *useMask, am);
    msGeom += nowMs() - t0;
    msGeomPaste += nowMs() - t0;
  }
  return true;
}

bool Pipeline::enhance(ffcv::Image& frame, const std::vector<Face>& faces) {
  if (!p_ || !p_->n.enh) return true;   // absent is not a failure, matches syncLip
  const Config& cfg = p_->cfg;
  if (!cfg.faceEnhance) return true;
  // Same rule as swapAll and editFaces: with the swapper off this stage alone changes
  // the frame, so it may not run on a pipeline no check has cleared.
  if (!p_->gateCleared) {
    err_ = "content check has not run for this pipeline";
    return false;
  }
  const int SS = cfg.swapSize;
  const int PB = cfg.pixelBoost < 1 ? 1 : cfg.pixelBoost;
  const int CS = SS * PB;
  if (CS % kEnhSize != 0) return true;

  float tmpl[10];
  const float* T = ffcv::warpTemplate(1);            // arcface_128, same as swapAll
  for (int i = 0; i < 10; ++i) tmpl[i] = T[i] * CS;

  ffcv::MatF mask = ffcv::createBoxMask(CS, CS, cfg.maskBlur, cfg.maskPadding);

  const Face* only = nullptr;
  if (cfg.swapLargestOnly) {
    float best = -1.f;
    for (const Face& f : faces) {
      float a = (f.box[2] - f.box[0]) * (f.box[3] - f.box[1]);
      if (a > best) { best = a; only = &f; }
    }
  }

  const int ES = kEnhSize, EPB = CS / ES;
  for (size_t fi = 0; fi < faces.size(); ++fi) {
    const Face& f = faces[fi];
    if (only && &f != only) continue;
    // ⚠ The enhancer is a SECOND pass over the same faces, so it needs the same answer.
    // A person the swapper left alone must be left alone here too -- gpen would otherwise
    // redraw the face this mode exists to preserve, and the result would be neither the
    // original nor a swap.
    if (p_->sourceForFace(f, fi, faces.size(), cfg.referenceDistance) == kNoSource)
      continue;
    if (f.poseFade < 0.02f) continue;   // the swap left this face alone; so does gpen

    double t0 = nowMs();
    ffcv::Affine am = ffcv::umeyama(f.landmark5_68, tmpl, 5);
    // Re-warp whatever is in `frame` NOW -- this IS upstream's actual face_enhancer pass
    // (see swapAll's comment on the fused version being the approximation of this), just
    // called at a different POINT in the pipeline than the old fused call was.
    ffcv::Image crop = ffcv::warpAffine(frame, am, CS, CS, ffcv::BORDER_REPLICATE);
    msGeom += nowMs() - t0;

    ffcv::MatF enhCrop(CS, CS, 3);
    std::vector<float> ein((size_t)3 * ES * ES);
    for (int k = 0; k < EPB * EPB; ++k) {
      const int ty = k / EPB, tx = k % EPB;

      t0 = nowMs();
      for (int y = 0; y < ES; ++y) {
        const uint8_t* row = crop.row(y * EPB + ty);
        for (int x = 0; x < ES; ++x)
          for (int c = 0; c < 3; ++c)
            ein[(size_t)(2 - c) * ES * ES + (size_t)y * ES + x] =
                ((row[(x * EPB + tx) * 3 + c] / 255.0f) - 0.5f) / 0.5f;
      }
      msGeom += nowMs() - t0;

      t0 = nowMs();
      std::vector<std::vector<float>> eo;
      if (!ffnn::execute(p_->n.enh, {"input"}, {ein.data()}, eo)) {
        err_ = std::string("enhancer: ") + ffnn::lastError();
        return false;
      }
      msEnhance += nowMs() - t0;

      t0 = nowMs();
      const float* e = eo[0].data();
      for (int y = 0; y < ES; ++y) {
        float* erow = enhCrop.row(y * EPB + ty);
        for (int x = 0; x < ES; ++x)
          for (int c = 0; c < 3; ++c) {
            float v = e[(size_t)c * ES * ES + (size_t)y * ES + x];
            v = v < -1.f ? -1.f : (v > 1.f ? 1.f : v);
            erow[(x * EPB + tx) * 3 + (2 - c)] = (v + 1.f) * 0.5f * 255.f;
          }
      }
      msGeom += nowMs() - t0;
    }

    // blend_paste_frame, against `crop` -- the frame this pass started from -- since
    // there is no separate "un-enhanced swap output" once syncLip has already run.
    t0 = nowMs();
    const float b = cfg.faceEnhancerBlend < 0.f ? 0.f
                  : (cfg.faceEnhancerBlend > 1.f ? 1.f : cfg.faceEnhancerBlend);
    ffcv::MatF outF(CS, CS, 3);
    for (int y = 0; y < CS; ++y) {
      const uint8_t* srow = crop.row(y);
      const float* erow = enhCrop.row(y);
      float* orow = outF.row(y);
      for (int i = 0, n = CS * 3; i < n; ++i)
        orow[i] = (float)srow[i] * (1.f - b) + erow[i] * b;
    }
    msGeom += nowMs() - t0;

    // The swap's own mask when it made one for this face (same template, same size), so
    // gpen does not repaint the banana the occlusion mask kept; otherwise build one here.
    const ffcv::MatF* useMask = &mask;
    ffcv::MatF faceMask;
    if (const ffcv::MatF* cached = p_->cachedMask(f)) {
      useMask = cached;
    } else if (p_->wantsMaskModels() || f.poseFade < 0.999f) {
      faceMask = mask;
      if (p_->wantsMaskModels() && !p_->applyMaskModels(crop, faceMask, err_)) return false;
      if (f.poseFade < 0.999f)
        for (float& v : faceMask.data) v *= f.poseFade;
      useMask = &faceMask;
    }

    t0 = nowMs();
    ffcv::pasteBack(frame, outF, *useMask, am);
    msGeom += nowMs() - t0;
  }
  return true;
}


// ------------------------------------------------------------- LivePortrait
//
// Three graphs on the NPU -- lp_feature, lp_motion and lp_gencut, the generator from its
// dense-motion hourglass on -- and on the CPU the keypoint arithmetic (ffportrait) and the
// hourglass's input, which on the HTP cost 1.7 s of the full generator's time and here is
// ~18 ms (ffportrait::hourglassInput). Two processors use them: face_editor (editFaces) and
// face_animator (setPortrait + animate).

namespace {
// model options: ffhq_512 at 512, the graphs at half that (prepare_crop_frame).
constexpr int kLpCrop = 512, kLpModel = 256;
}  // namespace

bool Pipeline::lpCrop(const ffcv::Image& frame, const Face& f, ffcv::Affine* am,
                      std::vector<float>* in) {
  // scale_face_landmark_5(landmark_set['5/68'], 1.5): about the nose, point 2.
  float tmpl[10], lm5[10];
  const float* T = ffcv::warpTemplate(2);   // ffhq_512
  for (int i = 0; i < 10; ++i) tmpl[i] = T[i] * kLpCrop;
  const float nx = f.landmark5_68[4], ny = f.landmark5_68[5];
  for (int i = 0; i < 5; ++i) {
    lm5[i * 2] = (f.landmark5_68[i * 2] - nx) * 1.5f + nx;
    lm5[i * 2 + 1] = (f.landmark5_68[i * 2 + 1] - ny) * 1.5f + ny;
  }
  *am = ffcv::umeyama(lm5, tmpl, 5);
  ffcv::Image crop = ffcv::warpAffine(frame, *am, kLpCrop, kLpCrop, ffcv::BORDER_REPLICATE);
  // cv2.INTER_AREA at exactly 2x, which resizeLinear reproduces bit for bit (edtalk).
  ffcv::Image small = ffcv::resizeLinear(crop, kLpModel, kLpModel);
  in->resize((size_t)3 * kLpModel * kLpModel);
  for (int y = 0; y < kLpModel; ++y) {
    const uint8_t* row = small.row(y);
    for (int x = 0; x < kLpModel; ++x)
      for (int c = 0; c < 3; ++c)   // BGR -> RGB planes, / 255
        (*in)[(size_t)(2 - c) * kLpModel * kLpModel + (size_t)y * kLpModel + x] =
            row[x * 3 + c] / 255.0f;
  }
  return true;
}

bool Pipeline::lpMotion(const std::vector<float>& in, ffportrait::Motion* m) {
  std::vector<std::vector<float>> mo;
  if (!ffnn::execute(p_->n.lpMotion, {"input"}, {in.data()}, mo)) {
    err_ = std::string("LivePortrait motion: ") + ffnn::lastError();
    return false;
  }
  const std::vector<std::string> names = ffnn::outputNames(p_->n.lpMotion);
  bool complete = names.size() == mo.size();
  auto take = [&](const char* name, float* dst, size_t n) {
    for (size_t i = 0; i < names.size(); ++i)
      if (names[i] == name && mo[i].size() == n) {
        std::copy(mo[i].begin(), mo[i].end(), dst);
        return;
      }
    complete = false;
  };
  constexpr size_t K = ffportrait::kKeypoints * 3;
  take("pitch", &m->pitch, 1);
  take("yaw", &m->yaw, 1);
  take("roll", &m->roll, 1);
  take("scale", &m->scale, 1);
  take("translation", m->translation, 3);
  take("expression", m->expression, K);
  take("motion_points", m->points, K);
  if (!complete) err_ = "LivePortrait motion: outputs do not match";
  return complete;
}

bool Pipeline::lpFeature(const std::vector<float>& in, std::vector<float>* fv) {
  std::vector<std::vector<float>> fo;
  if (!ffnn::execute(p_->n.lpFeat, {"input"}, {in.data()}, fo)) {
    err_ = std::string("LivePortrait features: ") + ffnn::lastError();
    return false;
  }
  if (fo.empty() || fo[0].size() != (size_t)ffportrait::kFeatureChannels * ffportrait::kVoxels) {
    err_ = "LivePortrait features: unexpected output";
    return false;
  }
  fv->swap(fo[0]);
  return true;
}

bool Pipeline::lpRender(const std::vector<float>& fv, const float* source, const float* target,
                        const ffcv::Affine& am, const ffcv::MatF& mask, ffcv::Image& frame) {
  double t0 = nowMs();
  p_->lpHg.resize((size_t)ffportrait::kVoxels * ffportrait::kHourglassChannels);
  ffportrait::hourglassInput(fv.data(), source, target, p_->lpHg.data());
  msEditCpu += nowMs() - t0;

  t0 = nowMs();
  std::vector<std::vector<float>> go;
  if (!ffnn::execute(p_->n.lpGen, {"feature_volume", "source", "target", "hg_input"},
                     {fv.data(), source, target, p_->lpHg.data()}, go)) {
    err_ = std::string("LivePortrait generator: ") + ffnn::lastError();
    return false;
  }
  msEdit += nowMs() - t0;
  // By name: a build carrying diagnostic taps puts them before `output`.
  const std::vector<std::string> genNames = ffnn::outputNames(p_->n.lpGen);
  const std::vector<float>* gen = nullptr;
  for (size_t i = 0; i < genNames.size() && i < go.size(); ++i)
    if (genNames[i] == "output") gen = &go[i];
  if (!gen || gen->size() != (size_t)3 * kLpCrop * kLpCrop) {
    err_ = "LivePortrait generator: unexpected output";
    return false;
  }

  // normalize_crop_frame: clip to [0, 1], * 255, astype(uint8) -- which TRUNCATES --
  // and RGB back to BGR; then paste_back through the box mask.
  t0 = nowMs();
  const float* g = gen->data();
  ffcv::MatF out(kLpCrop, kLpCrop, 3);
  for (int y = 0; y < kLpCrop; ++y) {
    float* orow = out.row(y);
    for (int x = 0; x < kLpCrop; ++x)
      for (int c = 0; c < 3; ++c) {
        float v = g[(size_t)c * kLpCrop * kLpCrop + (size_t)y * kLpCrop + x];
        v = v < 0.f ? 0.f : (v > 1.f ? 1.f : v);
        orow[x * 3 + (2 - c)] = std::floor(v * 255.0f);
      }
  }
  ffcv::pasteBack(frame, out, mask, am);
  msGeom += nowMs() - t0;
  return true;
}

// face_editor/core.py:edit_face.
bool Pipeline::restoreExpression(ffcv::Image& frame, const std::vector<Face>& faces) {
  const Config& cfg = p_->cfg;
  if (p_->preSwap.w != frame.w || p_->preSwap.h != frame.h) return true;
  const int noPadding[4] = {0, 0, 0, 0};
  const ffcv::MatF box = ffcv::createBoxMask(kLpCrop, kLpCrop, cfg.maskBlur, noPadding);
  // numpy.interp(factor, [0, 100], [0, 1.2]) with the factor stored as 0..1.
  const float factor = std::fmin(1.f, std::fmax(0.f, cfg.expressionRestoreFactor)) * 1.2f;

  const Face* only = nullptr;
  if (!p_->haveReference && cfg.swapLargestOnly) {
    float best = -1.f;
    for (const Face& f : faces) {
      float a = (f.box[2] - f.box[0]) * (f.box[3] - f.box[1]);
      if (a > best) { best = a; only = &f; }
    }
  }
  std::vector<float> in, inOrig, fv;
  for (size_t fi = 0; fi < faces.size(); ++fi) {
    const Face& f = faces[fi];
    // The faces swapAll changed, and only those.
    if (only && &f != only) continue;
    if (p_->haveReference &&
        faceDistance(f.embeddingNorm, p_->refEmbeddingNorm) >= cfg.referenceDistance)
      continue;
    if (p_->sourceForFace(f, fi, faces.size(), cfg.referenceDistance) == kNoSource) continue;
    if (f.poseFade < 0.02f) continue;

    double t0 = nowMs();
    ffcv::Affine am, amOrig;
    lpCrop(frame, f, &am, &in);
    lpCrop(p_->preSwap, f, &amOrig, &inOrig);
    msGeom += nowMs() - t0;

    t0 = nowMs();
    ffportrait::Motion swapped, original;
    if (!lpFeature(in, &fv) || !lpMotion(in, &swapped) || !lpMotion(inOrig, &original))
      return false;
    msEdit += nowMs() - t0;

    float source[ffportrait::kKeypoints * 3], target[ffportrait::kKeypoints * 3];
    ffportrait::restoreKeypoints(swapped, original, factor, source, target);

    // The same mask the swap used, in this crop's geometry: occlusion and the mouth
    // switches are measured on the ORIGINAL face, so a kept mouth or a hand stays kept.
    ffcv::MatF mask = box;
    if (p_->wantsMaskModels()) {
      t0 = nowMs();
      const ffcv::Image oc =
          ffcv::warpAffine(p_->preSwap, am, kLpCrop, kLpCrop, ffcv::BORDER_REPLICATE);
      if (!p_->applyMaskModels(oc, mask, err_)) return false;
      msGeomMask += nowMs() - t0;
    }
    if (f.poseFade < 0.999f)
      for (float& v : mask.data) v *= f.poseFade;
    if (!lpRender(fv, source, target, am, mask, frame)) return false;
  }
  return true;
}

bool Pipeline::editFaces(ffcv::Image& frame, const std::vector<Face>& faces) {
  if (!hasFaceEditor()) return true;   // absent is not a failure, matches enhance
  if (p_->havePreSwap) {
    p_->havePreSwap = false;
    if (p_->cfg.expressionRestore && !restoreExpression(frame, faces)) return false;
  }
  const Config& cfg = p_->cfg;
  if (!cfg.faceEdit || !ffportrait::anyEdit(cfg.faceEditor)) return true;
  static_assert(ffportrait::kSliderCount == 14, "Config::faceEditor is 14 sliders");
  // The swap's own rule, because with the swapper off this stage is the one that changes
  // the frame: no check, no edit. See Impl::gateCleared.
  if (!p_->gateCleared) {
    err_ = "content check has not run for this pipeline";
    return false;
  }
  // create_box_mask(crop, face_mask_blur, (0, 0, 0, 0)) -- the editor ignores the padding.
  const int noPadding[4] = {0, 0, 0, 0};
  ffcv::MatF mask = ffcv::createBoxMask(kLpCrop, kLpCrop, cfg.maskBlur, noPadding);

  const Face* only = nullptr;
  if (cfg.swapLargestOnly) {
    float best = -1.f;
    for (const Face& f : faces) {
      float a = (f.box[2] - f.box[0]) * (f.box[3] - f.box[1]);
      if (a > best) { best = a; only = &f; }
    }
  }

  std::vector<float> in, fv;
  for (size_t fi = 0; fi < faces.size(); ++fi) {
    const Face& f = faces[fi];
    if (only && &f != only) continue;
    if (p_->sourceForFace(f, fi, faces.size(), cfg.referenceDistance) == kNoSource) continue;

    double t0 = nowMs();
    ffcv::Affine am;
    lpCrop(frame, f, &am, &in);
    msGeom += nowMs() - t0;

    t0 = nowMs();
    ffportrait::Motion m;
    if (!lpFeature(in, &fv) || !lpMotion(in, &m)) return false;
    msEdit += nowMs() - t0;

    t0 = nowMs();
    float source[ffportrait::kKeypoints * 3], target[ffportrait::kKeypoints * 3];
    ffportrait::editKeypoints(m, cfg.faceEditor, f.landmark68, p_->lpMlps, source, target);
    msEditCpu += nowMs() - t0;
    if (!lpRender(fv, source, target, am, mask, frame)) return false;
  }
  return true;
}

// face_animator: the photo's face, moved like the driver's (LivePortrait's own use).
bool Pipeline::setPortrait(const ffcv::Image& photo) {
  p_->portrait = Impl::Portrait();
  if (!hasFaceEditor()) { err_ = "the LivePortrait models are not loaded"; return false; }
  std::vector<Face> faces = analyse(photo, false, /*noTrack=*/true);
  const Face* best = nullptr;
  float area = -1.f;
  for (const Face& f : faces) {
    const float a = (f.box[2] - f.box[0]) * (f.box[3] - f.box[1]);
    if (a > area) { area = a; best = &f; }
  }
  if (!best) { err_ = "no face found in the photo"; return false; }
  Impl::Portrait& P = p_->portrait;
  std::vector<float> in;
  lpCrop(photo, *best, &P.am, &in);
  if (!lpFeature(in, &P.fv) || !lpMotion(in, &P.motion)) return false;
  const int noPadding[4] = {0, 0, 0, 0};
  P.mask = ffcv::createBoxMask(kLpCrop, kLpCrop, p_->cfg.maskBlur, noPadding);
  P.photo = photo;
  P.ready = true;
  return true;
}

void Pipeline::resetAnimation() { p_->portrait.haveFirst = false; }

bool Pipeline::animate(const ffcv::Image& driver, ffcv::Image& out) {
  Impl::Portrait& P = p_->portrait;
  if (!P.ready) { err_ = "setPortrait not called"; return false; }
  // No check, no frame: the rule every stage that changes a picture follows.
  if (!p_->gateCleared) {
    err_ = "content check has not run for this pipeline";
    return false;
  }
  out = P.photo;
  // The driver's largest face. A frame with none leaves the photo as it is.
  std::vector<Face> faces = analyse(driver);
  const Face* best = nullptr;
  float area = -1.f;
  for (const Face& f : faces) {
    const float a = (f.box[2] - f.box[0]) * (f.box[3] - f.box[1]);
    if (a > area) { area = a; best = &f; }
  }
  if (!best) return true;

  double t0 = nowMs();
  std::vector<float> in;
  ffcv::Affine dam;
  lpCrop(driver, *best, &dam, &in);
  msGeom += nowMs() - t0;
  t0 = nowMs();
  ffportrait::Motion d;
  if (!lpMotion(in, &d)) return false;
  msEdit += nowMs() - t0;
  // Relative motion is measured against the driver's FIRST face: the photo starts in its
  // own pose and follows the driver's CHANGES, as LivePortrait does by default.
  if (!P.haveFirst) { P.first = d; P.haveFirst = true; }

  t0 = nowMs();
  float source[ffportrait::kKeypoints * 3], target[ffportrait::kKeypoints * 3];
  ffportrait::animateKeypoints(P.motion, P.first, d, p_->lpMlps, source, target);
  msEditCpu += nowMs() - t0;
  return lpRender(P.fv, source, target, P.am, P.mask, out);
}

}  // namespace ffpipe
