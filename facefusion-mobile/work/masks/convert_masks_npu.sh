#!/usr/bin/env bash
# Build the mask models' NPU context binaries (assets/masks_npu/<name>_v79.bin), fp16.
#
# QAIRT 2.49.0.260730 (x86_64 Linux tools), Python 3.12 venv with numpy<2.3, onnx 1.17,
# setuptools; libc++1 installed. Inputs: the NCHW ONNX graphs the ncnn builds came from
# (xseg_3_nchw.onnx, bisenet_resnet_18_b1.onnx) with the image input renamed to `input`,
# the name ffpipe executes with.
#
# Validated on the HTP simulator against onnxruntime fp32 (5 inputs):
#   xseg    mean |diff| 0.0002, >=99.99% of pixels agree at 0.5
#   bisenet 99.7-99.97% label agreement (differences only on region borders)
# On the phone ffpipe::maskNet compares the NPU output with the CPU's before using it.
set -euo pipefail
: "${QNN_SDK_ROOT:?source the QAIRT env}"
OUT=${OUT:-$PWD/masks_npu}; mkdir -p "$OUT"
for N in xseg bisenet; do
  qairt-converter --input_network "$N.onnx" --output_path "$N.dlc" --preserve_io_datatype \
      --preserve_io layout input $([ $N = xseg ] && echo mask || echo output)
  cat > cfg_$N.json <<J
{ "graphs": [ { "vtcm_mb": 8, "graph_names": ["$N"], "O": 3.0, "fp16_relaxed_precision": 1 } ],
  "devices": [ { "dsp_arch": "v79", "soc_model": 69 } ] }
J
  cat > be_$N.json <<J
{ "backend_extensions": { "shared_library_path": "$QNN_SDK_ROOT/lib/x86_64-linux-clang/libQnnHtpNetRunExtensions.so", "config_file_path": "$PWD/cfg_$N.json" } }
J
  qnn-context-binary-generator --dlc_path "$N.dlc" \
      --model "$QNN_SDK_ROOT/lib/x86_64-linux-clang/libQnnModelDlc.so" \
      --backend "$QNN_SDK_ROOT/lib/x86_64-linux-clang/libQnnHtp.so" \
      --output_dir "$OUT" --binary_file "${N}_v79" --config_file be_$N.json
done
ls -la "$OUT"
