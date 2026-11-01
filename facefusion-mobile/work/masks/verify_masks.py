# Check the converted ncnn mask models against the original ONNX graphs on one real face.
#
#   python verify_masks.py FACE.jpg DIR
#
# DIR holds xseg_3.onnx, bisenet_resnet_18.onnx and the converted *.ncnn.param/.bin.
# Expected: xseg max abs error ~0.003; bisenet per-pixel label agreement 1.0000.
import sys

import cv2
import ncnn
import numpy as np
import onnxruntime as ort

face, d = sys.argv[1], sys.argv[2].rstrip("/") + "/"
img = cv2.imread(face)
h, w = img.shape[:2]
s = min(h, w)
img = img[(h - s) // 2:(h - s) // 2 + s, (w - s) // 2:(w - s) // 2 + s]


def run_ncnn(stem, chw):
    net = ncnn.Net()
    net.opt.use_fp16_storage = True
    net.opt.use_fp16_arithmetic = False
    net.load_param(d + stem + ".ncnn.param")
    net.load_model(d + stem + ".ncnn.bin")
    # ncnn.Mat wraps the numpy buffer without copying: keep `arr` alive until extract.
    arr = np.ascontiguousarray(chw, dtype=np.float32)
    ex = net.create_extractor()
    ex.input("in0", ncnn.Mat(arr))
    _, out = ex.extract("out0")
    return np.array(out)


# xseg: NHWC, BGR, /255 in the original; NCHW in the conversion.
x = cv2.resize(img, (256, 256)).astype(np.float32)[None] / 255.0
ref = ort.InferenceSession(d + "xseg_3.onnx").run(None, {"input": x})[0][0, :, :, 0]
got = run_ncnn("xseg_3_nchw", x[0].transpose(2, 0, 1)).reshape(256, 256)
err = np.abs(ref - got).max()
print("xseg     max abs error %.4f" % err)

# bisenet: RGB, ImageNet mean/std, NCHW.
y = cv2.resize(img, (512, 512))[:, :, ::-1].astype(np.float32) / 255.0
y = ((y - [0.485, 0.456, 0.406]) / [0.229, 0.224, 0.225]).astype(np.float32)
y = np.ascontiguousarray(y.transpose(2, 0, 1)[None])
ref = ort.InferenceSession(d + "bisenet_resnet_18.onnx").run(None, {"input": y})[0][0]
got = run_ncnn("bisenet_resnet_18_b1", y[0])
agree = (ref.argmax(0) == got.argmax(0)).mean()
print("bisenet  label agreement %.4f" % agree)
sys.exit(0 if err < 0.02 and agree > 0.995 else 1)
