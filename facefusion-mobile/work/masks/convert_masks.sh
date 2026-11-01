#!/usr/bin/env bash
# Rebuild the bundled mask models (app/src/main/assets/masks) from FaceFusion's ONNX files.
#
#   python3 -m venv /tmp/mv && /tmp/mv/bin/pip install onnx onnxruntime pnnx ncnn numpy pillow opencv-python-headless
#   PY=/tmp/mv/bin/python PNNX=/tmp/mv/bin/pnnx bash work/masks/convert_masks.sh
#
# xseg_3 (occlusion, from DeepFaceLab, GPL-3.0) and bisenet_resnet_18 (face parser, MIT)
# come from huggingface.co/facefusion. Both are rewritten into single-input, fixed-shape
# NCHW graphs pnnx can convert:
#   xseg     NHWC input -> NCHW (Transpose added), TF "SAME" Pad folded into the convs,
#            asymmetric ConvTranspose pads replaced by a crop
#   bisenet  batch fixed to 1, the two auxiliary outputs dropped
# then converted with pnnx (fp16 weights) and checked against onnxruntime.
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PY=${PY:-python3}; PNNX=${PNNX:-pnnx}
OUT=${OUT:-$HERE/build}; DEST=$HERE/../android/app/src/main/assets/masks
mkdir -p "$OUT" "$DEST"; cd "$OUT"
curl -sSL -o xseg_3.onnx https://huggingface.co/facefusion/models-3.2.0/resolve/main/xseg_3.onnx
curl -sSL -o bisenet_resnet_18.onnx https://huggingface.co/facefusion/models-3.1.0/resolve/main/bisenet_resnet_18.onnx

"$PY" "$HERE/prep_onnx.py" xseg_3.onnx xseg_a.onnx xseg
"$PY" "$HERE/foldpad.py" xseg_a.onnx xseg_b.onnx
"$PY" "$HERE/fixdeconv.py" xseg_b.onnx xseg_3_nchw.onnx
"$PY" "$HERE/prep_onnx.py" bisenet_resnet_18.onnx bisenet_resnet_18_b1.onnx bisenet
"$PNNX" xseg_3_nchw.onnx inputshape=[1,3,256,256] >/dev/null
"$PNNX" bisenet_resnet_18_b1.onnx inputshape=[1,3,512,512] >/dev/null

"$PY" "$HERE/verify_masks.py" "$HERE/../../media/source-face.jpg" "$OUT"
cp xseg_3_nchw.ncnn.param xseg_3_nchw.ncnn.bin bisenet_resnet_18_b1.ncnn.param bisenet_resnet_18_b1.ncnn.bin "$DEST/"
echo "updated $DEST"
