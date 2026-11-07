#!/usr/bin/env bash
# The models added in 1.0.54 (all from github.com/facefusion/facefusion-assets, models-3.0.0):
#
#   scrfd_2.5g         second face detector     assets/masks/scrfd_2.5g.ncnn.*        (ncnn only)
#   peppa_wutz         second face-point model  assets/masks/peppa.ncnn.* + masks_npu/peppa_v79.bin
#   bisenet_resnet_34  larger face parser       assets/masks/bisenet_resnet_34_b1.ncnn.* + masks_npu/bisenet34_v79.bin
#   gpen_bfr_512       512 enhancer             masks_npu/gpen512_v79.bin.000/.001   (NPU only, in
#                                               pieces < 100 MB; the app joins them on install)
#
# Tools: pnnx (fp16=1), QAIRT 2.49.0.260730 (qairt-converter + qnn-context-binary-generator,
# v79 / soc 69, fp16 relaxed, as in convert_masks_npu.sh), ncnn 20261020 Linux for checks.
#
# Per model:
#   scrfd    pnnx scrfd_2.5g.onnx inputshape=[1,3,640,640] fp16=1  (nine outputs out0..out8)
#   peppa    cut the graph at kp_/student/hm/Conv_output_0 ([294,64,64]: 98 heatmaps, x and
#            y offsets; onnx.utils.extract_model), output renamed `output`; the 98->68 point
#            table in ffpipe.cpp (kPeppa68) was measured from the model's own tail graph (exact
#            to 3e-6); pnnx, then freeze_reshape.py for one reshape the app's ncnn cannot parse
#   bisenet34  prep_onnx.py ... bisenet, pnnx at 512, qairt as convert_masks_npu.sh
#   gpen512  graph inputs that are initializers removed, qairt-converter, context binary,
#            then: split -b 95000000 -d -a 3 gpen512_v79.bin gpen512_v79.bin.
#
# Checked against onnxruntime (fp32):
#   scrfd    ncnn scores within 0.001, boxes within 0.2 px; same faces on 4 frames
#   peppa    ncnn within 0.5 px of 256; NPU (HTP simulator) within 1.65 px; scores equal
#   bisenet34  ncnn 99.93-99.98% labels agree; NPU (simulator) 99.86%
#   gpen512  NPU (simulator) mean |diff| 0.07 of 255, max 2
# NB: the Python ncnn wheel computes wrong numbers on this machine's AVX-512 CPU; checks use
# a small C++ runner linked against the ncnn release instead.
echo "see the comments: the steps are listed, the outputs are committed under assets/"
