// Print the output shape of every Reshape layer of an ncnn model, for a 3x256x256 input.
#include <cstdio>
#include <cstring>
#include <string>
#include "net.h"
#include "layer.h"
int main(int argc, char** argv) {
  ncnn::Net net;
  net.opt.use_vulkan_compute = false;
  net.opt.use_packing_layout = false;
  if (net.load_param(argv[1]) || net.load_model(argv[2])) return 1;
  ncnn::Mat in(256, 256, 3);
  in.fill(0.5f);
  for (const ncnn::Layer* l : net.layers()) {
    if (l->type != "Reshape") continue;
    ncnn::Extractor ex = net.create_extractor();
    ex.input("in0", in);
    ncnn::Mat out;
    const char* top = net.blobs()[l->tops[0]].name.c_str();
    ex.extract(top, out);
    printf("%s %d %d %d %d %d\n", l->name.c_str(), out.dims, out.w, out.h, out.d, out.c);
  }
  return 0;
}
