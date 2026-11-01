# Wrap facefusion xseg/bisenet ONNX graphs into fixed-shape NCHW single-output graphs for pnnx.
import sys, onnx
from onnx import helper, TensorProto
src, dst, kind = sys.argv[1], sys.argv[2], sys.argv[3]
m = onnx.load(src)
g = m.graph
if kind == "xseg":
    old_in = g.input[0].name
    g.input[0].name = "nchw_in"
    g.input[0].type.tensor_type.shape.Clear()
    for d in (1, 3, 256, 256):
        g.input[0].type.tensor_type.shape.dim.add().dim_value = d
    for n in g.node:
        for i, x in enumerate(n.input):
            if x == old_in: n.input[i] = "nhwc_in"
    g.node.insert(0, helper.make_node("Transpose", ["nchw_in"], ["nhwc_in"], perm=[0, 2, 3, 1]))
    old_out = g.output[0].name
    g.node.append(helper.make_node("Transpose", [old_out], ["mask"], perm=[0, 3, 1, 2]))
    del g.output[:]
    g.output.append(helper.make_tensor_value_info("mask", TensorProto.FLOAT, [1, 1, 256, 256]))
else:
    g.input[0].type.tensor_type.shape.dim[0].dim_value = 1
    keep = g.output[0]
    del g.output[1:]
    keep.type.tensor_type.shape.Clear()
    for d in (1, 19, 512, 512):
        keep.type.tensor_type.shape.dim.add().dim_value = d
onnx.checker.check_model(m)
onnx.save(m, dst)
print("ok", dst)
