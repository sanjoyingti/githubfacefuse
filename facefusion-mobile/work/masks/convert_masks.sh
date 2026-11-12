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
# then converted with pnnx (fp16 weights). pnnx writes some xseg reshapes as runtime
# expressions only ncnn >= 20261020 can parse, while the APK links an older ncnn, so their
# sizes are frozen into plain numbers (freeze_reshape.py) using shapes measured with a
# newer ncnn (print_reshape_shapes.cpp; set NCNN_NEW to an extracted ncnn >= 20261020
# Linux release). Finally both models are checked against onnxruntime.
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

: "${NCNN_NEW:?set NCNN_NEW to an extracted ncnn >= 20261020 Linux release}"
g++ -O1 -std=c++17 -I"$NCNN_NEW/include/ncnn" "$HERE/print_reshape_shapes.cpp" \
  "$NCNN_NEW"/lib/libncnn.a "$NCNN_NEW"/lib/libglslang.a "$NCNN_NEW"/lib/libMachineIndependent.a \
  "$NCNN_NEW"/lib/libGenericCodeGen.a "$NCNN_NEW"/lib/libOSDependent.a "$NCNN_NEW"/lib/libSPIRV.a \
  "$NCNN_NEW"/lib/libglslang-default-resource-limits.a -fopenmp -ldl -lpthread -o print_shapes
./print_shapes xseg_3_nchw.ncnn.param xseg_3_nchw.ncnn.bin > xseg_shapes.txt
"$PY" "$HERE/freeze_reshape.py" xseg_3_nchw.ncnn.param xseg_shapes.txt

"$PY" "$HERE/verify_masks.py" "$HERE/../../media/source-face.jpg" "$OUT"
cp xseg_3_nchw.ncnn.param xseg_3_nchw.ncnn.bin bisenet_resnet_18_b1.ncnn.param bisenet_resnet_18_b1.ncnn.bin "$DEST/"
echo "updated $DEST"
