#!/usr/bin/env bash
# Build work/native/test_quality for the HOST (x86-64 Linux) against the ncnn CPU backend.
#
#   NCNN=/path/to/ncnn-YYYYMMDD-ubuntu-2404  bash work/native/build_host_test.sh [--asan]
#
# NCNN is an extracted ncnn release for Linux (github.com/Tencent/ncnn/releases). QNN is
# compiled in (headers from app/src/main/cpp/include, see stage_qnn.sh) but never loads on
# a PC, so the pipeline falls through to ncnn exactly as it does on a non-Qualcomm phone.
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
CPP=$HERE/../android/app/src/main/cpp
OUT=${OUT:-$HERE/build-host}
: "${NCNN:?set NCNN to an extracted ncnn Linux release}"
mkdir -p "$OUT/stub/android"
# ffqnn.cpp logs through <android/log.h>; on a PC that is stderr.
cat > "$OUT/stub/android/log.h" <<'H'
#pragma once
#include <cstdarg>
#include <cstdio>
enum { ANDROID_LOG_DEBUG = 3, ANDROID_LOG_INFO = 4, ANDROID_LOG_WARN = 5, ANDROID_LOG_ERROR = 6 };
inline int __android_log_print(int, const char* tag, const char* fmt, ...) {
  va_list ap; va_start(ap, fmt); fprintf(stderr, "[%s] ", tag); vfprintf(stderr, fmt, ap);
  fputc('\n', stderr); va_end(ap); return 0;
}
H
SAN=()
[ "${1:-}" = "--asan" ] && SAN=(-fsanitize=address,undefined -fno-omit-frame-pointer -g)
g++ -O2 -std=c++17 "${SAN[@]}" -DFFNN_HAVE_NCNN \
  -I"$OUT/stub" -I"$CPP" -I"$CPP/include" -I"$CPP/include/QNN" -I"$NCNN/include/ncnn" \
  "$HERE/test_quality.cpp" "$CPP/ffpipe.cpp" "$CPP/ffcv.cpp" "$CPP/ffmotion.cpp" \
  "$CPP/ffnn.cpp" "$CPP/ffnn_qnn.cpp" "$CPP/ffqnn.cpp" "$CPP/ffnn_ncnn.cpp" \
  "$CPP/ffaudio.cpp" "$CPP/ffportrait.cpp" \
  "$NCNN/lib/libncnn.a" "$NCNN/lib/libglslang.a" "$NCNN/lib/libMachineIndependent.a" \
  "$NCNN/lib/libGenericCodeGen.a" "$NCNN/lib/libOSDependent.a" "$NCNN/lib/libSPIRV.a" \
  "$NCNN/lib/libglslang-default-resource-limits.a" \
  -fopenmp -ldl -lpthread -o "$OUT/test_quality"
echo "built $OUT/test_quality"
